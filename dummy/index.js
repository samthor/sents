import {EventEmitter} from 'events';
import * as path from 'path';
import * as fs from 'fs';
import {RecursiveWatcher, MoveWatcher, inodeStatKey, lstatOrNull} from './helpers.js';
import {MultiMap} from './data.js';
import {performance} from 'perf_hooks';

import * as types from '../types.js';


const allEventName = 'raw';
const yieldScanDelay = 1000.0;


/**
 * @param {?fs.Stats} stat
 * @return {string}
 */
function changeStatKey(stat) {
  if (stat == null) {
    return '';
  }
  return `${stat.ino}-${stat.mtimeMs}-${stat.dev}`;
}


class CorpusWatcher extends EventEmitter {
  #toplevel = '';
  #closed = false;
  #dev = 0;

  /** @type {Promise<any>} */
  #queueTaskPromise = Promise.resolve();
  #queueTaskStart = 0.0;

  /** @type {(name: string) => boolean} */
  #match = (s) => true;

  /** @type {Promise<void>} */
  #ready;

  /** @type {function(string): boolean} */
  #basenameFilter = (f) => f[0] !== '.';

  /** @type {boolean|undefined} */
  #caseSensitive = undefined;

  /** @type {InstanceType<typeof RecursiveWatcher>} */
  #rwatch;

  /** @type {InstanceType<typeof MoveWatcher>} */
  #mwatch;

  /** @type {!Map<string, Map<string, fs.Stats>>} */
  #dirs = new Map();

  /** @type {!MultiMap<string, string>} */
  #inodeMap = new MultiMap();

