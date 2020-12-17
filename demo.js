#!/usr/bin/env node

import buildWatcher from './lib/index.js';

if (process.argv.length !== 3) {
  console.warn('usage: ./demo.js <path>');
  process.exit(0);
}

const watcher = buildWatcher(process.argv[2], {
  filter(rel) {
    if (rel.startsWith('node_modules/')) {
      return false;
    }
    return true;
  },
});

watcher.on('change', (filename, type, ino) => {
  console.warn(type.toUpperCase(), filename, ino);
});

watcher.on('error', (e) => {
  console.warn('got error', e);
});
