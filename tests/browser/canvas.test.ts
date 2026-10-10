import { afterEach, describe, expect, it } from 'vitest';
import { CanvasViewer, VideoViewer, Viewer } from '../../src/index.js';
import type { StreamStatus, ViewerOptions } from '../../src/index.js';

const viewers: Viewer[] = [];

function canvas(): HTMLCanvasElement {
  const element = document.createElement('canvas');
  document.body.append(element);
  return element;
}

function attach(target = canvas(), options?: ViewerOptions): CanvasViewer {
  const viewer = new CanvasViewer(target, options);
  viewers.push(viewer);
  return viewer;
}

/** A 2×2 frame inside a larger buffer, like a view on WASM memory. */
function frame(rgba: [number, number, number, number]) {
  const memory = new ArrayBuffer(64);
  const data = new Uint8Array(memory, 16, 2 * 2 * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(rgba, offset);
  return { width: 2, height: 2, data };
}

function pixel(target: HTMLCanvasElement): number[] {
  return [...target.getContext('2d')!.getImageData(0, 0, 1, 1).data];
}

afterEach(() => {
  viewers.splice(0).forEach((viewer) => viewer.destroy());
  document.querySelectorAll('canvas').forEach((element) => element.remove());
});

describe('CanvasViewer', () => {
  it('starts idle, draws RGBA frames from a memory view and resizes the canvas', () => {
    const viewer = attach();
    const statuses: StreamStatus[] = [];
    viewer.onStatus((status) => statuses.push(status));
    expect(viewer.status).toMatchObject({ state: 'idle', active: true });
    viewer.showFrame(frame([255, 0, 0, 255]));
    expect([viewer.canvas.width, viewer.canvas.height]).toEqual([2, 2]);
    expect(pixel(viewer.canvas)).toEqual([255, 0, 0, 255]);
    expect(statuses.map(({ state }) => state)).toEqual(['idle', 'playing']);
  });

  it('ignores frames while paused and waits for the next frame after resume', () => {
    const viewer = attach();
    viewer.showFrame(frame([255, 0, 0, 255]));
    viewer.pause();
    viewer.showFrame(frame([0, 0, 255, 255]));
    expect(viewer.status).toMatchObject({ state: 'paused', active: false });
    expect(pixel(viewer.canvas)).toEqual([255, 0, 0, 255]);
    viewer.resume();
    expect(viewer.status).toMatchObject({ state: 'waiting', active: true });
    viewer.showFrame(frame([0, 0, 255, 255]));
    expect(viewer.status.state).toBe('playing');
    expect(pixel(viewer.canvas)).toEqual([0, 0, 255, 255]);
  });

  it('never leaves a listener with a stale status when another listener changes it', () => {
    const viewer = attach();
    // A preview that stops after the first frame.
    viewer.onStatus(({ state }) => { if (state === 'playing') viewer.pause(); });
    let last: StreamStatus | undefined;
    viewer.onStatus((status) => { last = status; });
    viewer.showFrame(frame([255, 0, 0, 255]));
    expect(viewer.status).toMatchObject({ state: 'paused', active: false });
    expect(last).toBe(viewer.status);
  });

  it('can start inactive', () => {
    const viewer = attach(canvas(), { active: false });
    expect(viewer.status).toMatchObject({ state: 'idle', active: false });
    viewer.framePresented();
    expect(viewer.status.state).toBe('idle');
    viewer.resume();
    expect(viewer.status).toMatchObject({ state: 'idle', active: true });
  });

  it('reports frames the renderer draws itself and leaves its context alone', () => {
    const target = canvas();
    // Any non-2D context stands in for a WebGL/WebGPU renderer.
    expect(target.getContext('bitmaprenderer')).not.toBeNull();
    const viewer = attach(target);
    viewer.framePresented();
    expect(viewer.status.state).toBe('playing');
    expect(() => viewer.showFrame(frame([0, 0, 0, 255]))).toThrow('framePresented');
    viewer.destroy();
    expect(viewer.status.state).toBe('destroyed');
  });

  it('validates frames synchronously', () => {
    const viewer = attach();
    const data = new Uint8ClampedArray(16);
    expect(() => viewer.showFrame({ width: 2.5, height: 2, data })).toThrow(TypeError);
    expect(() => viewer.showFrame({ width: 2, height: 1, data })).toThrow('width * height * 4');
    expect(() => viewer.showFrame({ width: 2, height: 2, data: [] as never })).toThrow(TypeError);
    expect(viewer.status.state).toBe('idle');
  });

  it.skipIf(typeof SharedArrayBuffer === 'undefined')('copies frames from shared memory', () => {
    const viewer = attach();
    const data = new Uint8Array(new SharedArrayBuffer(16)).fill(255);
    viewer.showFrame({ width: 2, height: 2, data });
    expect(pixel(viewer.canvas)).toEqual([255, 255, 255, 255]);
  });

  it('clears drawn frames on destruction and supports reattaching', () => {
    const target = canvas();
    const viewer = attach(target);
    viewer.showFrame(frame([255, 0, 0, 255]));
    viewer.destroy();
    expect(pixel(target)).toEqual([0, 0, 0, 0]);
    expect(viewer.status).toMatchObject({ state: 'destroyed', active: false });
    expect(() => viewer.showFrame(frame([255, 0, 0, 255]))).toThrow('destroyed');
    expect(attach(target).canvas).toBe(target);
  });
});

describe('Viewer base', () => {
  it('shares status, scene and lifecycle across surfaces', () => {
    const video = document.createElement('video');
    const shared: Viewer[] = [new VideoViewer(video), attach()];
    viewers.push(shared[0]!);
    for (const viewer of shared) {
      expect(viewer).toBeInstanceOf(Viewer);
      expect(viewer.status.state).toBe('idle');
      viewer.setVisibility('rover', false);
      expect(viewer.scene.elements.find(({ id }) => id === 'rover')?.visible).toBe(false);
    }
  });

  it('rejects a surface of the other type', () => {
    expect(() => new CanvasViewer(document.createElement('video') as unknown as HTMLCanvasElement)).toThrow(TypeError);
    expect(() => new VideoViewer(canvas() as unknown as HTMLVideoElement)).toThrow(TypeError);
  });
});
