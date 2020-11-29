import test from 'ava';
import build from '../lib/index.js';
import fs from 'fs';
import path from 'path';

const {pathname: root} = new URL('./tmp', import.meta.url);

let w;
const queue = [];

test.beforeEach(() => {
  if (w) {
    w.close();
  }

  fs.rmdirSync(root, {recursive: true});
  fs.mkdirSync(root, {recursive: true});
  queue.splice(0, queue.length);

  w = build(root);
  w.on('change', (filename, type) => {
    queue.push({filename, type});
  });
});

test('create folder', async t => {
  fs.mkdirSync(path.join(root, 'blah'));
  await new Promise((r) => setTimeout(r, 0));

  // TODO: queue update event

  t.deepEqual(queue, [{type: 'add', filename: 'blah'}]);
});