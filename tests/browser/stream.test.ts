import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoViewer } from '../../src/index.js';
import type { StreamStatus, ViewerOptions } from '../../src/index.js';

const viewers: VideoViewer[] = [];
const videos: HTMLVideoElement[] = [];
const cleanups: (() => void)[] = [];

function mount(options?: ViewerOptions): VideoViewer {
  const video = document.createElement('video');
  document.body.append(video);
  videos.push(video);
  const viewer = new VideoViewer(video, options);
  viewers.push(viewer);
  return viewer;
}

function source() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  let active = true;
  let frames = 0;
  const timer = setInterval(() => {
    if (!active) return;
    context.fillStyle = ++frames % 2 ? 'red' : 'blue';
    context.fillRect(0, 0, 32, 32);
    track.requestFrame();
  }, 20);
  cleanups.push(() => { clearInterval(timer); track.stop(); });
  return { stream, track, get frames() { return frames; }, setActive(value: boolean) { active = value; } };
}

async function playing(viewer: VideoViewer): Promise<void> {
  await vi.waitFor(() => expect(viewer.status.state).toBe('playing'), { timeout: 3000, interval: 20 });
}

afterEach(() => {
  viewers.splice(0).forEach((viewer) => viewer.destroy());
  cleanups.splice(0).forEach((cleanup) => cleanup());
  videos.splice(0).forEach((element) => element.remove());
  vi.restoreAllMocks();
});

