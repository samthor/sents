#!/usr/bin/env node

import buildWatcher from './lib/index.js';


const watcher = buildWatcher(process.argv[2], {
  filter(rel) {
    if (rel.startsWith('node_modules/')) {
      return false;
    }
    console.debug('?', rel);
    return true;
  },
});

watcher.on('change', (filename, type, ino) => {
  console.warn(type.toUpperCase(), filename, ino);
});

watcher.on('error', (e) => {
  console.warn('got error', e);
});
