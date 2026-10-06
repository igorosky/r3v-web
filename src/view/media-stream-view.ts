import { State } from '../listeners.js';
import type { StreamState, StreamStatus, StreamStatusListener } from '../types.js';

/** Manages presentation and consumer intent, never ownership of MediaStream tracks. */
export class MediaStreamView {
  readonly #video: HTMLVideoElement;
  readonly #status: State<StreamStatus>;
  readonly #mediaEvents = new AbortController();
  #streamEvents: AbortController | undefined;
  #trackEvents: AbortController | undefined;
  #stream: MediaStream | null = null;
  #active: boolean;
  #destroyed = false;
  #generation = 0;

  constructor(video: HTMLVideoElement, active: boolean) {
    this.#video = video;
    this.#active = active;
    this.#status = new State<StreamStatus>(Object.freeze({ state: 'idle', active, error: null }));

    const signal = this.#mediaEvents.signal;
    video.addEventListener('playing', () => this.#playing(), { signal });
    video.addEventListener('loadedmetadata', () => {
      if (this.#isCurrent() && video.paused && this.#status.value.state === 'waiting') this.#refresh();
    }, { signal });
    for (const event of ['waiting', 'stalled']) {
      video.addEventListener(event, () => {
        if (this.#isCurrent() && !video.paused) this.#publish('waiting');
      }, { signal });
    }
    video.addEventListener('ended', () => {
      if (this.#isCurrent() && video.ended) this.#publish('ended');
    }, { signal });
    video.addEventListener('error', () => {
      if (this.#isCurrent() && video.error) {
        this.#publish('error', { name: 'MediaError', message: video.error.message || `Media error ${video.error.code}` });
      }
    }, { signal });
  }

  get status(): StreamStatus { return this.#status.value; }

  onStatus(listener: StreamStatusListener): () => void {
    this.#assertAlive();
    return this.#status.subscribe(listener);
  }

  setStream(stream: MediaStream): void {
    this.#assertAlive();
    if (!stream || typeof stream.getVideoTracks !== 'function') {
      throw new TypeError('setStream expects a MediaStream.');
    }
    // Assignment uses the browser's native MediaStream validation, including other realms.
    this.#video.srcObject = stream;
    this.#generation += 1;
    this.#streamEvents?.abort();
    this.#stream = stream;
    this.#streamEvents = new AbortController();
    const refresh = () => { this.#bindTracks(); this.#refresh(); };
    for (const event of ['addtrack', 'removetrack', 'inactive']) {
      stream.addEventListener(event, refresh, { signal: this.#streamEvents.signal });
    }
    this.#bindTracks();
    this.#refresh();
  }

  pause(): void {
    this.#assertAlive();
    this.#active = false;
    this.#generation += 1;
    this.#video.pause();
    this.#publish('paused');
  }

  resume(): void {
    this.#assertAlive();
    if (this.#active && this.#status.value.state === 'playing') return;
    this.#active = true;
    this.#refresh();
  }

  clearView(): void {
    this.#assertAlive();
    this.#generation += 1;
    this.#streamEvents?.abort();
    this.#trackEvents?.abort();
    this.#stream = null;
    this.#active = false;
    this.#video.pause();
    this.#video.srcObject = null;
    this.#video.load();
    this.#publish('idle');
  }

  /** Detaches the source without stopping the application's tracks. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#active = false;
    this.#generation += 1;
    this.#mediaEvents.abort();
    this.#streamEvents?.abort();
    this.#trackEvents?.abort();
    this.#stream = null;
    this.#video.pause();
    this.#video.srcObject = null;
    this.#publish('destroyed');
    this.#status.close();
  }

  #bindTracks(): void {
    this.#trackEvents?.abort();
    this.#trackEvents = new AbortController();
    for (const track of this.#stream?.getVideoTracks() ?? []) {
      for (const event of ['ended', 'mute', 'unmute']) {
        track.addEventListener(event, () => this.#refresh(), { signal: this.#trackEvents.signal });
      }
    }
  }

  #refresh(): void {
    if (this.#destroyed) return;
    if (!this.#active) {
      this.#video.pause();
      this.#publish('paused');
      return;
    }
    if (!this.#stream) { this.#publish('idle'); return; }
    const tracks = this.#stream.getVideoTracks();
    if (tracks.length && tracks.every((track) => track.readyState === 'ended')) {
      this.#generation += 1;
      this.#video.pause();
      this.#publish('ended');
      return;
    }

    const generation = ++this.#generation;
    this.#publish('waiting');
    // A synchronous status callback may pause, replace the source, or destroy the viewer.
    if (!this.#isCurrent(generation) || !tracks.some((track) => track.readyState === 'live')) return;
    try {
      void this.#video.play().then(() => {
        if (this.#isCurrent(generation)) this.#playing();
      }).catch((error: unknown) => {
        if (!this.#isCurrent(generation)) return;
        const detail = error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error)
          ? { name: String(error.name), message: 'message' in error ? String(error.message) : 'Unable to start stream' }
          : { name: 'Error', message: String(error) };
        this.#publish(detail.name === 'NotAllowedError' ? 'blocked' : 'error', detail);
      });
    } catch (error) {
      if (this.#isCurrent(generation)) this.#publish('error', { name: 'Error', message: String(error) });
    }
  }

  #playing(): void {
    if (
      this.#isCurrent() && !this.#video.paused && this.#video.readyState >= 2 &&
      this.#stream?.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted)
    ) this.#publish('playing');
  }

  #isCurrent(generation = this.#generation): boolean {
    return !this.#destroyed && this.#active && generation === this.#generation &&
      this.#stream !== null && this.#video.srcObject === this.#stream;
  }

  #publish(state: StreamState, error: StreamStatus['error'] = null): void {
    const current = this.#status.value;
    if (state === current.state && this.#active === current.active && error === current.error) return;
    this.#status.set(Object.freeze({ state, active: this.#active, error: error ? Object.freeze(error) : null }));
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('The viewer has been destroyed.');
  }
}
