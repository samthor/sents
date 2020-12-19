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

// Create a watcher by passing a directory name ("." for the current dir).
const watcher = buildWatcher('.');

// Type can be 'add', 'change', or 'remove'.
watcher.on('raw', (filename, type, ino) => {
  console.warn(type.toUpperCase(), filename, ino);
});

// If the watcher emits an error, it's no longer usable.
watcher.on('error', (e) => {
  console.warn('got error', e);
});

// Call .close() to shut down the watcher.
setTimeout(() => {
  watcher.close();
}, 60 * 1000);
```

Note that this watches a single _directory_, and directly watching files is not supported.

The only events emitted by `sents` are "ready", "raw", and "error".

# Options

This also supports some options:

```js
const watcher = buildWatcher('.', {
  dotfiles: false,
  filter: (rel) => true,
  delay: undefined,
});
```

* `dotfiles` controls whether files starting with '.' are returned
* `filter` allows filtering of the results (return `true` to include)
  - When directories are passed, they'll end with `path.sep` (i.e., "/" most places); if you filter them, you'll _never_ be asked or notified about their subdirectories
  - This should be a pure function—don't change results over time—otherwise, you're gonna have a bad time
* `delay` allows you to delay change notifications, when unset, this will use microtask resolution (this could be useful if you make lots of tiny changes but want to hide them)

# Notes

On macOS and Windows, watching a whole directory subtree is fairly cheap.
On Linux and other platforms, this package installs a watcher on every subdirectory.
Keep this in mind when building tools using `sents`—be sure to use `filter` to limit what you're watching.

## Ready Check

If you don't want to get all initial updates (i.e., the first scan of files) then you do either of:

```js
await watcher.ready;
watcher.once('ready', () => {...});
```

## Glob Support

This doesn't have glob support or any built-in filtering aside the controls above.
If you want to write a command-line tool or similar, you should build a `filter` function that supports globs.

## Files Only

This package isn't a _file_ watcher, it's a _directory_ watcher.
If you just want to watch a small number of files for changes, be sure to allow them specifically in `filter`, while ignoring all other files or directories.

