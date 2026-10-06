import { State } from '../listeners.js';
import type { RgbaFrame, StreamState, StreamStatus, StreamStatusListener } from '../types.js';

/**
 * Presentation status and consumer intent for a canvas. Frames are either drawn here from RGBA
 * buffers or drawn by the renderer itself and reported with `framePresented()`.
 */
export class CanvasView {
  readonly #canvas: HTMLCanvasElement;
  readonly #status: State<StreamStatus>;
  /** Acquired on the first drawn frame, so a renderer may take a WebGL/WebGPU context instead. */
  #context: CanvasRenderingContext2D | undefined;
  #active: boolean;
  #hasFrame = false;
  #destroyed = false;

  constructor(canvas: HTMLCanvasElement, active: boolean) {
    this.#canvas = canvas;
    this.#active = active;
    this.#status = new State<StreamStatus>(Object.freeze({ state: 'idle', active, error: null }));
  }

  get status(): StreamStatus { return this.#status.value; }

  onStatus(listener: StreamStatusListener): () => void {
    this.#assertAlive();
    return this.#status.subscribe(listener);
  }

  showFrame(frame: RgbaFrame): void {
    this.#assertAlive();
    const pixels = framePixels(frame);
    // Frames still in flight after pause() are not presented, like a paused video.
    if (!this.#active) return;
    const context = this.#context2d();
    if (this.#canvas.width !== frame.width) this.#canvas.width = frame.width;
    if (this.#canvas.height !== frame.height) this.#canvas.height = frame.height;
    context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
    this.#presented();
  }

  framePresented(): void {
    this.#assertAlive();
    if (this.#active) this.#presented();
  }

  pause(): void {
    this.#assertAlive();
    this.#active = false;
    this.#publish('paused');
  }

  resume(): void {
    this.#assertAlive();
    if (this.#active && this.#status.value.state === 'playing') return;
    this.#active = true;
    this.#publish(this.#hasFrame ? 'waiting' : 'idle');
  }

  /** Clears frames drawn by the view; a renderer-owned context is left alone. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#active = false;
    this.#context?.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#publish('destroyed');
    this.#status.close();
  }

  #presented(): void {
    this.#hasFrame = true;
    this.#publish('playing');
  }

  #context2d(): CanvasRenderingContext2D {
    if (this.#context) return this.#context;
    let context: CanvasRenderingContext2D | null = null;
    try { context = this.#canvas.getContext('2d'); }
    catch { /* Transferred to an OffscreenCanvas. */ }
    if (!context) {
      throw new Error('The renderer draws on this canvas itself; report its frames with framePresented().');
    }
    return (this.#context = context);
  }

  #publish(state: StreamState): void {
    const current = this.#status.value;
    if (state === current.state && this.#active === current.active) return;
    this.#status.set(Object.freeze({ state, active: this.#active, error: null }));
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('The viewer has been destroyed.');
  }
}

function framePixels({ width, height, data }: RgbaFrame): Uint8ClampedArray<ArrayBuffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError('Frame width and height must be positive integers.');
  }
  if (!(data instanceof Uint8ClampedArray || data instanceof Uint8Array)) {
    throw new TypeError('Frame data must be a Uint8ClampedArray or Uint8Array.');
  }
  if (data.length !== width * height * 4) {
    throw new TypeError(`RGBA frame data must be width * height * 4 = ${width * height * 4} bytes.`);
  }
  // ImageData rejects shared memory (e.g. threaded WASM), so that case costs one copy.
  if (typeof SharedArrayBuffer !== 'undefined' && data.buffer instanceof SharedArrayBuffer) {
    return Uint8ClampedArray.from(data);
  }
  return new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}
