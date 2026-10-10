import { afterEach, describe, expect, it } from 'vitest';
import { CanvasViewer } from '../../src/index.js';
import type { CameraCommand, ViewerOptions } from '../../src/index.js';

const viewers: CanvasViewer[] = [];

/** A canvas with a 400×200 source shown in a `width`×`height` CSS box. */
function mount(style: Partial<CSSStyleDeclaration> = {}, options: ViewerOptions = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 200;
  Object.assign(canvas.style, { display: 'block', width: '200px', height: '100px' }, style);
  document.body.append(canvas);
  const viewer = new CanvasViewer(canvas, options);
  viewers.push(viewer);
  const commands: CameraCommand[] = [];
  viewer.onCommand((command) => { if (command.type !== 'setVisibility') commands.push(command); });
  return { canvas, viewer, commands };
}

function pointer(target: Element, type: string, init: PointerEventInit): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, ...init });
  target.dispatchEvent(event);
  return event;
}

function drag(target: Element, button: number, from: [number, number], to: [number, number]): void {
  const buttons = button === 0 ? 1 : button === 2 ? 2 : 4;
  pointer(target, 'pointerdown', { button, buttons, clientX: from[0], clientY: from[1] });
  pointer(target, 'pointermove', { button: -1, buttons, clientX: to[0], clientY: to[1] });
  pointer(target, 'pointerup', { button, buttons: 0, clientX: to[0], clientY: to[1] });
}

afterEach(() => {
  viewers.splice(0).forEach((viewer) => {
    viewer.canvas.remove();
    viewer.destroy();
  });
});

describe('Camera gestures', () => {
  it('orbits with the left button, in radians per displayed image height', () => {
    const { canvas, commands } = mount();
    drag(canvas, 0, [10, 10], [60, 35]);
    expect(commands).toEqual([{ type: 'orbit', yaw: Math.PI / 2, pitch: Math.PI / 4 }]);
  });

  it('pans with the right or middle button, in fractions of the image height', () => {
    const { canvas, commands } = mount();
    drag(canvas, 2, [10, 10], [35, 60]);
    drag(canvas, 1, [10, 10], [10, 0]);
    expect(commands).toEqual([{ type: 'pan', x: 0.25, y: 0.5 }, { type: 'pan', x: 0, y: -0.1 }]);
  });

  it('measures against the image as displayed by object-fit', () => {
    // A 2:1 source in a 300×300 box: contain shows it 150 px high, cover 300 px.
    const contain = mount({ width: '300px', height: '300px', objectFit: 'contain' });
    drag(contain.canvas, 2, [0, 0], [0, 75]);
    const cover = mount({ width: '300px', height: '300px', objectFit: 'cover' });
    drag(cover.canvas, 2, [0, 0], [0, 75]);
    // Padding and borders are outside the content box.
    const padded = mount({ boxSizing: 'border-box', height: '120px', padding: '5px', border: '5px solid' });
    drag(padded.canvas, 2, [0, 0], [0, 50]);
    expect([...contain.commands, ...cover.commands, ...padded.commands])
      .toEqual([{ type: 'pan', x: 0, y: 0.5 }, { type: 'pan', x: 0, y: 0.25 }, { type: 'pan', x: 0, y: 0.5 }]);
  });

  it('dollies with the wheel and keeps the page from scrolling', () => {
    const { canvas, commands } = mount();
    const away = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    canvas.dispatchEvent(away);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, cancelable: true }));
    expect(away.defaultPrevented).toBe(true);
    expect(commands.map((command) => command.type === 'dolly' && command.factor))
      .toEqual([expect.closeTo(1.14, 6), expect.closeTo(1 / 1.14, 6)]);
  });

  it('ends a drag on release, cancel, window blur, or a move without buttons', () => {
    const { canvas, commands } = mount();
    for (const end of [
      () => pointer(canvas, 'pointerup', { button: 0, buttons: 0 }),
      () => pointer(canvas, 'pointercancel', {}),
      () => window.dispatchEvent(new Event('blur')),
      () => pointer(canvas, 'pointermove', { buttons: 0, clientX: 5, clientY: 5 }),
    ]) {
      pointer(canvas, 'pointerdown', { button: 0, buttons: 1, clientX: 0, clientY: 0 });
      end();
      pointer(canvas, 'pointermove', { buttons: 1, clientX: 50, clientY: 50 });
    }
    expect(commands).toEqual([]);
  });

  it('ignores touch and pen, and prevents the context menu', () => {
    const { canvas, commands } = mount();
    pointer(canvas, 'pointerdown', { pointerType: 'touch', button: 0, buttons: 1, clientX: 0, clientY: 0 });
    pointer(canvas, 'pointermove', { pointerType: 'touch', buttons: 1, clientX: 50, clientY: 50 });
    const menu = new MouseEvent('contextmenu', { cancelable: true });
    canvas.dispatchEvent(menu);
    expect(commands).toEqual([]);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('can be disabled', () => {
    const { canvas, commands } = mount({}, { cameraGestures: false });
    drag(canvas, 0, [0, 0], [50, 50]);
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(commands).toEqual([]);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it('stops listening when destroyed during a drag', () => {
    const { canvas, viewer, commands } = mount();
    pointer(canvas, 'pointerdown', { button: 0, buttons: 1, clientX: 0, clientY: 0 });
    viewer.destroy();
    pointer(canvas, 'pointermove', { buttons: 1, clientX: 50, clientY: 50 });
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(commands).toEqual([]);
    expect(wheel.defaultPrevented).toBe(false);
    expect(() => viewer.resetCamera()).toThrow('destroyed');
    expect(() => viewer.focusCamera('voxels')).toThrow('destroyed');
  });

  it('requests a camera reset', () => {
    const { viewer, commands } = mount();
    viewer.resetCamera();
    expect(commands).toEqual([{ type: 'resetCamera' }]);
  });
});

describe('Camera focus', () => {
  const scene = {
    elements: [
      { id: 'grid', label: 'Grid', visible: true },
      { id: 'robot', label: 'Robot', visible: false },
    ],
  };

  it('points the camera at any scene element, visible or not', () => {
    const { viewer, commands } = mount({}, { dev: { sceneStub: false } });
    viewer.updateScene(scene);
    viewer.focusCamera('grid');
    viewer.focusCamera('robot');
    expect(commands).toEqual([{ type: 'focusCamera', id: 'grid' }, { type: 'focusCamera', id: 'robot' }]);
    expect(viewer.scene.elements.every((element) => element.requested === null)).toBe(true);
  });

  it('works while a visibility request is pending', () => {
    const { viewer, commands } = mount({}, { dev: { sceneStub: false } });
    viewer.updateScene(scene);
    viewer.setVisibility('robot', true);
    viewer.focusCamera('robot');
    expect(commands).toEqual([{ type: 'focusCamera', id: 'robot' }]);
  });

  it('rejects elements outside the scene', () => {
    const { viewer, commands } = mount({}, { dev: { sceneStub: false } });
    expect(() => viewer.focusCamera('grid')).toThrow(RangeError);
    viewer.updateScene(scene);
    expect(() => viewer.focusCamera('missing')).toThrow(RangeError);
    expect(commands).toEqual([]);
  });

  it('sends nothing for the scene stub, which the renderer does not know', () => {
    const { viewer, commands } = mount();
    viewer.focusCamera('rover');
    expect(commands).toEqual([]);
  });
});
