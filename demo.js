#!/usr/bin/env node

import buildWatcher from './lib/index.js';

let target = '.';

if (process.argv.length === 3) {
  target = process.argv[2];
}

const watcher = buildWatcher(target, {
  filter(rel) {
    if (rel.startsWith('node_modules/')) {
      return false;
    }
    return true;
  },
  delay: 1000,
});

watcher.on('raw', (filename, type, ino) => {
  console.warn(type.toUpperCase(), filename, ino);
});

watcher.on('error', (e) => {
  console.warn('got error', e);
});
