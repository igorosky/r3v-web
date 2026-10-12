import type { RgbaFrame, SceneSnapshot, ViewerCommand } from '../../src/index.js';

export interface DemoConnection {
  /** This client's demand; the renderer draws while any connected client needs frames. */
  setActive(active: boolean): void;
  send(command: ViewerCommand): void;
  close(): void;
}

interface Client {
  active: boolean;
  /** False simulates the MVP renderer: no scene snapshots, visibility commands are not understood. */
  readonly reportsScene: boolean;
  readonly onSnapshot: (snapshot: SceneSnapshot) => void;
  /** Receives CPU frames as RGBA buffers, like a WASM renderer handing frames to JS. */
  readonly onRgbaFrame: ((frame: RgbaFrame) => void) | undefined;
}

/**
 * A local stand-in for a remote renderer. Scene visibility is global: every connected client
 * receives a snapshot after each change. Messages arrive after a simulated network latency.
 */
export function createDemoRenderer(options: {
  latency: number;
  onFrame(count: number): void;
  onDemand(active: boolean): void;
}) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  const ctx = context;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const scene = new Map([
    ['grid', { label: 'Grid', visible: true }],
    ['arm', { label: 'Robot arm', visible: true }],
    ['overlay', { label: 'Overlay text', visible: true }],
  ]);
  const clients = new Set<Client>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let answersVisibility = true;
  /** The demo has no camera: the element it was last pointed at is framed for a moment instead. */
  let focus: { id: string; until: number } | undefined;
  let animation: number | undefined;
  let rendering = false;
  let frames = 0;
  let lastFrame = -Infinity;

  function later(callback: () => void): void {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, options.latency);
    timers.add(timer);
  }

  function snapshot(): SceneSnapshot {
    return { elements: [...scene].map(([id, { label, visible }]) => ({ id, label, visible })) };
  }

  function updateDemand(): void {
    const active = [...clients].some((client) => client.active);
    if (active === rendering) return;
    rendering = active;
    options.onDemand(active);
    if (animation !== undefined) cancelAnimationFrame(animation);
    animation = undefined;
    if (active) { lastFrame = -Infinity; draw(performance.now()); }
  }

  function draw(now: number): void {
    if (!rendering) return;
    if (now - lastFrame >= 1000 / 30) {
      lastFrame = now;
      ctx.fillStyle = '#0d1723';
      ctx.fillRect(0, 0, 960, 540);
      if (scene.get('grid')?.visible) {
        ctx.strokeStyle = '#1b2d3d';
        ctx.lineWidth = 1;
        for (let x = 0; x < 960; x += 48) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 540); ctx.stroke();
        }
        for (let y = 0; y < 540; y += 48) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(960, y); ctx.stroke();
        }
      }
      const angle = -.7 + Math.sin(now / 1600) * .35;
      const elbow = { x: 435 + Math.sin(angle) * 165, y: 395 - Math.cos(angle) * 165 };
      const wrist = { x: elbow.x + Math.cos(now / 2200) * 150, y: elbow.y - 105 };
      if (scene.get('arm')?.visible) {
        ctx.strokeStyle = '#92cbbb';
        ctx.lineWidth = 26;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(435, 395); ctx.lineTo(elbow.x, elbow.y); ctx.lineTo(wrist.x, wrist.y); ctx.stroke();
        ctx.fillStyle = '#d0ede0';
        for (const point of [{ x: 435, y: 395 }, elbow, wrist]) {
          ctx.beginPath(); ctx.arc(point.x, point.y, 17, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#496d6c';
        ctx.fillRect(365, 420, 140, 18);
      }
      frames += 1;
      if (scene.get('overlay')?.visible) {
        ctx.fillStyle = '#b9dacc';
        ctx.font = '16px system-ui';
        ctx.fillText('DEMO RENDERER / LIVE', 32, 42);
        ctx.fillStyle = '#78909e';
        ctx.font = '14px monospace';
        ctx.fillText(`FRAME ${String(frames).padStart(6, '0')}`, 32, 505);
      }
      const focused = focus && now < focus.until ? scene.get(focus.id) : undefined;
      if (focus && focused) {
        // Bounds as x, y, width, height; hidden elements have them too.
        const left = Math.min(365, elbow.x, wrist.x) - 30;
        const top = Math.min(elbow.y, wrist.y) - 30;
        const [x, y, width, height] = focus.id === 'arm'
          ? [left, top, Math.max(505, elbow.x, wrist.x) + 30 - left, 468 - top]
          : focus.id === 'overlay' ? [16, 16, 250, 506] : [6, 6, 948, 528];
        ctx.save();
        ctx.strokeStyle = ctx.fillStyle = '#e2c58a';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(x, y, width, height);
        ctx.font = '13px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`CAMERA FOCUS: ${focused.label.toUpperCase()}`, x + width - 10, y + height - 12);
        ctx.restore();
      }
      track.requestFrame();
      const receivers = [...clients].filter((client) => client.active && client.onRgbaFrame);
      if (receivers.length) {
        const frame = { width: 960, height: 540, data: ctx.getImageData(0, 0, 960, 540).data };
        for (const client of receivers) client.onRgbaFrame?.(frame);
      }
      options.onFrame(frames);
    }
    animation = requestAnimationFrame(draw);
  }

  return {
    stream,
    /** Simulates an MVP renderer that ignores visibility requests. */
    setAnswersVisibility(value: boolean): void { answersVisibility = value; },
    connect(
      onSnapshot: (snapshot: SceneSnapshot) => void,
      { reportsScene = true, onRgbaFrame }: { reportsScene?: boolean; onRgbaFrame?: (frame: RgbaFrame) => void } = {},
    ): DemoConnection {
      const client: Client = { active: false, reportsScene, onSnapshot, onRgbaFrame };
      clients.add(client);
      later(() => { if (clients.has(client) && reportsScene) onSnapshot(snapshot()); });
      return {
        setActive(active) { client.active = active; updateDemand(); },
        send(command) {
          if (command.type === 'focusCamera') {
            later(() => {
              if (clients.has(client) && scene.has(command.id)) focus = { id: command.id, until: performance.now() + 1500 };
            });
            return;
          }
          // The demo renderer has no other camera control.
          if (command.type !== 'setVisibility') return;
          later(() => {
            const element = scene.get(command.id);
            if (!clients.has(client) || !reportsScene || !answersVisibility || !element) return;
            element.visible = command.visible;
            const current = snapshot();
            for (const other of clients) if (other.reportsScene) other.onSnapshot(current);
          });
        },
        close() { clients.delete(client); updateDemand(); },
      };
    },
    destroy(): void {
      clients.clear();
      timers.forEach(clearTimeout);
      updateDemand();
      stream.getTracks().forEach((item) => item.stop());
    },
  };
}
