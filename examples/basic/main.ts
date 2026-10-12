import { CanvasViewer, VideoViewer } from '../../src/index.js';
import type { Viewer } from '../../src/index.js';
import type { SceneState } from '../../src/index.js';
import { SceneList } from '../../src/ui/index.js';
import { createDemoRenderer } from './sources.js';
import type { DemoConnection } from './sources.js';
// The optional UI's default styles, then the application's own.
import '../../src/ui/ui.css';
import './style.css';

type Renderer = ReturnType<typeof createDemoRenderer>;

function get<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing example element: ${selector}`);
  return element;
}

/**
 * Application code: a scene checklist built on the shared Viewer API, as an application without
 * the optional UI would build it. Returns a function that removes it.
 */
function ownSceneList(panel: HTMLElement, viewer: Viewer): () => void {
  const sceneList = get(panel, '[data-scene]');
  const sceneError = get(panel, '[data-scene-error]');
  const rows = new Map<string, { row: HTMLLIElement; input: HTMLInputElement; label: HTMLSpanElement }>();

  function renderScene({ elements }: SceneState): void {
    for (const [id, { row }] of rows) {
      if (!elements.some((element) => element.id === id)) { row.remove(); rows.delete(id); }
    }
    for (const { id, label, visible, requested } of elements) {
      let item = rows.get(id);
      if (!item) {
        const row = document.createElement('li');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => {
          sceneError.textContent = '';
          viewer.setVisibility(id, input.checked);
        });
        const text = document.createElement('span');
        const wrapper = document.createElement('label');
        wrapper.append(input, text);
        row.append(wrapper);
        item = { row, input, label: text };
        rows.set(id, item);
      }
      // The checkbox shows what the renderer displays; a click while pending resends the request.
      item.input.checked = visible;
      item.label.textContent = label;
      item.row.dataset.requested = String(requested);
      sceneList.append(item.row);
    }
  }

  const unsubscribe = [
    viewer.onSceneChange(renderScene),
    viewer.onSceneError(({ id }) => { sceneError.textContent = `${id}: no answer from renderer`; }),
  ];
  return () => {
    unsubscribe.forEach((stop) => stop());
    sceneList.replaceChildren();
    sceneError.textContent = '';
  };
}

/** Everything below is application code, apart from the optional SceneList in client D. */
function setupClient(panel: HTMLElement, renderer: Renderer): () => void {
  // Client C talks to an MVP renderer without scene support and keeps the library defaults.
  const mvp = panel.dataset.mvp === 'true';
  const surface = get<HTMLVideoElement | HTMLCanvasElement>(panel, 'video, canvas');
  const status = get(panel, '[role="status"]');
  const demand = get<HTMLButtonElement>(panel, '[data-action="demand"]');
  const attachButton = get<HTMLButtonElement>(panel, '[data-action="attach"]');
  const destroyButton = get<HTMLButtonElement>(panel, '[data-action="destroy"]');
  const connected = get<HTMLInputElement>(panel, '[data-control="connected"]');
  const offline = get(panel, '[data-offline]');
  // Client D uses the optional SceneList; the others build their own list.
  const sceneListContainer = panel.querySelector<HTMLElement>('[data-scene-list]');
  const listeners = new AbortController();
  let viewer: Viewer | undefined;
  let connection: DemoConnection | undefined;
  let removeSceneList: (() => void) | undefined;

  function connect(): void {
    // The transport belongs to the application; it pipes renderer snapshots into the viewer.
    connection = renderer.connect((snapshot) => viewer?.updateScene(snapshot), {
      reportsScene: !mvp,
      // A canvas client receives RGBA buffers instead of a MediaStream.
      ...(viewer instanceof CanvasViewer && { onRgbaFrame: (frame) => (viewer as CanvasViewer).showFrame(frame) }),
    });
    connection.setActive(viewer?.status.active ?? false);
    offline.hidden = true;
  }

  function disconnect(): void {
    // Connection state is the application's: it informs the user, the viewer is not involved.
    connection?.close();
    connection = undefined;
    offline.hidden = false;
  }

  function updateButtons(): void {
    attachButton.disabled = viewer !== undefined;
    destroyButton.disabled = viewer === undefined;
    demand.disabled = viewer === undefined;
    connected.disabled = viewer === undefined;
    if (!viewer) {
      status.textContent = 'Not attached';
      status.dataset.active = 'false';
    }
  }

  function attach(): void {
    if (viewer) return;
    // Only the demo clients opt out of the MVP scene stub; the rest is identical.
    const options = mvp ? {} : { dev: { sceneStub: false } };
    if (surface instanceof HTMLCanvasElement) {
      viewer = new CanvasViewer(surface, options);
    } else {
      const videoViewer = new VideoViewer(surface, options);
      videoViewer.setStream(renderer.stream);
      viewer = videoViewer;
    }
    // From here on the code only uses the shared Viewer API.
    viewer.onStatus(({ state, active }) => {
      status.textContent = state;
      status.dataset.active = String(active);
      demand.textContent = active ? 'Stop' : 'Start';
      // Use consumer intent, not state === 'playing': waiting needs frames too.
      connection?.setActive(active);
    });
    viewer.onCommand((command) => connection?.send(command));
    if (sceneListContainer) {
      // The list renders the viewer's scene and requests changes through it, commands included.
      const list = new SceneList(sceneListContainer, viewer);
      removeSceneList = () => list.destroy();
    } else {
      removeSceneList = ownSceneList(panel, viewer);
    }
    if (connected.checked) connect();
    updateButtons();
  }

  function destroy(): void {
    disconnect();
    removeSceneList?.();
    removeSceneList = undefined;
    viewer?.destroy();
    viewer = undefined;
    offline.hidden = true;
    updateButtons();
  }

  const { signal } = listeners;
  attachButton.addEventListener('click', attach, { signal });
  destroyButton.addEventListener('click', destroy, { signal });
  demand.addEventListener('click', () => {
    if (viewer?.status.active) viewer.pause();
    else viewer?.resume();
  }, { signal });
  connected.addEventListener('change', () => {
    if (!viewer) return;
    if (connected.checked) connect();
    else disconnect();
  }, { signal });
  attach();

  return () => { listeners.abort(); destroy(); };
}

const frameCount = get(document, '[data-frames]');
const producer = get(document, '[data-producer]');
const renderer = createDemoRenderer({
  latency: 400,
  onFrame(count) { frameCount.textContent = String(count); },
  onDemand(active) {
    producer.textContent = active ? 'Rendering' : 'Suspended';
    producer.dataset.active = String(active);
  },
});
const answers = get<HTMLInputElement>(document, '[data-control="answers"]');
answers.addEventListener('change', () => renderer.setAnswersVisibility(answers.checked));

const cleanups = [...document.querySelectorAll<HTMLElement>('.client')].map((panel) => setupClient(panel, renderer));

import.meta.hot?.dispose(() => {
  cleanups.forEach((cleanup) => cleanup());
  renderer.destroy();
});
