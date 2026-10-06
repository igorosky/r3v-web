export type StreamState = 'idle' | 'waiting' | 'playing' | 'paused' | 'blocked' | 'ended' | 'error' | 'destroyed';

export interface StreamStatus {
  readonly state: StreamState;
  /** Consumer intent, not a claim that frames are arriving. Use it to control the producer. */
  readonly active: boolean;
  readonly error: Readonly<{ name: string; message: string }> | null;
}

export type StreamStatusListener = (status: StreamStatus) => void;

/** A CPU-rendered frame: RGBA, 8 bits per channel, rows from the top, no padding. */
export interface RgbaFrame {
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes, e.g. a view on WASM memory. Read synchronously, never retained. */
  readonly data: Uint8ClampedArray | Uint8Array;
}

/** A scene element whose visibility can be set, as reported by the renderer. */
export interface SceneElementSnapshot {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
}

/** The complete scene description sent by the renderer, or by the application in its place. */
export interface SceneSnapshot {
  readonly elements: readonly SceneElementSnapshot[];
}

export interface SceneElement extends SceneElementSnapshot {
  /**
   * The value of a request awaiting the renderer, or `null` when nothing is pending.
   * `visible` always holds the renderer's value.
   */
  readonly requested: boolean | null;
}

export interface SceneState {
  /** Empty until the first renderer snapshot. */
  readonly elements: readonly SceneElement[];
}

export type SceneStateListener = (scene: SceneState) => void;

export interface SceneError {
  readonly id: string;
  /** No renderer snapshot arrived in time; the request was dropped (`requested` is `null` again). */
  readonly reason: 'timeout';
}

export type SceneErrorListener = (error: SceneError) => void;

/** Sets visibility for every subscriber of the renderer; never a toggle. */
export interface SetVisibilityCommand {
  readonly type: 'setVisibility';
  readonly id: string;
  readonly visible: boolean;
}

/**
 * Rotates the camera around its target, in radians. The scene follows the pointer: `yaw` is
 * positive for a drag to the right, `pitch` for a drag down.
 */
export interface OrbitCommand {
  readonly type: 'orbit';
  readonly yaw: number;
  readonly pitch: number;
}

/**
 * Moves the camera in the view plane so the scene follows the pointer, in fractions of the
 * displayed image height (the same unit on both axes): `x` is positive for a drag to the right,
 * `y` for a drag down. The renderer scales by the visible height at the target distance.
 */
export interface PanCommand {
  readonly type: 'pan';
  readonly x: number;
  readonly y: number;
}

/** Multiplies the camera's distance to its target: above 1 moves away, below 1 moves closer. */
export interface DollyCommand {
  readonly type: 'dolly';
  readonly factor: number;
}

/** Returns the camera to the renderer's initial view. */
export interface ResetCameraCommand {
  readonly type: 'resetCamera';
}

/**
 * Points the camera at a scene element, visible or not: the renderer moves the orbit target to
 * the element and fits it in view, keeping the viewing direction. Unknown ids are ignored.
 */
export interface FocusCameraCommand {
  readonly type: 'focusCamera';
  readonly id: string;
}

/** Camera movement; the camera state lives in the renderer. */
export type CameraCommand = OrbitCommand | PanCommand | DollyCommand | ResetCameraCommand | FocusCameraCommand;

/** A request the application forwards to the renderer over its own transport. */
export type ViewerCommand = SetVisibilityCommand | CameraCommand;

export type ViewerCommandListener = (command: ViewerCommand) => void;

export interface ViewerOptions {
  /** Whether the viewer initially requests frames. Defaults to true. */
  active?: boolean;
  /** Milliseconds a scene request waits for a renderer snapshot. Defaults to 5000. */
  sceneTimeout?: number;
  /**
   * Whether mouse gestures on the surface emit camera commands: left drag orbits, right or
   * middle drag pans, the wheel dollies. Defaults to true.
   */
  cameraGestures?: boolean;
  /** Temporary development switches; not part of the stable API. */
  dev?: {
    /**
     * While the renderer cannot report its scene, a built-in static scene answers visibility
     * requests locally and no `setVisibility` or `focusCamera` commands are emitted. Defaults
     * to true; pass false to use renderer snapshots and commands.
     */
    sceneStub?: boolean;
  };
}
