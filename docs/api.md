# API

[Back to README](../README.md)

- [Viewers](#viewers)
- [Status](#status)
- [Scene](#scene)
- [Commands](#commands)
- [Options](#options)
- [SceneList](#scenelist)

Everything is exported from `@r3v/web`, except `SceneList`, which comes from
`@r3v/web/ui` (with its styles in `@r3v/web/ui.css`).

## Viewers

`VideoViewer` and `CanvasViewer` share the base class `Viewer`. A viewer only
uses the element you pass: it renders no UI and never changes the DOM
structure. One element can have one viewer at a time.

```ts
new VideoViewer(video: HTMLVideoElement, options?: ViewerOptions)
new CanvasViewer(canvas: HTMLCanvasElement, options?: ViewerOptions)
```

### Common methods (`Viewer`)

| Member | Description |
|---|---|
| `status` | Current [`StreamStatus`](#status) |
| `onStatus(listener)` | Gets the current status right away and every change, including destruction |
| `pause()` | Stops presenting frames and tells the application to stop producing them |
| `resume()` | Requests frames again |
| `scene` | Current [`SceneState`](#scene) |
| `onSceneChange(listener)` | Gets the current scene right away and every change |
| `onSceneError(listener)` | Gets visibility requests that timed out and were dropped |
| `onCommand(listener)` | Gets the [commands](#commands) to forward to the renderer |
| `updateScene(snapshot)` | Applies a complete scene snapshot from the renderer. Settles all pending requests. |
| `setVisibility(id, visible)` | Requests a visibility change. Always emits a command, even for an unchanged value. |
| `resetCamera()` | Requests the renderer's initial camera view |
| `focusCamera(id)` | Requests the camera to point at a scene element, visible or not |
| `destroy()` | Releases the element and all listeners. Safe to call more than once. |

Every `on*` method returns a function that removes the listener. A listener
that throws is reported and does not stop the others.

### `VideoViewer`

| Method | Description |
|---|---|
| `setStream(stream)` | Shows a `MediaStream`. Replacing it keeps the paused state. |
| `clearView()` | Detaches the stream and releases demand. Call `resume()` to request frames again. |
| `resume()` | Also retries playback, for example after the browser blocked autoplay |

`destroy()` pauses the video and clears `srcObject`, but does not stop the
stream's tracks.

### `CanvasViewer`

| Method | Description |
|---|---|
| `showFrame(frame)` | Draws an `RgbaFrame` and resizes the canvas to it. Ignored while paused. |
| `framePresented()` | Reports a frame the renderer drew on the canvas itself (WebGL, WebGPU, or an `OffscreenCanvas` in a worker) |

The viewer takes no canvas context until the first `showFrame()`, so the
renderer may draw on the canvas itself. Do not mix the two: `showFrame()`
throws once the renderer draws on the canvas.

`RgbaFrame` is `{ width, height, data }`: RGBA, 8 bits per channel, rows from
the top, no padding, `width * height * 4` bytes (`Uint8ClampedArray` or
`Uint8Array`, for example a view on WASM memory). The data is read right away
and not kept.

## Status

`StreamStatus` is `{ state, active, error }`.

- `state`: `'idle'`, `'waiting'`, `'playing'`, `'paused'`, `'blocked'`
  (the browser refused to autoplay), `'ended'`, `'error'` or `'destroyed'`.
- `active`: whether the viewer wants frames. It is the consumer's intent, not
  a sign that frames arrive. Use it to start and stop the producer.
- `error`: `{ name, message }` for `'error'` and `'blocked'`, otherwise `null`.

## Scene

The renderer owns the scene. The viewer mirrors it from the snapshots you pass
to `updateScene()`:

```ts
interface SceneSnapshot {
  elements: { id: string; label: string; visible: boolean }[];
}
```

`viewer.scene` (a `SceneState`) has the same elements plus `requested`: the
value of a visibility request still waiting for the renderer, or `null`.
`visible` always holds the renderer's value. The scene is empty until the
first snapshot.

A request that gets no snapshot within `sceneTimeout` is dropped
(`requested` is `null` again) and reported to `onSceneError` as
`{ id, reason: 'timeout' }`.

## Commands

`onCommand` delivers `ViewerCommand`s. Forward them to the renderer over your
transport.

| `type` | Fields | Meaning |
|---|---|---|
| `'setVisibility'` | `id`, `visible` | Show or hide a scene element for every viewer of the renderer. Never a toggle. |
| `'orbit'` | `yaw`, `pitch` | Rotate the camera around its target, in radians. Positive `yaw` for a drag to the right, positive `pitch` for a drag down. |
| `'pan'` | `x`, `y` | Move the camera in the view plane, in fractions of the displayed image height. Positive `x` for a drag to the right, `y` for a drag down. |
| `'dolly'` | `factor` | Multiply the distance to the target: above 1 moves away, below 1 moves closer |
| `'resetCamera'` | | Go back to the renderer's initial view |
| `'focusCamera'` | `id` | Move the orbit target to the element and fit it in view, keeping the viewing direction. Unknown ids are ignored. |

`CameraCommand` is the union of the camera commands. Camera commands are not
mirrored: nothing becomes pending and the renderer does not need to answer.

## Options

`ViewerOptions`, all optional:

| Option | Default | Description |
|---|---|---|
| `active` | `true` | Whether the viewer requests frames from the start |
| `sceneTimeout` | `5000` | Milliseconds a visibility request waits for a renderer snapshot |
| `cameraGestures` | `true` | Whether mouse gestures on the element emit camera commands |
| `dev.sceneStub` | `true` | While the renderer cannot report its scene, a built-in static scene answers visibility requests locally and no `setVisibility` or `focusCamera` commands are emitted. Pass `false` to use renderer snapshots. Temporary, not part of the stable API. |

## SceneList

```ts
import { SceneList } from '@r3v/web/ui';
import '@r3v/web/ui.css';

const list = new SceneList(container, viewer, { texts: { title: 'Objects' } });
list.destroy();
```

A panel listing the viewer's scene elements, each with a visibility switch and
a camera focus button. It is added to `container` without touching the rest of
its content. It only shows the viewer's state and turns clicks into viewer
requests, so commands still reach the renderer through your `onCommand`
listener. It uses only the public API, so you can build your own list the
same way.

`texts` replaces the default English texts (`SceneListTexts`):

| Key | Default |
|---|---|
| `title` | `Scene` |
| `count(visible, total)` | `${visible} of ${total} visible` |
| `empty` | `No scene elements` |
| `showing`, `hiding` | `Showing…`, `Hiding…` |
| `timeout` | `No answer` |
| `show(label)`, `hide(label)` | `Show ${label}`, `Hide ${label}` |
| `focus(label)` | `Focus camera on ${label}` |
