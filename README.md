# R3V Web

Headless TypeScript library (`@r3v/web`) for showing R3V renderer output in your
own UI. It works on a `<video>` or `<canvas>` you provide, mirrors which scene
elements are visible, and turns mouse gestures into camera commands. It renders
no UI of its own and has no runtime dependencies.

## What's inside

- `src/`: the library.
  - `VideoViewer` shows a MediaStream from a remote renderer, e.g. over WebRTC.
  - `CanvasViewer` shows a renderer running in the page: it draws RGBA frames
    (`showFrame()`) or lets the renderer draw on the canvas (`framePresented()`).
  - `Viewer` is their shared base: status and demand (`onStatus`, `pause`,
    `resume`), scene visibility (`updateScene`, `setVisibility`) and camera
    commands (`onCommand`, `focusCamera`, `resetCamera`).
  - `@r3v/web/ui` (`src/ui/`) is an optional `SceneList` component with
    `ui.css`, built only on the public API.
- `examples/`: demo pages, see below.
- `tests/browser/`: Vitest tests that run in Chromium.

The application owns the transport. It forwards `onCommand` to the renderer and
passes the renderer's scene snapshots to `updateScene()`. Until the renderer can
report its scene, a built-in stub answers locally with a static list (voxels,
rover, manipulator). Turn it off with `dev: { sceneStub: false }`.

```ts
import { VideoViewer } from '@r3v/web';

const viewer = new VideoViewer(video);
viewer.setStream(stream);
viewer.onCommand((command) => transport.send(command));
transport.onSceneSnapshot((snapshot) => viewer.updateScene(snapshot));

viewer.destroy();
```

## Examples

```sh
npm ci
npm run dev
```

- **`examples/basic/`** (`http://localhost:5173/examples/basic/`): four clients
  share one simulated renderer with 400 ms latency. Each client has start/stop,
  a scene checklist and a toggle that simulates a disconnect. Clients A and B
  (`VideoViewer`) and D (`CanvasViewer` with `SceneList`) share the renderer's
  scene. Client C uses the built-in scene stub.
- **`examples/janus/`** (`http://localhost:5173/examples/janus/`): the real
  r3v-renderer streamed over WebRTC through Janus, video only, for testing.
  Camera gestures reach the renderer as ROS 2 topics through rosbridge.

## Development

```sh
npm run typecheck
npm run lint                      # Oxlint with type-aware rules
npm run build                     # ESM and types in dist/
npx playwright install chromium   # once
npm test
```

Node `^22.12.0 || ^24.0.0 || >=26.0.0`.
