import { afterEach, describe, expect, it } from 'vitest';
import { VideoViewer } from '../../src/index.js';

const viewers: VideoViewer[] = [];
const fixtures: HTMLElement[] = [];
const tracks: MediaStreamTrack[] = [];

function video(): HTMLVideoElement {
  const host = document.createElement('div');
  const element = document.createElement('video');
  host.append(element);
  document.body.append(host);
  fixtures.push(host);
  return element;
}

function attach(target: HTMLVideoElement): VideoViewer {
  const viewer = new VideoViewer(target);
  viewers.push(viewer);
  return viewer;
}

function stream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  canvas.getContext('2d')?.fillRect(0, 0, 16, 16);
  const result = canvas.captureStream(0);
  tracks.push(...result.getTracks());
  return result;
}

afterEach(() => {
  viewers.splice(0).forEach((viewer) => viewer.destroy());
  fixtures.splice(0).forEach((host) => host.remove());
  tracks.splice(0).forEach((track) => track.stop());
});

describe('VideoViewer lifecycle', () => {
  it('configures a silent live view without changing the DOM structure', () => {
    const target = video();
    const host = target.parentElement!;
    host.prepend(document.createElement('span'));
    const nodes = [...host.childNodes];
    target.controls = true;
    target.autoplay = true;
    let clicks = 0;
    target.addEventListener('click', () => { clicks += 1; });

    const viewer = attach(target);
    expect(viewer.video).toBe(target);
    expect([...host.childNodes]).toEqual(nodes);
    expect(target.childNodes).toHaveLength(0);
    expect(target).toMatchObject({ controls: false, autoplay: false, muted: true, playsInline: true });
    viewer.destroy();
    expect([...host.childNodes]).toEqual(nodes);
    target.click();
    expect(clicks).toBe(1);
  });

  it('supports repeated attach/destroy on the same video, as in framework remounts', () => {
    const target = video();
    const media = stream();
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const viewer = attach(target);
      viewer.setStream(media);
      expect(target.srcObject).toBe(media);
      viewer.destroy();
      viewer.destroy();
      expect(target.srcObject).toBeNull();
    }
    expect(media.getVideoTracks()[0]?.readyState).toBe('live');
  });

  it('rejects unsupported targets and options', () => {
    expect(() => new VideoViewer(document.createElement('div') as unknown as HTMLVideoElement)).toThrow(TypeError);
    const withSrc = video();
    withSrc.src = 'data:,';
    expect(() => new VideoViewer(withSrc)).toThrow('dedicated video');
    const withSource = video();
    withSource.append(document.createElement('source'));
    expect(() => new VideoViewer(withSource)).toThrow('dedicated video');
    expect(() => new VideoViewer(video(), { sceneTimeout: -1 })).toThrow(RangeError);
  });

  it('rejects duplicate ownership until the active viewer is destroyed', () => {
    const target = video();
    const viewer = attach(target);
    expect(() => new VideoViewer(target)).toThrow('already belongs');
    viewer.destroy();
    expect(attach(target).video).toBe(target);
  });

  it('keeps instances independent', () => {
    const first = attach(video());
    const second = attach(video());
    first.destroy();
    expect(first.status.state).toBe('destroyed');
    expect(second.status.state).toBe('idle');
    expect(second.video.muted).toBe(true);
  });

  it('rejects calls after destruction while keeping the final status readable', () => {
    const viewer = attach(video());
    viewer.destroy();
    expect(viewer.status).toMatchObject({ state: 'destroyed', active: false });
    expect(() => viewer.resume()).toThrow('destroyed');
    expect(() => viewer.onCommand(() => {})).toThrow('destroyed');
    expect(() => viewer.updateScene({ elements: [] })).toThrow('destroyed');
  });
});
