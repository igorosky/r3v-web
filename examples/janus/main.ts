import { Ros, Topic } from 'roslib';
import { VideoViewer } from '../../src/index.js';
import type { CameraCommand } from '../../src/index.js';
import { watchMountpoint } from './janus.js';
import type { JanusWatch } from './janus.js';
import '../basic/style.css';

const JANUS_URL = '/janus';
const MOUNTPOINT = 1;
/** rosbridge, proxied by the dev server. */
const ROSBRIDGE_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rosbridge`;

interface Vector3 { x: number; y: number; z: number }
/** geometry_msgs/msg/Twist, used as one gesture's camera movement rather than a velocity. */
interface Twist { linear: Vector3; angular: Vector3 }

/** Camera topics the renderer subscribes to. */
class CameraTopics {
  readonly #move: Topic<Twist>;
  readonly #reset: Topic<Record<string, never>>;

  constructor(ros: Ros) {
    this.#move = new Topic({ ros, name: '/r3v/camera/move', messageType: 'geometry_msgs/msg/Twist' });
    this.#reset = new Topic({ ros, name: '/r3v/camera/reset', messageType: 'std_msgs/msg/Empty' });
  }

  publish(command: CameraCommand): void {
    const linear = { x: 0, y: 0, z: 0 };
    const angular = { x: 0, y: 0, z: 0 };
    switch (command.type) {
      case 'orbit': angular.z = command.yaw; angular.y = command.pitch; break;
      case 'pan': linear.x = command.x; linear.y = command.y; break;
      // A logarithm, so movements add up; the renderer takes the exponent.
      case 'dolly': linear.z = Math.log(command.factor); break;
      case 'resetCamera': this.#reset.publish({}); return;
      // Needs scene elements in the renderer; until then the scene stub never sends it.
      case 'focusCamera': return;
    }
    this.#move.publish({ linear, angular });
  }
}

function get<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing example element: ${selector}`);
  return element;
}

const video = get<HTMLVideoElement>('video');
const status = get('[role="status"]');
const errorText = get('[data-error]');
const connectButton = get<HTMLButtonElement>('[data-action="connect"]');
const disconnectButton = get<HTMLButtonElement>('[data-action="disconnect"]');
const resetButton = get<HTMLButtonElement>('[data-action="reset"]');
const controlStatus = get('[data-control]');
let viewer: VideoViewer | undefined;
let watch: JanusWatch | undefined;
let ros: Ros | undefined;

/** Camera commands go over ROS: Janus Streaming only carries video one way. */
function openRos(): Ros {
  const current = new Ros({ url: ROSBRIDGE_URL });
  current.on('connection', () => { if (ros === current) controlStatus.textContent = 'connected'; });
  current.on('close', () => { if (ros === current) controlStatus.textContent = 'disconnected'; });
  return current;
}

function disconnect(): void {
  ros?.close();
  ros = undefined;
  controlStatus.textContent = 'disconnected';
  watch?.close();
  watch = undefined;
  viewer?.destroy();
  viewer = undefined;
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  resetButton.disabled = true;
}

async function connect(): Promise<void> {
  connectButton.disabled = true;
  disconnectButton.disabled = false;
  resetButton.disabled = false;
  errorText.textContent = '';
  const current = viewer = new VideoViewer(video);
  const camera = new CameraTopics(ros = openRos());
  // Gestures on the video become camera commands; the application publishes them.
  current.onCommand((command) => {
    if (command.type !== 'setVisibility') camera.publish(command);
  });
  current.onStatus(({ state, error }) => {
    status.textContent = state;
    status.dataset.active = String(state === 'playing');
    if (error) errorText.textContent = `${error.name}: ${error.message}`;
  });
  try {
    const opened = await watchMountpoint({
      url: JANUS_URL,
      mountpoint: MOUNTPOINT,
      onStream: (stream) => current.setStream(stream),
      onError: (error) => { disconnect(); errorText.textContent = error.message; },
    });
    // Disconnected while Janus was answering.
    if (viewer !== current) opened.close();
    else watch = opened;
  } catch (error) {
    if (viewer !== current) return;
    disconnect();
    errorText.textContent = error instanceof Error ? error.message : String(error);
  }
}

connectButton.addEventListener('click', () => void connect());
disconnectButton.addEventListener('click', disconnect);
resetButton.addEventListener('click', () => viewer?.resetCamera());
void connect();
