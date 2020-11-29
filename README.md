This is a filesystem watcher that just uses `fs.watch` and friends (i.e., no polling).

# Features

* Zero dependencies 🍩
* Supports macOS, Linux, Windows (and probably others) via the same API and no native code
* Supports hard links (announces changes to all matching inodes)

# Usage

```js
import buildWatcher from 'sents';

const watcher = buildWatcher('.');

watcher.on('change', (filename, type, ino) => {
  console.warn(type.toUpperCase(), filename, ino);
});

watcher.on('error', (e) => {
  console.warn('got error', e);
});

// call .close to release resources
setTimeout(() => {
  watcher.close();
}, 60 * 1000);

```

# Caveats

- This will only watch the same filesystem as the target.
  For example, on macOS, watching "/Volumes" will not contain your external volumes.

- This does not follow symlinks.
  Do that yourself.

- Sents will only watch the original directory.
  If it moves or is renamed, Sents will probably crash.

- Don't use this on a network volume.