  /** @type {!Map<string, string[]>} */
  #queuedHandlers = new Map();

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @return {Promise<T>}
   */
  #queueTask = (task) => {
    this.#queueTaskPromise = this.#queueTaskPromise.then(() => {
      this.#queueTaskStart = performance.now();
      return task().catch(this.#shutdown);
    });
    return this.#queueTaskPromise;
  };

  /**
   * @param {string} filename
   * @param {string} type
   * @param {fs.Stats} stat
   */
  #announce = (filename, type, stat) => {
    if (stat.isDirectory()) {
      filename = path.join(filename, path.sep);
    }
    this.emit(allEventName, filename, type, stat.ino);
  };

  /**
   * @param {Error=} error
   */
  #shutdown = (error) => {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (error) {
      this.emit('error', error);
    } else {
      this.emit('close');
    }
    this.#mwatch.close();
    this.#rwatch.close();
  };

  #announceInodeDelete = (rel, stat) => {
    const key = inodeStatKey(stat);
    this.#inodeMap.remove(key, rel);
    this.#announce(rel, 'delete', stat);
  };

  /**
   * Purge a subdirectory from being watched. It's been removed or moved.
   * Reentrant to purge further subdirs.
   *
   * @param {string} subdir
   */
  #purge = (subdir) => {
    const contents = this.#dirs.get(subdir);
    if (contents === undefined) {
      return false;
    }
    this.#rwatch.hint(subdir, true);

    for (const [name, stat] of contents) {
      const filename = path.join(subdir, name);
      this.#purge(filename);
      this.#announceInodeDelete(filename, stat);
    }
    this.#dirs.delete(subdir);
  };

  /**
   * @param {string} cand
   * @param {Map<string, fs.Stats>} contents
   * @return {?string}
   */
  #findCandidateIgnoreCase = (cand, contents) => {
    if (this.#caseSensitive) {
      return null;
    }

    const original = cand;

    cand = cand.toLocaleLowerCase();
    if (cand.toLocaleUpperCase() === cand) {
      return null;  // no case-sensitive parts of this filename
    }

    let foundName = null;
  
    for (const other of contents.keys()) {
      if (other === original) {
        continue;
      }
      if (other.toLocaleLowerCase() === cand) {
        if (foundName) {
          // got multiples
          this.#caseSensitive = true;
          return null;
        }
        foundName = other;
      }
    }

    return foundName;
  };

  #updateChangeInode = (stat) => {
    if (stat === null) {
      return;
    }
    const key = inodeStatKey(stat);

    const all = this.#inodeMap.all(key);
    all.forEach((rel) => {
      this.#announce(rel, 'change', stat);
    });
  };

  /**
   * Update a single entry, file or directory, with its new stat (and without recursing). Announces
   * the relevant change if any was made.
   *
   * @param {string} rel
   * @param {fs.Stats?} stat
   * @return {boolean} whether there was an update
   */
  #updateEntry = (rel, stat) => {
    const dirname = path.dirname(rel);
    const basename = path.basename(rel);
    const contents = this.#dirs.get(dirname);
    if (contents === undefined) {
      throw new Error(`#updateEntry can't update where dir does not yet exist`);
    }
    const prev = contents.get(basename) ?? null;

    // We can't find the stat. It's probably removed.
    if (stat === null) {
      if (prev === null) {
        return false;  // why are we here?
      }
      contents?.delete(basename);
      this.#announceInodeDelete(rel, prev);
      return true;
    }

    // We have an update. Check if this was just a file change...
    contents.set(basename, stat);
    if (prev !== null) {
      const definitelyChanged = inodeStatKey(prev) !== inodeStatKey(stat);
      if (!definitelyChanged) {
        // Don't announce mtime changes for directories. We don't seem to get
        // them all the time so it doesn't make sense to announce them.
        if (stat.isDirectory()) {
          return false;
        }

        // Now we just check the mtime to see if something changed.
        if (changeStatKey(prev) !== changeStatKey(stat)) {
          this.#updateChangeInode(stat);
          return true;
        }
        return false;
      }

      // This was actually a deletion and recreation. Continue below.
      this.#announceInodeDelete(rel, prev);
    }

    // Or a whole addition.
    this.#inodeMap.set(inodeStatKey(stat), rel);
    do {
      const check = this.#findCandidateIgnoreCase(basename, contents);
      if (check === null) {
        break; // nothing case-insensitive to compare to right now
      }

      // If we don't yet know whether we're case-sensitive, then try to find out.
      if (this.#caseSensitive === undefined) {
        const checkStat = contents.get(check) ?? null;
        if (inodeStatKey(stat) !== inodeStatKey(checkStat)) {
          this.#caseSensitive = true;  // two files, same insensitive name, different!
          break;
        }
        const all = fs.readdirSync(path.join(this.#toplevel, dirname));
        this.#caseSensitive = all.includes(check);
      }

      // We probably don't get notified about the case-insensitive other file going away.
      // This might 'win' but then the deletion won't make noise anyway.
      if (this.#caseSensitive === false) {
        contents.delete(check);
        const previousRel = path.join(dirname, check);
        this.#announceInodeDelete(previousRel, stat);
      }
    } while (false);

    this.#announce(rel, 'add', stat);
    return true;
  };

  /**
   * Scan a subdirectory. Reentrant to scan subdirs.
   *
   * @param {string} rel
   */
  #scan = async (rel) => {
    if (this.#queueTaskStart + yieldScanDelay < performance.now()) {
      // Yield to other tasks, since we're taking a long time.
      await new Promise((r) => setImmediate(r));
      this.#queueTaskStart = performance.now();  // maybe the user did something long, get new time
    }

    this.#rwatch.hint(rel);
    const all = fs.readdirSync(path.join(this.#toplevel, rel));

    // Filter the entries we can legitmately stat.
    const rawEntries = all
        .filter(this.#basenameFilter)
        .map((name) => {
          const target = path.join(this.#toplevel, rel, name);
          return {name, stat: lstatOrNull(target)};
        })
        .filter(({name, stat}) => {
          if (stat === null || stat.dev !== this.#dev) {
            return false;
          }
          let request = path.join(rel, name);
          if (stat.isDirectory()) {
            request = path.join(request, path.sep);
          }
          return this.#match(request);
        });

    // TS doesn't know that stat will be non-null at this point.
    const entries = /** @type {{name: string, stat: fs.Stats}[]} */ (rawEntries);

    // Grab contents and maintain keys to announce deletions later.
    let contents = this.#dirs.get(rel);
    if (contents === undefined) {
      contents = new Map();
      this.#dirs.set(rel, contents);
    }
    const prev = new Set(contents.keys());

    for (const {name, stat} of entries) {
      const subrel = path.join(rel, name);
      this.#updateEntry(subrel, stat);
      if (stat.isDirectory() && stat.dev === this.#dev) {
        await this.#scan(subrel);
      } else if (stat.isSymbolicLink()) {
        // TODO: what do we do here? nothing?
      }
      prev.delete(name);
    }

    // Directory moves aren't atomic, but announce any remaining keys here anyway.
    for (const name of prev) {
      const filename = path.join(rel, name);
      this.#announceInodeDelete(filename, contents.get(name));
    }
  };

  /**
   * @param {string} reldir
   * @param {string[]} queue
   */
  #delayHandler = async (reldir, queue) => {
    if (!this.#dirs.has(reldir)) {
      return false;  // possible to be deleted since queue
    }
    if (queue.length >= 2) {
      return this.#scan(reldir);
    }

    for (;;) {
      const curr = queue.shift();
      if (curr === undefined) {
        break;
      }
      const cand = path.join(reldir, curr);

      const stat = lstatOrNull(path.join(this.#toplevel, reldir, curr));
      if (!this.#updateEntry(cand, stat)) {
        continue;  // nothing changed
      }

      if (stat === null) {
        // Is this a directory we know about? If so, purge it all.
        if (this.#dirs.has(cand)) {
          this.#purge(cand);
        }
      } else {
        if (stat.isDirectory()) {
          await this.#scan(cand);
        }
      }
    }
  };

  /**
   * File change handler for this directory. Called by the recursive watchers or by individual
   * watchers on some platforms.
   *
   * @param {string?} rel
   * @param {Error|undefined} error
   */
  #sharedHandler = async (rel, error) => {
    if (error || rel === null) {
      throw error;
    }
    const basename = path.basename(rel);
    if (!this.#basenameFilter(basename)) {
      return false;
    }
    if (!this.#match(rel)) {
      return false;
    }

    const dirname = path.dirname(rel);
    if (!this.#dirs.has(dirname)) {
      // This is an out-of-order file. Ignore it since we'll be told about the directory soon (?).
      // This might also be a recursive callback when we're ignoring a subfolder.
      // TODO: is this possible, events out of order?
      return false;
    }

    const checkQueue = this.#queuedHandlers.get(dirname);
    const queue = checkQueue ?? [];
    if (checkQueue === undefined) {
      this.#queuedHandlers.set(dirname, queue);

      this.#delay(() => {
        if (this.#closed) {
          return;
        }
        this.#queuedHandlers.delete(dirname);
        this.#delayHandler(dirname, queue);
      });
    }
    queue.push(basename);
    return true;
  };

  /**
   * @param {function(): void} handler
   */
  #delay = (handler) => {
    Promise.resolve().then(handler);
  };

  /**
   * Notification of the watched folder's move or replacement.
   *
   * @param {Error|undefined} error
   */
  #moveHandler = async (error) => {
    if (error) {
      throw error;
    }

    // This can only be atomic if we're watching a symlink and it was atomically replaced, which
    // is only possible on some platforms _anyway_.
    this.#mwatch.refresh();
    return this.#scan('.');
  };

  /**
   * @param {string} toplevel
   * @param {Partial<types.CorpusOptions>} partialOptions
   */
  constructor(toplevel, partialOptions) {
    super();

    /** @type {types.CorpusOptions} */
    const options = Object.assign({
      dotfiles: false,
      filter: () => true,
      delay: -1,
    }, partialOptions);

    // You can set a custom delay rather than using a microtask.
    if (options.delay >= 0) {
      this.#delay = (handler) => {
        setTimeout(handler, options.delay);
      };
    }

    // macOS needs us to resolve this otherwise not all events will arrive.
    // Also ensure that it ends with a slash: we can only observe directories.
    toplevel = path.join(path.resolve(toplevel), path.sep);

    // The default value for this filters including dotfiles.
    if (options.dotfiles) {
      this.#basenameFilter = (f) => (f !== '.' && f !== '..');
    }

    this.#match = options.filter;
    this.#toplevel = toplevel;

    const stat = fs.lstatSync(this.#toplevel);
    this.#dev = stat.dev;

    /**
     * Wraps a call in the queue + microtask.
     *
     * @param {(...args: any[]) => any} fn
     * @return {(...args: any[]) => any}
     */
    const wrap = (fn) => {
      return (...args) => {
        this.#queueTask(() => Promise.resolve(fn(...args)));
      };
    };
    this.#sharedHandler = wrap(this.#sharedHandler);
    this.#moveHandler = wrap(this.#moveHandler);
    this.#delayHandler = wrap(this.#delayHandler);

    this.#rwatch = new RecursiveWatcher(toplevel, this.#sharedHandler);
    this.#mwatch = new MoveWatcher(toplevel, this.#moveHandler);

    this.#ready = this.#queueTask(async () => {
      await new Promise((r) => setImmediate(r));
      if (this.#closed) {
        throw new Error(`closed before ready`);
      }
      await this.#scan('.');
    });

    this.#ready
      .then(() => this.emit('ready'))
      .catch((err) => this.emit('error', err));
  }

  /**
   * @return {!Promise<void>}
   */
  get ready() {
    return this.#ready;
  }

  /**
   * Shuts down the resources for this Watcher.
   */
  close() {
    this.#shutdown();
  }
}

/**
 * @param {string} toplevel
 * @param {Partial<types.CorpusOptions>=} options
 * @return {types.CorpusWatcher}
 */
export default function watcher(toplevel, options = {}) {
  return new CorpusWatcher(toplevel, options);
}