describe('Live streams', () => {
  it('plays real frames, replaces the source, and clears it without stopping shared tracks', async () => {
    const viewer = mount();
    const first = source();
    const second = source();
    viewer.setStream(first.stream);
    await playing(viewer);
    expect(viewer.video.videoWidth).toBe(32);
    expect(viewer.video.muted).toBe(true);
    expect(viewer.video.controls).toBe(false);
    viewer.setStream(second.stream);
    await playing(viewer);
    expect(viewer.video.srcObject).toBe(second.stream);
    expect(first.track.readyState).toBe('live');
    viewer.clearView();
    expect(viewer.status).toMatchObject({ state: 'idle', active: false });
    expect(viewer.video.srcObject).toBeNull();
    expect(second.track.readyState).toBe('live');
  });

  it('lets the callback suspend the producer and resumes the same live stream', async () => {
    const viewer = mount();
    const producer = source();
    const statuses: StreamStatus[] = [];
    viewer.onStatus((status) => { statuses.push(status); producer.setActive(status.active); });
    viewer.setStream(producer.stream);
    await playing(viewer);
    viewer.pause();
    const count = producer.frames;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(producer.frames).toBe(count);
    expect(viewer.video.paused).toBe(true);
    expect(viewer.status).toMatchObject({ state: 'paused', active: false });
    expect(producer.track.readyState).toBe('live');
    viewer.resume();
    await playing(viewer);
    await vi.waitFor(() => expect(producer.frames).toBeGreaterThan(count));
    expect(statuses.some((status) => status.state === 'waiting' && status.active)).toBe(true);
    viewer.destroy();
    expect(statuses.at(-1)).toMatchObject({ state: 'destroyed', active: false });
  });

  it('can start inactive, request frames without a source, and keep replacements paused', async () => {
    const viewer = mount({ active: false });
    const statuses: StreamStatus[] = [];
    viewer.onStatus((status) => statuses.push(status));
    expect(statuses[0]).toMatchObject({ state: 'idle', active: false });
    viewer.resume();
    expect(statuses.at(-1)).toMatchObject({ state: 'idle', active: true });
    viewer.pause();
    const first = source();
    viewer.setStream(first.stream);
    viewer.setStream(source().stream);
    expect(viewer.status).toMatchObject({ state: 'paused', active: false });
    expect(viewer.video.paused).toBe(true);
    viewer.resume();
    await playing(viewer);
  });

  it('reports blocked autoplay and lets a user gesture retry without an unhandled rejection', async () => {
    const viewer = mount();
    const play = vi.spyOn(viewer.video, 'play').mockRejectedValueOnce(new DOMException('Interaction required', 'NotAllowedError'));
    viewer.setStream(source().stream);
    await vi.waitFor(() => expect(viewer.status.state).toBe('blocked'));
    expect(viewer.status.error?.name).toBe('NotAllowedError');
    expect(viewer.status.active).toBe(true);
    play.mockRestore();
    viewer.resume();
    await playing(viewer);
    expect(viewer.status.error).toBeNull();
  });

  it('reports playback failures separately from consumer intent', async () => {
    const viewer = mount();
    vi.spyOn(viewer.video, 'play').mockRejectedValue(new DOMException('Unsupported source', 'NotSupportedError'));
    viewer.setStream(source().stream);
    await vi.waitFor(() => expect(viewer.status.state).toBe('error'));
    expect(viewer.status).toMatchObject({ active: true, error: { name: 'NotSupportedError' } });
  });

  it('ignores an old playback rejection after replacing the source', async () => {
    const viewer = mount();
    let rejectOld!: (reason: unknown) => void;
    vi.spyOn(viewer.video, 'play').mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
    viewer.setStream(source().stream);
    viewer.setStream(source().stream);
    await playing(viewer);
    rejectOld(new DOMException('Old source', 'NotAllowedError'));
    await Promise.resolve();
    await Promise.resolve();
    expect(viewer.status.state).toBe('playing');
  });

  it('ignores pending playback completion after pause or destruction', async () => {
    const viewer = mount();
    let resolvePlay!: () => void;
    vi.spyOn(viewer.video, 'play').mockImplementationOnce(() => new Promise<void>((resolve) => { resolvePlay = resolve; }));
    viewer.setStream(source().stream);
    viewer.pause();
    resolvePlay();
    await Promise.resolve();
    expect(viewer.status.state).toBe('paused');
    viewer.destroy();
    viewer.video.dispatchEvent(new Event('playing'));
    expect(viewer.status.state).toBe('destroyed');
  });

  it('receives tracks added later and ignores old source events', async () => {
    const viewer = mount();
    const stream = new MediaStream();
    const producer = source();
    viewer.setStream(stream);
    expect(viewer.status).toMatchObject({ state: 'waiting', active: true });
    stream.addTrack(producer.track);
    // Local addTrack() does not dispatch addtrack; the video must notice the new source data.
    await playing(viewer);
    const next = source();
    viewer.setStream(next.stream);
    await playing(viewer);
    producer.track.stop();
    producer.track.dispatchEvent(new Event('ended'));
    stream.dispatchEvent(new Event('inactive'));
    expect(viewer.status.state).toBe('playing');
  });

  it('reports track end without treating it as a user request to pause', async () => {
    const viewer = mount();
    const producer = source();
    viewer.setStream(producer.stream);
    await playing(viewer);
    producer.track.stop();
    // stop() itself does not emit ended; remote track endings do.
    producer.track.dispatchEvent(new Event('ended'));
    expect(viewer.status).toMatchObject({ state: 'ended', active: true });
    viewer.setStream(source().stream);
    await playing(viewer);
  });

  it('allows a status callback to pause synchronously before playback starts', () => {
    const viewer = mount();
    const seen: string[] = [];
    const play = vi.spyOn(viewer.video, 'play');
    viewer.onStatus((status) => { if (status.state === 'waiting') viewer.pause(); });
    viewer.onStatus((status) => { seen.push(status.state); });
    viewer.setStream(source().stream);
    expect(play).not.toHaveBeenCalled();
    expect(viewer.status.state).toBe('paused');
    // Listeners also see the intermediate status, in emission order.
    expect(seen).toEqual(['idle', 'waiting', 'paused']);
  });

  it('allows a status callback to destroy the viewer and removes all subscriptions', () => {
    const viewer = mount();
    const listener = vi.fn<(status: StreamStatus) => void>();
    viewer.onStatus((status) => { if (status.state === 'waiting') viewer.destroy(); });
    const unsubscribe = viewer.onStatus(listener);
    viewer.setStream(source().stream);
    expect(viewer.status).toMatchObject({ state: 'destroyed', active: false });
    const calls = listener.mock.calls.length;
    viewer.video.dispatchEvent(new Event('waiting'));
    viewer.destroy();
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(() => viewer.resume()).toThrow('destroyed');
  });

  it('sends an initial immutable snapshot and supports unsubscribing', () => {
    const viewer = mount();
    const listener = vi.fn<(status: StreamStatus) => void>();
    const unsubscribe = viewer.onStatus(listener);
    expect(listener).toHaveBeenCalledWith({ state: 'idle', active: true, error: null });
    expect(Object.isFrozen(viewer.status)).toBe(true);
    unsubscribe();
    viewer.pause();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
