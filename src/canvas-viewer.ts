import { CanvasView } from './view/canvas-view.js';
import { Viewer } from './viewer.js';
import type { RgbaFrame, StreamStatus, StreamStatusListener, ViewerOptions } from './types.js';

/**
 * Presents a renderer running in the page (e.g. WASM) on a developer-owned canvas. The viewer
 * takes no canvas context until `showFrame()`, so the renderer may draw on the canvas itself.
 */
export class CanvasViewer extends Viewer {
  /** The developer-owned canvas the viewer presents on. */
  readonly canvas: HTMLCanvasElement;
  readonly #view: CanvasView;

  constructor(canvas: HTMLCanvasElement, options: ViewerOptions = {}) {
    super(canvasElement(canvas), options, () => [canvas.width, canvas.height]);
    this.canvas = canvas;
    this.#view = new CanvasView(canvas, options.active ?? true);
  }

  get status(): StreamStatus { return this.#view.status; }

  onStatus(listener: StreamStatusListener): () => void { return this.#view.onStatus(listener); }

  pause(): void { this.#view.pause(); }

  resume(): void { this.#view.resume(); }

  /**
   * Draws a CPU-rendered RGBA frame and resizes the canvas to it. Frames received while paused
   * are ignored. Throws if the renderer already draws on the canvas (use framePresented()).
   */
  showFrame(frame: RgbaFrame): void { this.#view.showFrame(frame); }

  /** Reports a frame the renderer drew itself (WebGL/WebGPU, or an OffscreenCanvas in a worker). */
  framePresented(): void { this.#view.framePresented(); }

  /** Clears frames drawn by showFrame(); a renderer-owned context is left alone. */
  protected destroySurface(): void { this.#view.destroy(); }
}

function canvasElement(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const CanvasType = canvas?.ownerDocument?.defaultView?.HTMLCanvasElement;
  if (!CanvasType || !(canvas instanceof CanvasType)) {
    throw new TypeError('CanvasViewer needs a canvas element in a browser document.');
  }
  return canvas;
}
