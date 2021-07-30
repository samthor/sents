import * as path from 'path';
import * as fs from 'fs';


// Whether watching works recursively. Node's docs aren't completely clear on this, and they imply
// that we should be able to determine this via an exception, but that's not always the case.
export const supportsRecursive = ['darwin', 'windows'].includes(process.platform);


// Whether watching a directory actually tracks its inode, not its disk path. This means that
// any changes we see through `fs.watch` might actually be the directory being moved.
// (Node can incorrectly include the name of the directory, which isn't differentiated from a file
// of the same name *inside* that directory).
export const inodeDir = ['linux', 'android'].includes(process.platform);


/**
 * @param {fs.FSWatcher?} watcher
 */
function closeWatcher(watcher) {
  if (watcher) {
    // @ts-ignore types appear to miss this method
    watcher.unref();
    watcher.close();
  }
}


/**
 * @param {fs.PathLike} p
 * @return {?fs.Stats}
 */
export function lstatOrNull(p) {
  try {
    // no options, as that can return BigIntStats
    return fs.lstatSync(p) ?? null;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    return null;
  }
}


/**
 * @param {fs.Stats?} stat
 * @return {string}
 */
export function inodeStatKey(stat) {
  if (!stat) {
    return '';
  }
  return `${stat.dev}-${stat.ino}`;
}


/**
 * Watches a folder recursively using native support.
 */
class NativeRecursiveWatcher {
  #watcher = null;

  /**
   * @param {string} dir
   * @param {(name: string|null, error?: Error|undefined) => void} handler
   */
  constructor(dir, handler) {
    this.#watcher = fs.watch(dir, {recursive: true}, (ev, filename) => {
      handler(filename);
    });
    this.#watcher.on('error', (error) => handler(null, error));
  }

  /**
   * @param {string} rel
   * @param {boolean=} purge
   */
  hint(rel, purge = false) {
    // do nothing
    return true;
  }

  close() {
    closeWatcher(this.#watcher);
    this.#watcher = null;
  }
}


/**
 * Watches a folder recursively by watching individual paths.
 */
class FauxRecursiveWatcher {
  #dir = '';
  #handler = null;

  /**
   * @type {{[name: string]: fs.FSWatcher}}
   */
  #watchers = {};

  /**
   * @param {string} dir
   * @param {function(?string, Error|undefined): void} handler
   */
  constructor(dir, handler) {
    this.#dir = dir;
    this.#handler = handler;
  }

  /**
   * @param {string} rel
   * @param {boolean=} purge
   */
  hint(rel, purge = false) {
    if (rel.startsWith('../')) {
      throw new Error('scan outside bounds: ' + rel);
      return false;
    }

    let watcher = null;

    if (!purge) {
      const subdir = path.join(this.#dir, rel);
      try {
        watcher = fs.watch(subdir, {recursive: false}, (ev, filename) => {
          this.#handler(path.join(rel, filename));
        });
      } catch (e) {
        if (e.code !== 'ENOENT') {
          throw e;
        }
        watcher = null;
      }
      if (watcher) {
        watcher.on('error', (error) => this.#handler(null, error));
      }
    }

    const prev = this.#watchers[rel];
    closeWatcher(prev);

    if (watcher === null) {
      delete this.#watchers[rel];
      return false;
    }
    this.#watchers[rel] = watcher;
    return true;
  }

  close() {
    for (const watcher of Object.values(this.#watchers)) {
      closeWatcher(watcher);
    }
    this.#handler = () => {};
  }
}


/**
 * Watches for a directory move using native (i.e., inode) support. If we watch a path, it changes,
 * but no longer exists where we expect it to be, it's moved.
 */
class NativeMoveWatcher {
  #dir = '';

  /** @type {fs.FSWatcher?} */
  #watcher = null;

  /** @type {(err?: Error) => void} */
  #handler;

  /**
   * @param {string} dir
   * @param {(err?: Error) => void} handler
   */
  constructor(dir, handler) {
    this.#dir = dir;
    this.#handler = handler;
    this.refresh();
  }

  refresh() {
    closeWatcher(this.#watcher);

    const statKey = inodeStatKey(lstatOrNull(this.#dir));
    if (!statKey) {
      // This is an intended failure case, the directory no longer exists.
      this.#handler(new Error(`cannot get inode of dir: ${this.#dir}`));
      return;
    }

    this.#watcher = fs.watch(this.#dir, {recursive: false}, (ev, filename) => {
      // The watcher reports the name of the directory, even though this conflicts with files that
      // are _within_ the directory.
      if (!filename || filename === path.basename(this.#dir) || filename === this.#dir) {
        const checkStatKey = inodeStatKey(lstatOrNull(this.#dir));
        if (checkStatKey !== statKey) {
          this.#handler();
        }
      }
    });
    this.#watcher.on('error', this.#handler);
  }

  close() {
    closeWatcher(this.#watcher);
  }
}


/**
 * Watches for a directory move using non-native support. We look at all parent directories, even
 * across device boundaries, and watch to see if anything moves.
 *
 * We could drop this for macOS and just watch the "location", rather than a specific initial
 * directory.
 */
class FauxMoveWatcher {
  #dir = '';

  /** @type {{part: string, watcher: fs.FSWatcher?, next: string}[]} */
  #watchers = [];

  /** @type {(err?: Error) => void} */
  #handler;

  /**
   * @param {string} dir
   * @param {(err?: Error) => void} handler
   */
  constructor(dir, handler) {
    this.#dir = dir;
    this.#handler = handler;

    let work = dir;

    for (;;) {
      const parent = path.dirname(work);
      if (parent === work) {
        break;
      }
      this.#watchers.unshift({
        part: parent,
        watcher: null,
        next: path.basename(work),
      });
      work = parent;
    }

    this.refresh();
  }

  refresh() {
    const statKey = inodeStatKey(lstatOrNull(this.#dir));
    if (!statKey) {
      // This is an intended failure case, the directory no longer exists.
      this.#handler(new Error(`cannot get inode of dir: ${this.#dir}`));
      return;
    }

    for (const o of this.#watchers) {
      closeWatcher(o.watcher);
      o.watcher = fs.watch(o.part, {recursive: false}, (ev, filename) => {
        if (filename !== o.next) {
          return;
        }

        const checkStatKey = inodeStatKey(lstatOrNull(this.#dir));
        if (checkStatKey !== statKey) {
          this.#handler();
        }
      });
      o.watcher.on('error', this.#handler);
    }
  }

  close() {
    for (const o of this.#watchers) {
      closeWatcher(o.watcher);
    }
  }
}


export const RecursiveWatcher = supportsRecursive ? NativeRecursiveWatcher : FauxRecursiveWatcher;
export const MoveWatcher = inodeDir ? NativeMoveWatcher : FauxMoveWatcher;
