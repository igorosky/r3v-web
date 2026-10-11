import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoViewer } from '../../src/index.js';
import type { ViewerCommand, ViewerOptions } from '../../src/index.js';
import { SceneList } from '../../src/ui/index.js';
import type { SceneListOptions } from '../../src/ui/index.js';

const viewers: VideoViewer[] = [];
const lists: SceneList[] = [];

const catalog = {
  elements: [
    { id: 'grid', label: 'Grid', visible: true },
    { id: 'robot', label: 'Robot', visible: false },
  ],
};

function mount(
  options: ViewerOptions = { sceneTimeout: 1000, dev: { sceneStub: false } },
  listOptions: SceneListOptions = {},
) {
  const viewer = new VideoViewer(document.createElement('video'), options);
  viewers.push(viewer);
  const commands: ViewerCommand[] = [];
  viewer.onCommand((command) => commands.push(command));
  const container = document.createElement('div');
  document.body.append(container);
  const list = new SceneList(container, viewer, listOptions);
  lists.push(list);
  return { viewer, commands, container, list };
}

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLLIElement>('.r3v-scene-list__item')];
}

function row(container: HTMLElement, id: string) {
  const item = container.querySelector<HTMLLIElement>(`.r3v-scene-list__item[data-id="${id}"]`);
  if (!item) throw new Error(`No row for ${id}`);
  return {
    item,
    toggle: item.querySelector<HTMLButtonElement>('[role="switch"]')!,
    label: item.querySelector('.r3v-scene-list__label')!,
    status: item.querySelector('.r3v-scene-list__status')!,
    focus: item.querySelector<HTMLButtonElement>('.r3v-scene-list__focus')!,
  };
}

