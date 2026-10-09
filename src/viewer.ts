import { CameraGestures } from './camera/camera-gestures.js';
import type { SourceSize } from './camera/camera-gestures.js';
import { Listeners } from './listeners.js';
import { answerStub, STUB_SCENE } from './scene/scene-stub.js';
import { SceneSync } from './scene/scene-sync.js';
import type {
  SceneErrorListener, SceneSnapshot, SceneState, SceneStateListener, StreamStatus, StreamStatusListener,
  ViewerCommand, ViewerCommandListener, ViewerOptions,
} from './types.js';

const activeSurfaces = new WeakSet<HTMLElement>();

/**
 * Presents renderer output on a developer-owned surface and mirrors renderer scene state.
 * Renders no UI and never changes the DOM structure; the application owns transport and UI.
 * Use `VideoViewer` for MediaStreams and `CanvasViewer` for a renderer running in the page.
 */
export abstract class Viewer {
  readonly #surface: HTMLElement;
  readonly #scene: SceneSync;
  readonly #commands: Listeners<ViewerCommand>;
  readonly #gestures: CameraGestures | undefined;
  readonly #sceneStub: boolean;
  #destroyed = false;

  /**
   * Subclasses validate their surface type before calling this. `sourceSize` reports the
   * presented image's intrinsic size, which camera gestures measure movement against.
   */
  protected constructor(surface: HTMLElement, options: ViewerOptions, sourceSize: SourceSize) {
    if (activeSurfaces.has(surface)) {
      throw new Error('This element already belongs to an active viewer.');
    }
    const sceneTimeout = options.sceneTimeout ?? 5000;
    if (!Number.isFinite(sceneTimeout) || sceneTimeout < 0) {
      throw new RangeError('sceneTimeout must be a non-negative number of milliseconds.');
    }

    this.#surface = surface;
    this.#commands = new Listeners();
    const sceneStub = this.#sceneStub = options.dev?.sceneStub ?? true;
    this.#scene = new SceneSync(sceneTimeout, (command) => {
      // The stub answers like a local renderer, so the renderer never sees visibility commands.
      if (sceneStub && command.type === 'setVisibility') this.#scene.update(answerStub(this.#scene.state, command));
      else this.#commands.emit(command);
    });
    if (sceneStub) this.#scene.update(STUB_SCENE);
    if (options.cameraGestures ?? true) {
      this.#gestures = new CameraGestures(surface, sourceSize, (command) => this.#commands.emit(command));
    }
    activeSurfaces.add(surface);
  }

  abstract get status(): StreamStatus;

  /** Receives the current status immediately and subsequent changes, including destruction. */
  abstract onStatus(listener: StreamStatusListener): () => void;

  /** Stops local presentation and requests the integrating application to suspend production. */
  abstract pause(): void;

  /** Requests frames again. */
  abstract resume(): void;

  get scene(): SceneState { return this.#scene.state; }

  /** Receives the current scene immediately and subsequent changes. */
  onSceneChange(listener: SceneStateListener): () => void { return this.#scene.onChange(listener); }

  /** Receives requests that timed out and were dropped. */
  onSceneError(listener: SceneErrorListener): () => void { return this.#scene.onError(listener); }

  /** Receives requests to forward to the renderer over the application's transport. */
  onCommand(listener: ViewerCommandListener): () => void {
    if (this.#destroyed) throw new Error('The viewer has been destroyed.');
    return this.#commands.subscribe(listener);
  }

  /** Applies a complete renderer snapshot, which settles all pending requests. */
  updateScene(snapshot: SceneSnapshot): void { this.#scene.update(snapshot); }

  /**
   * Requests a visibility change. `visible` keeps the renderer's value and `requested` holds this
   * one until the next renderer snapshot. Always emits a command, even for an unchanged value.
   */
  setVisibility(id: string, visible: boolean): void { this.#scene.setVisibility(id, visible); }

  /** Requests the renderer's initial camera view. */
  resetCamera(): void {
    if (this.#destroyed) throw new Error('The viewer has been destroyed.');
    this.#commands.emit({ type: 'resetCamera' });
  }

  /**
   * Requests the renderer to point the camera at a scene element, visible or not. Like the other
   * camera commands it is not mirrored: nothing becomes pending and the renderer need not answer.
   */
  focusCamera(id: string): void {
    if (this.#destroyed) throw new Error('The viewer has been destroyed.');
    if (!this.#scene.state.elements.some((element) => element.id === id)) {
      throw new RangeError(`Unknown scene element: ${id}`);
    }
    // The renderer does not know the stub's elements.
    if (!this.#sceneStub) this.#commands.emit({ type: 'focusCamera', id });
  }

  /** Releases the surface and all listeners. Safe to call repeatedly. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    activeSurfaces.delete(this.#surface);
    this.#gestures?.destroy();
    this.#scene.destroy();
    this.#commands.close();
    this.destroySurface();
  }

  /** Called once by destroy(); publishes the final `destroyed` status. */
  protected abstract destroySurface(): void;
}
