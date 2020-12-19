
import * as events from 'events';

export interface CorpusOptions {
  dotfiles?: boolean;
  filter?: (name: string) => boolean;
  delay?: number;
}

export class CorpusWatcher extends events.EventEmitter {
  /**
   * Resolved after an initial scan is complete. This can throw if the path was invalid.
   */
  ready: Promise<void>;

  /**
   * Shuts down the resources for this Watcher.
   */
  close(): void;

  addListener(event: 'ready', listener: () => void): this;
  addListener(event: 'raw', listener: (eventType: string, name: string, ino: number) => void): this;
  addListener(event: 'error', listener: (error: Error) => void): this;

  on(event: 'ready', listener: () => void): this;
  on(event: 'raw', listener: (eventType: string, name: string, ino: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;

  once(event: 'ready', listener: () => void): this;
  once(event: 'raw', listener: (eventType: string, name: string, ino: number) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;

  prependListener(event: 'ready', listener: () => void): this;
  prependListener(event: 'raw', listener: (eventType: string, name: string, ino: number) => void): this;
  prependListener(event: 'error', listener: (error: Error) => void): this;

  prependOnceListener(event: 'ready', listener: () => void): this;
  prependOnceListener(event: 'raw', listener: (eventType: string, name: string, ino: number) => void): this;
  prependOnceListener(event: 'error', listener: (error: Error) => void): this;
}

/**
 * Create a new watcher targeting the specified folder.
 * 
 * @param toplevel to watch
 * @param options options including filter
 */
export default function watcher(toplevel: string, options?: CorpusOptions): CorpusWatcher;
