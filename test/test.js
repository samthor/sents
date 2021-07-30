import test from 'ava';
import build from '../lib/index.js';
import * as fs from 'fs';
import * as path from 'path';

const cleanup = [];
let rootCount = 0;

test.after(() => {
  cleanup.forEach((c) => c());
});

// Use a known temp dir for all tests. Nuke it before start and then we use random paths inside it.
const {pathname: tmpdir} = new URL('./tmp', import.meta.url);
fs.rmSync(tmpdir, {recursive: true, force: true});
try {
  fs.readdirSync(tmpdir);
  throw new Error('tmpdir should not exist');
} catch (e) {
  // ok
}

class TestWatcherContext {
  #w;
  #root = '';
  #queue = [];

  constructor(root) {
    const queue = [];
  
    this.#root = root;
    this.#queue = queue;

    this.#w = build(root);
    this.#w.on('raw', (filename, type) => {
      queue.push({filename, type});
    });
  }

  cleanup = () => {
    this.#w.close();
  };

  /**
   * @return {Promise<void>}
   */
  get ready() {
    return this.#w.ready;
  }

  /**
   * Clear the queue for next time.
   */
  clear() {
    this.#queue.splice(0, this.#queue.length);
  }

  /**
   * Returns a copy of the queue for checking.
   *
   * @return {{filename: string, type: string}[]}
   */
  get queue() {
    return this.#queue.slice();
  }

  error(handler) {
    this.#w.on('error', handler);
  }

  /**
   * Wait for a number of events to arrive in the queue, or the timeout to hit.
   *
   * @param {number=} size to watch for resolving with true
   * @param {number=} delay to wait resolving with false
   * @return {Promise<boolean>}
   */
  wait(size = 1, delay = 1000) {
    let cleanup;

    const p = new Promise((r) => {
      const checker = () => {
        if (this.#queue.length >= size) {
          r(true);
        }
      };
      setTimeout(() => r(false), delay);

      this.#w.on('raw', checker);
      cleanup = () => this.#w.off('raw', checker);
      checker();
    });

    return p.finally(cleanup);
  }

  /**
   * Find a path in the test folder.
   *
   * @param {string} x
   * @param {...string} rest
   * @return {string}
   */
  t(x, ...rest) {
    return path.join(this.#root, x, ...rest);
  }
}

const createWatcher = async () => {
  // Always use a unique directory as macOS seems to do odd things with literally just deleted
  // folders.
  const root = path.join(tmpdir, `root${++rootCount}_${(Math.random() * 256).toString(16)}`);
  fs.mkdirSync(root, {recursive: true});

  const watcher = new TestWatcherContext(root);
  cleanup.push(watcher.cleanup);
  await watcher.ready;

  // FIXME: macOS needs time to kick its watcher into gear. Can this be put into the library?
  await new Promise(r => setTimeout(r, 100));

  return watcher;
};

test('create folder', async t => {
  const ctx = await createWatcher();

  fs.mkdirSync(ctx.t('blah'));
  await ctx.wait();
  t.deepEqual(ctx.queue, [{type: 'add', filename: `blah${path.sep}`}], 'simple folder creation');
});

test('file doesn\'t have trailing slash', async t => {
  const ctx = await createWatcher();

  fs.writeFileSync(ctx.t('testFile'), 'hi');
  await ctx.wait();
  t.deepEqual(ctx.queue, [{type: 'add', filename: 'testFile'}], 'file is added');
  ctx.clear();

  fs.writeFileSync(ctx.t('testFile'), 'update');
  await ctx.wait();
  t.deepEqual(ctx.queue, [{type: 'change', filename: 'testFile'}], 'file is changed');
  ctx.clear();

  fs.rmSync(ctx.t('testFile'), {force: true});
  await ctx.wait();
  t.deepEqual(ctx.queue, [{type: 'delete', filename: 'testFile'}], 'should delete');
});

test('supports dup files on case-sensitive fs', async t => {
  const ctx = await createWatcher();
  fs.writeFileSync(ctx.t('testFile'), 'hi');

  try {
    fs.statSync(ctx.t('TESTfile'));
    return t.assert(true, 'nothing to do, case-insensitive fs');
  } catch (e) {
    // doesn't exist, test can run
  }

  fs.writeFileSync(ctx.t('testFILE'), 'other file');
  await ctx.wait(2);

  t.deepEqual(ctx.queue, [
    {type: 'add', filename: `testFILE`},
    {type: 'add', filename: `testFile`},
  ], 'should add two files');
});

test('supports hard-link notification', async t => {
  const ctx = await createWatcher();

  fs.writeFileSync(ctx.t('testFile1'), 'hi');
  fs.linkSync(ctx.t('testFile1'), ctx.t('testFile2'));

  await ctx.wait(2);
  t.deepEqual(ctx.queue, [
    {type: 'add', filename: 'testFile1'},
    {type: 'add', filename: 'testFile2'},
  ], 'files are added');
  ctx.clear();

  fs.appendFileSync(ctx.t('testFile2'), '\nand stuff');
  await ctx.wait(2);

  t.deepEqual(ctx.queue, [
    {type: 'change', filename: 'testFile1'},
    {type: 'change', filename: 'testFile2'},
  ], 'files are both changed');
});

test('rename to same but different case', async t => {
  const ctx = await createWatcher();

  fs.mkdirSync(ctx.t('sens_what'));
  await ctx.wait();
  t.deepEqual(ctx.queue, [{type: 'add', filename: `sens_what${path.sep}`}], 'should just add single folder');
  ctx.clear();

  fs.renameSync(ctx.t('sens_what'), ctx.t('SENS_WHAT'));
  await ctx.wait(2);
  t.deepEqual(ctx.queue, [
    {type: 'delete', filename: `sens_what${path.sep}`},
    {type: 'add', filename: `SENS_WHAT${path.sep}`},
  ], 'should add and delete old folder');
});

test('moving folder results in error', async t => {
  const ctx = await createWatcher();

  await new Promise((resolve, reject) => {
    ctx.error(resolve);
    fs.rmdirSync(ctx.t('.'));
    setTimeout(() => reject('timeout'), 1000);
  });
  t.assert(true);
});