function count(container: HTMLElement) {
  return container.querySelector('.r3v-scene-list__count')!.textContent;
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  lists.splice(0).forEach((list) => list.destroy());
  viewers.splice(0).forEach((viewer) => viewer.destroy());
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('SceneList', () => {
  it('lists every element in renderer order, each with both controls', () => {
    const { viewer, container } = mount();
    const empty = container.querySelector<HTMLElement>('.r3v-scene-list__empty')!;
    const list = container.querySelector('ul')!;
    expect(rows(container)).toEqual([]);
    expect(empty.hidden).toBe(false);
    expect(count(container)).toBe('');
    expect(document.getElementById(list.getAttribute('aria-labelledby')!)!.textContent).toBe('Scene');

    viewer.updateScene(catalog);
    expect(rows(container).map((item) => item.dataset.id)).toEqual(['grid', 'robot']);
    expect(empty.hidden).toBe(true);
    expect(count(container)).toBe('1 of 2 visible');
    const robot = row(container, 'robot');
    expect(robot.label.textContent).toBe('Robot');
    expect(robot.item.dataset.visible).toBe('false');
    expect(robot.toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(robot.toggle.getAttribute('aria-labelledby')!)).toBe(robot.label);
    expect(robot.toggle.title).toBe('Show Robot');
    expect(row(container, 'grid').toggle.title).toBe('Hide Grid');
    expect(robot.focus.getAttribute('aria-label')).toBe('Focus camera on Robot');
    expect(robot.focus.title).toBe('Focus camera on Robot');
    expect(robot.focus.disabled).toBe(false);
  });

  it('requests visibility while the switch keeps showing the renderer value', () => {
    const { viewer, commands, container } = mount();
    viewer.updateScene(catalog);
    const grid = row(container, 'grid');
    const icon = grid.toggle.firstElementChild;
    grid.toggle.click();
    expect(commands).toEqual([{ type: 'setVisibility', id: 'grid', visible: false }]);
    expect(grid.toggle.getAttribute('aria-checked')).toBe('true');
    expect(grid.item.hasAttribute('data-pending')).toBe(true);
    expect(grid.status.textContent).toBe('Hiding…');

    // A click while pending resends instead of being blocked.
    grid.toggle.click();
    expect(commands).toEqual([
      { type: 'setVisibility', id: 'grid', visible: false },
      { type: 'setVisibility', id: 'grid', visible: false },
    ]);

    viewer.updateScene({ elements: [{ id: 'grid', label: 'Grid', visible: false }, catalog.elements[1]!] });
    expect(grid.toggle.getAttribute('aria-checked')).toBe('false');
    expect(grid.toggle.firstElementChild).not.toBe(icon);
    expect(grid.item.hasAttribute('data-pending')).toBe(false);
    expect(grid.status.textContent).toBe('');
    expect(count(container)).toBe('0 of 2 visible');
  });

  it('focuses the camera on any element, hidden or pending', () => {
    const { viewer, commands, container } = mount();
    viewer.updateScene(catalog);
    const robot = row(container, 'robot');
    robot.focus.click();
    robot.toggle.click();
    robot.focus.click();
    expect(commands).toEqual([
      { type: 'focusCamera', id: 'robot' },
      { type: 'setVisibility', id: 'robot', visible: true },
      { type: 'focusCamera', id: 'robot' },
    ]);
  });

  it('updates rows in place, keeping keyboard focus', () => {
    const { viewer, container } = mount();
    viewer.updateScene(catalog);
    const grid = row(container, 'grid');
    grid.focus.focus();

    viewer.updateScene({
      elements: [
        { id: 'grid', label: 'Floor grid', visible: false },
        { id: 'arm', label: 'Arm', visible: true },
      ],
    });
    expect(document.activeElement).toBe(grid.focus);
    expect(row(container, 'grid').item).toBe(grid.item);
    expect(grid.label.textContent).toBe('Floor grid');
    expect(grid.focus.getAttribute('aria-label')).toBe('Focus camera on Floor grid');
    expect(grid.toggle.title).toBe('Show Floor grid');
    expect(rows(container).map((item) => item.dataset.id)).toEqual(['grid', 'arm']);

    viewer.updateScene({ elements: [catalog.elements[1]!, catalog.elements[0]!] });
    expect(rows(container).map((item) => item.dataset.id)).toEqual(['robot', 'grid']);
  });

  it('marks a request without an answer until the next request', () => {
    const { viewer, container } = mount();
    viewer.updateScene(catalog);
    const robot = row(container, 'robot');
    robot.toggle.click();
    vi.advanceTimersByTime(1000);
    expect(robot.item.hasAttribute('data-timeout')).toBe(true);
    expect(robot.item.hasAttribute('data-pending')).toBe(false);
    expect(robot.status.textContent).toBe('No answer');

    // A snapshot keeps the marker; a new request replaces it.
    viewer.updateScene(catalog);
    expect(robot.item.hasAttribute('data-timeout')).toBe(true);
    viewer.setVisibility('robot', true);
    expect(robot.item.hasAttribute('data-timeout')).toBe(false);
    expect(robot.status.textContent).toBe('Showing…');
  });

  it('uses the given texts', () => {
    const { viewer, container } = mount(undefined, {
      texts: {
        title: 'Scena',
        count: (visible, total) => `${visible}/${total}`,
        empty: 'Brak elementów',
        hide: (label) => `Ukryj: ${label}`,
        focus: (label) => `Ustaw kamerę na: ${label}`,
      },
    });
    expect(container.querySelector('.r3v-scene-list__title')!.textContent).toBe('Scena');
    expect(container.querySelector('.r3v-scene-list__empty')!.textContent).toBe('Brak elementów');
    viewer.updateScene(catalog);
    expect(count(container)).toBe('1/2');
    const grid = row(container, 'grid');
    expect(grid.toggle.title).toBe('Ukryj: Grid');
    expect(grid.focus.getAttribute('aria-label')).toBe('Ustaw kamerę na: Grid');
    grid.toggle.click();
    expect(grid.status.textContent).toBe('Hiding…');
  });

  it('disables its controls when the viewer is destroyed', () => {
    const { viewer, container } = mount();
    viewer.updateScene(catalog);
    viewer.destroy();
    const grid = row(container, 'grid');
    expect(grid.toggle.disabled).toBe(true);
    expect(grid.focus.disabled).toBe(true);
    expect(container.querySelector('.r3v-scene-list')!.hasAttribute('data-disabled')).toBe(true);
  });

  it('removes only its own content and stops following the viewer', () => {
    const { viewer, commands, container, list } = mount();
    const own = document.createElement('p');
    container.prepend(own);
    list.destroy();
    list.destroy();
    expect([...container.children]).toEqual([own]);
    viewer.updateScene(catalog);
    vi.advanceTimersByTime(1000);
    expect(container.querySelector('.r3v-scene-list')).toBeNull();
    expect(commands).toEqual([]);
  });

  it('cannot be created for a destroyed viewer', () => {
    const viewer = new VideoViewer(document.createElement('video'));
    viewer.destroy();
    const container = document.createElement('div');
    expect(() => new SceneList(container, viewer)).toThrow('destroyed');
    expect(container.children).toHaveLength(0);
  });

  it('works with the scene stub, which answers locally and sends no focus', () => {
    const { commands, container } = mount({});
    expect(rows(container).map((item) => item.dataset.id)).toEqual(['voxels', 'rover', 'manipulator']);
    const rover = row(container, 'rover');
    rover.toggle.click();
    rover.focus.click();
    expect(rover.toggle.getAttribute('aria-checked')).toBe('false');
    expect(rover.item.hasAttribute('data-pending')).toBe(false);
    expect(commands).toEqual([]);
  });
});
