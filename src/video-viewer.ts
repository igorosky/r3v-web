import { MediaStreamView } from './view/media-stream-view.js';
import { Viewer } from './viewer.js';
import type { StreamStatus, StreamStatusListener, ViewerOptions } from './types.js';

/** Presents a MediaStream (e.g. from WebRTC) on a developer-owned video. */
export class VideoViewer extends Viewer {
  /** The developer-owned video the viewer presents on. */
  readonly video: HTMLVideoElement;
  readonly #view: MediaStreamView;

  constructor(video: HTMLVideoElement, options: ViewerOptions = {}) {
    super(dedicatedVideo(video), options, () => [video.videoWidth, video.videoHeight]);
    this.video = video;
    // A silent live view: autoplay-safe and without native controls that bypass consumer intent.
    video.autoplay = false;
    video.controls = false;
    video.muted = true;
    video.playsInline = true;
    this.#view = new MediaStreamView(video, options.active ?? true);
  }

  get status(): StreamStatus { return this.#view.status; }

  onStatus(listener: StreamStatusListener): () => void { return this.#view.onStatus(listener); }

  pause(): void { this.#view.pause(); }

  /** Requests frames and retries playback, including after an autoplay rejection. */
  resume(): void { this.#view.resume(); }

  /** Replaces the source while preserving whether this consumer is paused. */
  setStream(stream: MediaStream): void { this.#view.setStream(stream); }

  /** Detaches the source and releases demand; call resume() to request frames again. */
  clearView(): void { this.#view.clearView(); }

  /** Pauses the video and clears srcObject. Does not stop tracks. */
  protected destroySurface(): void { this.#view.destroy(); }
}

function dedicatedVideo(video: HTMLVideoElement): HTMLVideoElement {
  const VideoType = video?.ownerDocument?.defaultView?.HTMLVideoElement;
  if (!VideoType || !(video instanceof VideoType)) {
    throw new TypeError('VideoViewer needs a video element in a browser document.');
  }
  // Clearing srcObject would otherwise fall back to loading these URL sources.
  if (video.hasAttribute('src') || video.querySelector(':scope > source')) {
    throw new Error('Use a dedicated video without src or <source> children; the viewer assigns srcObject.');
  }
  return video;
}
