export type Listener<T> = (value: T) => void;

/**
 * Delivers events to subscribers in emission order: a value emitted by a listener waits until
 * the current one has reached every listener. A throwing listener is reported like a failing
 * event handler (console and the window `error` event) instead of interrupting the others.
 */
export class Listeners<T> {
  readonly #listeners = new Set<Listener<T>>();
  readonly #queue: T[] = [];
  #delivering = false;
  #closed = false;

  subscribe(listener: Listener<T>): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  emit(value: T): void {
    if (this.#closed) return;
    this.#queue.push(value);
    if (this.#delivering) return;
    this.#delivering = true;
    // The iterator also reaches values that listeners append while it runs.
    for (const queued of this.#queue) {
      // oxlint-disable-next-line unicorn/no-useless-spread -- listeners added during delivery must not receive this value
      for (const listener of [...this.#listeners]) {
        if (this.#listeners.has(listener)) deliver(listener, queued);
      }
    }
    this.#queue.length = 0;
    this.#delivering = false;
    if (this.#closed) this.#listeners.clear();
  }

  /** Delivers values already emitted, then removes all listeners and ignores later emits. */
  close(): void {
    this.#closed = true;
    if (!this.#delivering) this.#listeners.clear();
  }
}

/**
 * A value with change listeners. The value changes at once, while delivery follows emission
 * order, so a listener's argument may briefly be older than `value`.
 */
export class State<T> {
  readonly #listeners = new Listeners<T>();
  #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  get value(): T { return this.#value; }

  set(value: T): void {
    this.#value = value;
    this.#listeners.emit(value);
  }

  /** Adds a listener and delivers the current value to it immediately. */
  subscribe(listener: Listener<T>): () => void {
    const unsubscribe = this.#listeners.subscribe(listener);
    deliver(listener, this.#value);
    return unsubscribe;
  }

  close(): void { this.#listeners.close(); }
}

function deliver<T>(listener: Listener<T>, value: T): void {
  try { listener(value); }
  catch (error) { reportError(error); }
}
