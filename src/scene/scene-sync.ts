import { Listeners, State } from '../listeners.js';
import type {
  SceneError, SceneErrorListener, SceneSnapshot, SceneState, SceneStateListener, ViewerCommand,
} from '../types.js';

interface Entry {
  readonly id: string;
  readonly label: string;
  /** Always the value reported by the renderer. */
  readonly visible: boolean;
  requested: boolean | null;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Mirrors renderer-owned scene visibility. A request stays pending until the next renderer
 * snapshot, which replaces the whole state whatever its values, or until it times out.
 */
export class SceneSync {
  readonly #timeout: number;
  readonly #send: (command: ViewerCommand) => void;
  readonly #state = new State<SceneState>(Object.freeze({ elements: Object.freeze([]) }));
  readonly #errors = new Listeners<SceneError>();
  #entries = new Map<string, Entry>();
  #destroyed = false;

  constructor(timeout: number, send: (command: ViewerCommand) => void) {
    this.#timeout = timeout;
    this.#send = send;
  }

  get state(): SceneState { return this.#state.value; }

  onChange(listener: SceneStateListener): () => void {
    this.#assertAlive();
    return this.#state.subscribe(listener);
  }

  onError(listener: SceneErrorListener): () => void {
    this.#assertAlive();
    return this.#errors.subscribe(listener);
  }

  update(snapshot: SceneSnapshot): void {
    this.#assertAlive();
    const elements: unknown = snapshot?.elements;
    if (!Array.isArray(elements)) throw new TypeError('updateScene expects { elements: [...] }.');
    const entries = new Map<string, Entry>();
    for (const element of elements as unknown[]) {
      const { id, label, visible } = (element ?? {}) as Record<string, unknown>;
      if (typeof id !== 'string' || !id || typeof label !== 'string' || typeof visible !== 'boolean') {
        throw new TypeError('Scene elements need a non-empty string id, a string label and a boolean visible.');
      }
      if (entries.has(id)) throw new TypeError(`Duplicate scene element id: ${id}`);
      entries.set(id, { id, label, visible, requested: null, timer: undefined });
    }

    for (const entry of this.#entries.values()) clearTimeout(entry.timer);
    this.#entries = entries;
    this.#publish();
  }

  setVisibility(id: string, visible: boolean): void {
    this.#assertAlive();
    if (typeof visible !== 'boolean') throw new TypeError('setVisibility expects a boolean.');
    const entry = this.#entries.get(id);
    if (!entry) throw new RangeError(`Unknown scene element: ${id}`);

    // Always sent, even when matching `visible` or `requested`: the mirror may be stale.
    // A different value replaces the pending request; either way the timeout restarts.
    clearTimeout(entry.timer);
    entry.requested = visible;
    entry.timer = setTimeout(() => this.#expire(entry), this.#timeout);
    this.#publish();
    // A listener may destroy the viewer or answer synchronously (e.g. a local renderer).
    if (!this.#destroyed) this.#send({ type: 'setVisibility', id, visible });
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const entry of this.#entries.values()) clearTimeout(entry.timer);
    this.#state.close();
    this.#errors.close();
  }

  #expire(entry: Entry): void {
    if (this.#destroyed || this.#entries.get(entry.id) !== entry) return;
    entry.timer = undefined;
    entry.requested = null;
    this.#publish();
    this.#errors.emit(Object.freeze({ id: entry.id, reason: 'timeout' }));
  }

  #publish(): void {
    const elements = [...this.#entries.values()].map(({ id, label, visible, requested }) =>
      Object.freeze({ id, label, visible, requested }));
    this.#state.set(Object.freeze({ elements: Object.freeze(elements) }));
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('The viewer has been destroyed.');
  }
}
