
import * as events from 'events';

export interface CorpusOptions {
  signal: AbortSignal;

  /**
   * Whether to include dotfiles.
   *
   * @default false
   */
  dotfiles: boolean;

  /**
   * What files or directories (passed ending with '/') to include. This should be stable; don't
   * change results over time. Default includes all.
   */
  filter: (name: string) => boolean;

  /**
   * How long, if any, to delay callbacks by (helps to aggregate fast changes). Negative to use
   * a microtask only.
   *
   * @default -1
   */
  delay: number;
}

export class CorpusWatcher extends events.EventEmitter {
  /**
   * Resolved after an initial scan is complete. This can throw if the path was invalid.
   */
  readonly ready: Promise<void>;

  /**
   * Shuts down the resources for this Watcher.
   */
  close(): void;

  addListener(event: 'ready', listener: () => void): this;
  addListener(event: 'raw', listener: (name: string, eventType: string, ino: number) => void): this;
  addListener(event: 'error', listener: (error: Error) => void): this;

  on(event: 'ready', listener: () => void): this;
  on(event: 'raw', listener: (name: string, eventType: string, ino: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;

  once(event: 'ready', listener: () => void): this;
  once(event: 'raw', listener: (name: string, eventType: string, ino: number) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;

  prependListener(event: 'ready', listener: () => void): this;
  prependListener(event: 'raw', listener: (name: string, eventType: string, ino: number) => void): this;
  prependListener(event: 'error', listener: (error: Error) => void): this;

  prependOnceListener(event: 'ready', listener: () => void): this;
  prependOnceListener(event: 'raw', listener: (name: string, eventType: string, ino: number) => void): this;
  prependOnceListener(event: 'error', listener: (error: Error) => void): this;
}

/**
 * Create a new watcher targeting the specified folder.
 * 
 * @param toplevel to watch
 * @param options options including filter
 */
export default function watcher(toplevel: string, options?: Partial<CorpusOptions>): CorpusWatcher;
