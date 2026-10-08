import type { CameraCommand } from '../types.js';

/** Radians of orbit per displayed image height dragged. */
const ORBIT_PER_HEIGHT = Math.PI;
/** Logarithm of the dolly factor per wheel pixel: a 100 px notch moves about 14 % away. */
const DOLLY_PER_PIXEL = Math.log(1.14) / 100;
/** Pixels per wheel line, so a typical 3-line notch matches a 100 px one. */
const LINE_PIXELS = 100 / 3;

/** Intrinsic width and height of the presented image; zero while unknown. */
export type SourceSize = () => readonly [width: number, height: number];

interface Drag {
  readonly pointerId: number;
  readonly mode: 'orbit' | 'pan';
  /** Displayed image height in CSS pixels, measured when the drag starts. */
  readonly imageHeight: number;
  x: number;
  y: number;
}

/**
 * Turns mouse gestures on a surface into relative camera commands: left drag orbits, right or
 * middle drag pans, the wheel dollies. Movement is measured against the displayed image.
 */
export class CameraGestures {
  readonly #surface: HTMLElement;
  readonly #sourceSize: SourceSize;
  readonly #emit: (command: CameraCommand) => void;
  readonly #events = new AbortController();
  #drag: Drag | null = null;

  constructor(surface: HTMLElement, sourceSize: SourceSize, emit: (command: CameraCommand) => void) {
    this.#surface = surface;
    this.#sourceSize = sourceSize;
    this.#emit = emit;

    const signal = this.#events.signal;
    surface.addEventListener('pointerdown', (event) => this.#down(event), { signal });
    surface.addEventListener('pointermove', (event) => this.#move(event), { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      surface.addEventListener(type, (event) => {
        if (event.pointerId === this.#drag?.pointerId) this.#cancel();
      }, { signal });
    }
    // Right drag pans, so the context menu would interrupt it.
    surface.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    surface.addEventListener('wheel', (event) => this.#wheel(event), { signal, passive: false });
    surface.ownerDocument.defaultView?.addEventListener('blur', () => this.#cancel(), { signal });
  }

  /** Ends a drag in progress and removes all listeners. */
  destroy(): void {
    this.#cancel();
    this.#events.abort();
  }

  #down(event: PointerEvent): void {
    // The first version handles the mouse only; touch and pen keep their default behaviour.
    if (event.pointerType !== 'mouse' || this.#drag) return;
    const mode = event.button === 0 ? 'orbit' : event.button === 1 || event.button === 2 ? 'pan' : null;
    if (!mode) return;
    // Prevents text selection and middle-click autoscroll.
    event.preventDefault();
    this.#drag = { pointerId: event.pointerId, mode, imageHeight: this.#imageHeight(), x: event.clientX, y: event.clientY };
    try {
      this.#surface.setPointerCapture(event.pointerId);
    } catch {
      // Not an active pointer (e.g. a synthetic event): the drag ends when the button is released.
    }
  }

  #move(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    // Released outside the surface without pointer capture.
    if (event.buttons === 0) { this.#cancel(); return; }
    const dx = (event.clientX - drag.x) / drag.imageHeight;
    const dy = (event.clientY - drag.y) / drag.imageHeight;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (dx === 0 && dy === 0) return;
    this.#emit(drag.mode === 'orbit'
      ? { type: 'orbit', yaw: dx * ORBIT_PER_HEIGHT, pitch: dy * ORBIT_PER_HEIGHT }
      : { type: 'pan', x: dx, y: dy });
  }

  #wheel(event: WheelEvent): void {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const pixels = event.deltaY * (
      event.deltaMode === 1 ? LINE_PIXELS : event.deltaMode === 2 ? this.#surface.clientHeight : 1
    );
    this.#emit({ type: 'dolly', factor: Math.exp(pixels * DOLLY_PER_PIXEL) });
  }

  #cancel(): void {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = null;
    try {
      if (this.#surface.hasPointerCapture(drag.pointerId)) this.#surface.releasePointerCapture(drag.pointerId);
    } catch {
      // The pointer is already gone.
    }
  }

  /** Height of the image as displayed, following the integrator's `object-fit`, in CSS pixels. */
  #imageHeight(): number {
    const surface = this.#surface;
    const style = surface.ownerDocument.defaultView!.getComputedStyle(surface);
    const px = (value: string) => parseFloat(value) || 0;
    const rect = surface.getBoundingClientRect();
    // object-fit applies to the content box.
    const width = rect.width - px(style.borderLeftWidth) - px(style.borderRightWidth)
      - px(style.paddingLeft) - px(style.paddingRight);
    const height = rect.height - px(style.borderTopWidth) - px(style.borderBottomWidth)
      - px(style.paddingTop) - px(style.paddingBottom);
    const [sourceWidth, sourceHeight] = this.#sourceSize();
    if (!(width > 0 && height > 0)) return 1;
    if (!(sourceWidth > 0 && sourceHeight > 0)) return height;
    const contain = Math.min(width / sourceWidth, height / sourceHeight);
    switch (style.objectFit) {
      case 'fill': return height;
      case 'cover': return sourceHeight * Math.max(width / sourceWidth, height / sourceHeight);
      case 'none': return sourceHeight;
      case 'scale-down': return sourceHeight * Math.min(1, contain);
      default: return sourceHeight * contain;
    }
  }
}
