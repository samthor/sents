import test from 'ava';
import build from '../lib/index.js';
import fs from 'fs';
import path from 'path';

const {pathname: tmpdir} = new URL('./tmp', import.meta.url);

const wait = async (timeout = 0) => {
  await new Promise((r) => setTimeout(r, timeout));
  await new Promise((r) => setImmediate(r));
};

const cleanup = [];
let rootCount = 0;

test.after(() => {
  cleanup.forEach((c) => c());
});

fs.rmSync(tmpdir, {recursive: true, force: true});
try {
  fs.readdirSync(tmpdir);
  throw new Error('tmpdir should not exist');
} catch (e) {
  // ok
}

const createWatcher = () => {
  // Always use a unique directory as macOS seems to do odd things with literally just deleted
  // folders.
  const root = path.join(tmpdir, `root${++rootCount}_${(Math.random() * 256).toString(16)}`);
  fs.mkdirSync(root, {recursive: true});

  const queue = [];
  const w = build(root);
  w.on('change', (filename, type) => queue.push({filename, type}));

  cleanup.push(() => w.close());

  return {root, w, queue};
}

test('create folder', async t => {
  const {queue, root} = createWatcher();

  fs.mkdirSync(path.join(root, 'blah'));
  await wait();
  t.deepEqual(queue, [{type: 'add', filename: `blah${path.sep}`}]);
});

test('file doesn\'t have trailing slash', async t => {
  const {queue, root} = createWatcher();

  fs.writeFileSync(path.join(root, 'testFile'), 'hi');
  await wait();
  t.deepEqual(queue, [{type: 'add', filename: 'testFile'}], 'file is added');
  queue.splice(0, queue.length);

  fs.writeFileSync(path.join(root, 'testFile'), 'update');
  await wait(100);
  t.deepEqual(queue, [{type: 'change', filename: 'testFile'}], 'file is changed');
  queue.splice(0, queue.length);

  fs.rmSync(path.join(root, 'testFile'), {force: true});
  await wait(100);
  t.deepEqual(queue, [{type: 'delete', filename: 'testFile'}], 'should delete');
});

test('supports dup files on case-sensitive fs', async t => {
  const {queue, root} = createWatcher();
  fs.writeFileSync(path.join(root, 'testFile'), 'hi');

  try {
    fs.statSync(path.join(root, 'TESTfile'));
    return t.assert(true, 'nothing to do, case-insensitive fs');
  } catch (e) {
    // doesn't exist, test can run
  }

  fs.writeFileSync(path.join(root, 'testFILE'), 'other file');
  await wait();

  t.deepEqual(queue, [
    {type: 'add', filename: `testFile`},
    {type: 'add', filename: `testFILE`},
  ], 'should add two files');
});

test('supports hard-link notification', async t => {
  const {queue, root} = createWatcher();

  fs.writeFileSync(path.join(root, 'testFile1'), 'hi');
  fs.linkSync(path.join(root, 'testFile1'), path.join(root, 'testFile2'));

  await wait();
  t.deepEqual(queue, [
    {type: 'add', filename: 'testFile1'},
    {type: 'add', filename: 'testFile2'},
  ], 'files are added');
  queue.splice(0, queue.length);

  fs.appendFileSync(path.join(root, 'testFile2'), '\nand stuff');
  await wait(100);

  const expected = [
    {type: 'change', filename: 'testFile1'},
    {type: 'change', filename: 'testFile2'},
  ];
  if (queue.length === 4) {
    // Sometimes the event arrives twice.
    expected.push(...expected);
  }
  t.deepEqual(queue, expected, 'files are both changed');
});

test('rename to same but different case', async t => {
  const {queue, root} = createWatcher();

  fs.mkdirSync(path.join(root, 'sens_what'));
  await wait();
  t.deepEqual(queue, [{type: 'add', filename: `sens_what${path.sep}`}], 'should just add single folder');
  queue.splice(0, queue.length);

  fs.renameSync(path.join(root, 'sens_what'), path.join(root, 'SENS_WHAT'));
  await wait(100);
  t.deepEqual(queue, [
    {type: 'delete', filename: `sens_what${path.sep}`},
    {type: 'add', filename: `SENS_WHAT${path.sep}`},
  ], 'should add and delete old folder');
});
