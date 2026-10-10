import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoViewer } from '../../src/index.js';
import type { SceneError, SceneState, SetVisibilityCommand, ViewerCommand, ViewerOptions } from '../../src/index.js';

const viewers: VideoViewer[] = [];

const catalog = {
  elements: [
    { id: 'grid', label: 'Grid', visible: true },
    { id: 'robot', label: 'Robot', visible: false },
  ],
};

function mount(options: ViewerOptions = { sceneTimeout: 1000, dev: { sceneStub: false } }) {
  const viewer = new VideoViewer(document.createElement('video'), options);
  viewers.push(viewer);
  const commands: SetVisibilityCommand[] = [];
  const errors: SceneError[] = [];
  viewer.onCommand((command) => { if (command.type === 'setVisibility') commands.push(command); });
  viewer.onSceneError((error) => errors.push(error));
  return { viewer, commands, errors };
}

function element(scene: SceneState, id: string) {
  return scene.elements.find((item) => item.id === id);
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  viewers.splice(0).forEach((viewer) => viewer.destroy());
  vi.useRealTimers();
});

describe('Scene visibility', () => {
  it('starts empty, then mirrors a renderer snapshot', () => {
    const { viewer } = mount();
    const scenes: SceneState[] = [];
    viewer.onSceneChange((scene) => scenes.push(scene));
    expect(scenes[0]).toEqual({ elements: [] });
    viewer.updateScene(catalog);
    expect(viewer.scene).toEqual({
      elements: [
        { id: 'grid', label: 'Grid', visible: true, requested: null },
        { id: 'robot', label: 'Robot', visible: false, requested: null },
      ],
    });
    expect(Object.isFrozen(viewer.scene.elements[0])).toBe(true);
    expect(scenes).toHaveLength(2);
  });

  it('keeps the renderer value while a request is pending and lets the next snapshot decide', () => {
    const { viewer, commands } = mount();
    viewer.updateScene(catalog);
    viewer.setVisibility('grid', false);
    expect(commands).toEqual([{ type: 'setVisibility', id: 'grid', visible: false }]);
    expect(element(viewer.scene, 'grid')).toMatchObject({ visible: true, requested: false });
    // Another subscriber may have changed the state meanwhile; the renderer wins.
    viewer.updateScene({ elements: [{ id: 'grid', label: 'Grid', visible: true }] });
    expect(viewer.scene.elements).toEqual([{ id: 'grid', label: 'Grid', visible: true, requested: null }]);
  });

  it('resends a repeated request and drops it when no snapshot arrives in time', () => {
    const { viewer, commands, errors } = mount();
    viewer.updateScene(catalog);
    viewer.setVisibility('robot', true);
    vi.advanceTimersByTime(600);
    viewer.setVisibility('robot', true);
    expect(commands.map(({ visible }) => visible)).toEqual([true, true]);
    vi.advanceTimersByTime(600);
    expect(errors).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(element(viewer.scene, 'robot')).toMatchObject({ visible: false, requested: null });
    expect(errors).toEqual([{ id: 'robot', reason: 'timeout' }]);
  });

  it('lets a different request replace a pending one', () => {
    const { viewer, commands } = mount();
    viewer.updateScene(catalog);
    viewer.setVisibility('robot', true);
    viewer.setVisibility('robot', false);
    expect(commands.map(({ visible }) => visible)).toEqual([true, false]);
    expect(element(viewer.scene, 'robot')).toMatchObject({ visible: false, requested: false });
  });

  it('sends a request even when it matches the renderer value', () => {
    const { viewer, commands } = mount();
    viewer.updateScene(catalog);
    viewer.setVisibility('grid', true);
    expect(commands).toEqual([{ type: 'setVisibility', id: 'grid', visible: true }]);
    expect(element(viewer.scene, 'grid')).toMatchObject({ visible: true, requested: true });
  });

  it('times out each pending element independently', () => {
    const { viewer, errors } = mount();
    viewer.updateScene(catalog);
    viewer.setVisibility('grid', false);
    vi.advanceTimersByTime(500);
    viewer.setVisibility('robot', true);
    vi.advanceTimersByTime(500);
    expect(errors).toEqual([{ id: 'grid', reason: 'timeout' }]);
    expect(element(viewer.scene, 'grid')).toMatchObject({ visible: true, requested: null });
    expect(element(viewer.scene, 'robot')).toMatchObject({ visible: false, requested: true });
    vi.advanceTimersByTime(500);
    expect(errors.map(({ id }) => id)).toEqual(['grid', 'robot']);
  });

  it('settles immediately when a local renderer answers synchronously', () => {
    const { viewer, errors } = mount();
    viewer.updateScene(catalog);
    viewer.onCommand((command) => {
      if (command.type !== 'setVisibility') return;
      const { id, visible } = command;
      viewer.updateScene({ elements: catalog.elements.map((item) => (item.id === id ? { ...item, visible } : item)) });
    });
    viewer.setVisibility('grid', false);
    expect(element(viewer.scene, 'grid')).toMatchObject({ visible: false, requested: null });
    vi.advanceTimersByTime(2000);
    expect(errors).toEqual([]);
  });

  it('drops pending requests for elements removed by the renderer', () => {
    const { viewer, errors } = mount();
    viewer.updateScene(catalog);
    viewer.setVisibility('robot', true);
    viewer.updateScene({ elements: [catalog.elements[0]!] });
    vi.advanceTimersByTime(2000);
    expect(errors).toEqual([]);
    expect(() => viewer.setVisibility('robot', true)).toThrow(RangeError);
  });

  it('validates snapshots and requests synchronously', () => {
    const { viewer } = mount();
    expect(() => viewer.setVisibility('grid', true)).toThrow(RangeError);
    expect(() => viewer.updateScene({} as never)).toThrow(TypeError);
    expect(() => viewer.updateScene({ elements: [{ id: '', label: 'x', visible: true }] })).toThrow(TypeError);
    expect(() => viewer.updateScene({ elements: [catalog.elements[0]!, catalog.elements[0]!] })).toThrow('Duplicate');
    viewer.updateScene(catalog);
    expect(() => viewer.setVisibility('grid', 'no' as never)).toThrow(TypeError);
  });

  it('cancels timers and listeners on destruction', () => {
    const { viewer, errors } = mount();
    viewer.updateScene(catalog);
    viewer.setVisibility('grid', false);
    viewer.destroy();
    vi.advanceTimersByTime(2000);
    expect(errors).toEqual([]);
    expect(() => viewer.setVisibility('grid', true)).toThrow('destroyed');
  });

  it('delivers commands in order when a listener issues another one', () => {
    const { viewer } = mount();
    viewer.updateScene(catalog);
    // E.g. hiding a part also hides what is attached to it.
    viewer.onCommand((command) => {
      if (command.type === 'setVisibility' && command.id === 'grid' && !command.visible) viewer.setVisibility('robot', false);
    });
    const sent: ViewerCommand[] = [];
    viewer.onCommand((command) => sent.push(command));
    viewer.setVisibility('grid', false);
    expect(sent.map((command) => command.type === 'setVisibility' && command.id)).toEqual(['grid', 'robot']);
  });

  it('delivers a command emitted before destruction to every listener', () => {
    const { viewer, commands } = mount();
    viewer.updateScene(catalog);
    const late: ViewerCommand[] = [];
    viewer.onCommand(() => viewer.destroy());
    viewer.onCommand((command) => late.push(command));
    viewer.setVisibility('grid', false);
    expect(viewer.status.state).toBe('destroyed');
    expect(commands).toHaveLength(1);
    expect(late).toEqual(commands);
  });

  it('reports a throwing listener without interrupting the request or other listeners', () => {
    const { viewer, commands } = mount();
    viewer.updateScene(catalog);
    const failure = new Error('listener bug');
    const reported: unknown[] = [];
    const onError = (event: ErrorEvent) => { event.preventDefault(); reported.push(event.error); };
    window.addEventListener('error', onError);
    const seen: SceneState[] = [];
    try {
      viewer.onSceneChange((scene) => { if (element(scene, 'grid')?.requested === false) throw failure; });
      viewer.onSceneChange((scene) => seen.push(scene));
      viewer.setVisibility('grid', false);
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(reported).toEqual([failure]);
    expect(commands).toEqual([{ type: 'setVisibility', id: 'grid', visible: false }]);
    expect(element(seen.at(-1)!, 'grid')?.requested).toBe(false);
  });
});

describe('Scene stub (MVP default)', () => {
  it('provides the static scene immediately', () => {
    const { viewer } = mount({});
    expect(viewer.scene.elements.map(({ id, visible, requested }) => [id, visible, requested])).toEqual([
      ['voxels', true, null],
      ['rover', true, null],
      ['manipulator', true, null],
    ]);
  });

  it('answers requests locally without emitting commands or timing out', () => {
    const { viewer, commands, errors } = mount({});
    const scenes: SceneState[] = [];
    viewer.onSceneChange((scene) => scenes.push(scene));
    viewer.setVisibility('rover', false);
    expect(element(viewer.scene, 'rover')).toMatchObject({ visible: false, requested: null });
    expect(element(scenes.at(-2)!, 'rover')).toMatchObject({ visible: true, requested: false });
    expect(commands).toEqual([]);
    vi.advanceTimersByTime(10000);
    expect(errors).toEqual([]);
  });

  it('keeps instances independent and lets renderer snapshots override it', () => {
    const first = mount({}).viewer;
    const second = mount({}).viewer;
    first.setVisibility('voxels', false);
    expect(element(second.scene, 'voxels')?.visible).toBe(true);
    first.updateScene(catalog);
    first.setVisibility('robot', true);
    expect(element(first.scene, 'robot')).toMatchObject({ visible: true, requested: null });
  });
});
