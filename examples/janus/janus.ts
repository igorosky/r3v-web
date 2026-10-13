/**
 * A minimal receive-only client for one Janus Streaming mountpoint over the Janus REST API.
 * Application code, not part of the library: it only produces a MediaStream for VideoViewer.
 */
export interface JanusWatch {
  close(): void;
}

interface JanusMessage {
  janus: string;
  transaction?: string;
  data?: { id: number };
  error?: { code: number; reason: string };
  plugindata?: { data: { error?: string } };
  jsep?: RTCSessionDescriptionInit;
}

export async function watchMountpoint(options: {
  /** Janus REST base URL, e.g. `/janus` behind the Vite proxy. */
  url: string;
  mountpoint: number;
  onStream: (stream: MediaStream) => void;
  onError: (error: Error) => void;
}): Promise<JanusWatch> {
  const { url, mountpoint, onStream, onError } = options;
  const closed = new AbortController();
  const signal = closed.signal;

  async function request(path: string, body: object): Promise<JanusMessage> {
    const response = await fetch(path, {
      method: 'POST',
      body: JSON.stringify({ ...body, transaction: crypto.randomUUID() }),
      signal,
    });
    return checked(await response.json() as JanusMessage);
  }

  const session = `${url}/${(await request(url, { janus: 'create' })).data!.id}`;
  let handle = '';
  const pc = new RTCPeerConnection();
  // Received frames are shown as soon as possible instead of being smoothed for jitter.
  pc.addEventListener('track', ({ receiver, streams, track }) => {
    if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0;
    onStream(streams[0] ?? new MediaStream([track]));
  });

  // Janus sends its offer and plugin events through long polling on the session.
  async function poll(): Promise<void> {
    while (!signal.aborted) {
      const response = await fetch(`${session}?rid=${Date.now()}`, { signal });
      const message = checked(await response.json() as JanusMessage);
      if (message.jsep?.type === 'offer') await answer(message.jsep);
      if (message.janus === 'hangup') throw new Error('Janus hung up the stream.');
    }
  }

  async function answer(offer: RTCSessionDescriptionInit): Promise<void> {
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    // Without trickle ICE the answer carries all candidates; host candidates gather quickly.
    if (pc.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve) => {
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') resolve();
        });
      });
    }
    const { type, sdp } = pc.localDescription!;
    await request(handle, { janus: 'message', body: { request: 'start' }, jsep: { type, sdp, trickle: false } });
  }

  function fail(error: unknown): void {
    if (signal.aborted) return;
    close();
    onError(error instanceof Error ? error : new Error(String(error)));
  }

  function close(): void {
    if (signal.aborted) return;
    closed.abort();
    clearInterval(keepalive);
    pc.close();
    void fetch(session, {
      method: 'POST',
      body: JSON.stringify({ janus: 'destroy', transaction: crypto.randomUUID() }),
    }).catch(() => {});
  }

  // Janus drops sessions after 60 s without requests.
  const keepalive = setInterval(() => request(session, { janus: 'keepalive' }).catch(fail), 25_000);
  try {
    handle = `${session}/${(await request(session, { janus: 'attach', plugin: 'janus.plugin.streaming' })).data!.id}`;
    void poll().catch(fail);
    await request(handle, { janus: 'message', body: { request: 'watch', id: mountpoint } });
  } catch (error) {
    close();
    throw error;
  }
  return { close };
}

function checked(message: JanusMessage): JanusMessage {
  const error = message.error?.reason ?? message.plugindata?.data.error;
  if (error) throw new Error(`Janus: ${error}`);
  return message;
}
