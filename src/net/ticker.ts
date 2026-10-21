/**
 * A steady clock for the peer-to-peer host.
 *
 * Browsers throttle `setInterval` in a tab that is not in front, and a
 * throttled host clock slows the match down for everyone in the room. Timers
 * inside a worker are not throttled the same way, so the clock lives there and
 * the page only reacts to its messages.
 *
 * The worker is built from a blob, so it needs no separate entry point and
 * survives any bundler. If workers are unavailable the timer falls back to the
 * main thread, which still works - just not in a background tab.
 */

const WORKER_SOURCE = `
let id = null;
self.onmessage = (e) => {
  if (e.data && e.data.t === 'start') {
    if (id !== null) clearInterval(id);
    id = setInterval(() => self.postMessage(0), e.data.ms);
  } else if (e.data && e.data.t === 'stop') {
    if (id !== null) clearInterval(id);
    id = null;
  }
};
`;

export type StopTicker = () => void;

export function createTicker(intervalMs: number, onTick: () => void): StopTicker {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = () => onTick();
      worker.postMessage({ t: 'start', ms: intervalMs });
      return () => {
        worker.postMessage({ t: 'stop' });
        worker.terminate();
        URL.revokeObjectURL(url);
      };
    } catch {
      // Blocked by a strict content policy; fall through to the plain timer.
    }
  }

  const id = setInterval(onTick, intervalMs);
  return () => clearInterval(id);
}
