Filesystem watcher that uses `fs.watch` and friends (i.e., no polling).
This is the library—check out [sents-cli](https://npmjs.com/package/sents-cli) to use this on the command-line.

# Features

* Zero dependencies 🍩
* Supports macOS, Linux, Windows (and probably others) via the same API and no native code
* Supports hard links (announces changes to all matching inodes)
* Handles case-insensitive filesystems ("foo" => "FOO" is announced)

It does not support some features:

* Following symlinks
* Watching across volumes
* And it should not be used on network shares (they typically need polling)

# Usage

Basic usage:

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

This also supports some options:

```js
const watcher = buildWatcher('.', {
  dotfiles: false,
  filter: (rel) => true,
});
```

* `dotfiles` controls whether files starting with '.' are returned
* `filter` allows filtering of the results (`true` means include)
  - Directories are passed with a trailing slash; if filtered, their subdirectories won't appear
  - This should be a pure function (i.e., don't change results over time) or you'll have a bad time

If you used Sents inside a command-line tool, you might provide a glob and its matcher code to `filter` to make it user-friendly.
You could also make it support e.g., the contents of `.gitignore` (but make sure it doesn't change over time).

# Caveats

Sents will only watch the original directory.
If it moves or is renamed, Sents will probably fail.
