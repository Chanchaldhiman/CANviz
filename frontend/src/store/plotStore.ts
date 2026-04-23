import { create } from 'zustand';

export const SIGNAL_COLORS = [
  '#22c55e',  // green
  '#3b82f6',  // blue
  '#f59e0b',  // amber
  '#ec4899',  // pink
  '#8b5cf6',  // purple
  '#06b6d4',  // cyan
  '#ef4444',  // red
  '#f97316',  // orange
];

export const MAX_SIGNALS    = 8;
export const DISPLAY_POINTS = 2_000;

// ─── Ring buffers - module scope, never in Zustand ───────────────────────────

const MAX_POINTS = 36_000;

interface RingBuffer {
  ts:    Float64Array;
  vs:    Float32Array;
  head:  number;
  count: number;
}

const ringBuffers = new Map<string, RingBuffer>();

function createRingBuffer(): RingBuffer {
  return { ts: new Float64Array(MAX_POINTS), vs: new Float32Array(MAX_POINTS), head: 0, count: 0 };
}

function writePoint(buf: RingBuffer, t: number, v: number): void {
  buf.ts[buf.head] = t;
  buf.vs[buf.head] = v;
  buf.head = (buf.head + 1) % MAX_POINTS;
  if (buf.count < MAX_POINTS) buf.count++;
}

export function readBuffer(buf: RingBuffer): [Float64Array, Float32Array] {
  const n = buf.count;
  if (n === 0) return [new Float64Array(0), new Float32Array(0)];
  if (n < MAX_POINTS) return [buf.ts.subarray(0, n), buf.vs.subarray(0, n)];
  const ts = new Float64Array(MAX_POINTS);
  const vs = new Float32Array(MAX_POINTS);
  const tail = MAX_POINTS - buf.head;
  ts.set(buf.ts.subarray(buf.head), 0); ts.set(buf.ts.subarray(0, buf.head), tail);
  vs.set(buf.vs.subarray(buf.head), 0); vs.set(buf.vs.subarray(0, buf.head), tail);
  return [ts, vs];
}

// ─── Public write API (called from frameStore) ────────────────────────────────

export function addSignalValues(
  signals: Array<{ name: string; message_name: string; value: unknown }>,
  timestampSec: number,
): void {
  const newKeys: string[] = [];
  for (const sig of signals) {
    const v = Number(sig.value);
    if (!Number.isFinite(v)) continue;
    const key = `${sig.message_name}.${sig.name}`;
    if (!ringBuffers.has(key)) {
      ringBuffers.set(key, createRingBuffer());
      newKeys.push(key);
    }
    writePoint(ringBuffers.get(key)!, timestampSec, v);
  }
  if (newKeys.length > 0) {
    usePlotStore.setState((s) => ({
      availableSignals: [...s.availableSignals, ...newKeys],
    }));
  }
}

export function getSignalBuffer(key: string) {
  return ringBuffers.get(key);
}

// Returns the most recent timestamp across all selected signals
export function getLatestTimestamp(keys: string[]): number {
  let latest = 0;
  for (const key of keys) {
    const buf = ringBuffers.get(key);
    if (!buf || buf.count === 0) continue;
    // Most recent write is one behind head in the ring
    const lastIdx = (buf.head - 1 + MAX_POINTS) % MAX_POINTS;
    if (buf.ts[lastIdx] > latest) latest = buf.ts[lastIdx];
  }
  return latest;
}

export function getLatestValue(key: string): number | null {
  const buf = ringBuffers.get(key);
  if (!buf || buf.count === 0) return null;
  const lastIdx = (buf.head - 1 + MAX_POINTS) % MAX_POINTS;
  return buf.vs[lastIdx];
}

// ─── Zustand - UI state only ──────────────────────────────────────────────────

interface PlotStore {
  selectedSignals:  string[];
  availableSignals: string[];
  windowSec:        number;
  toggleSignal:     (key: string) => void;
  setWindowSec:     (s: number) => void;
  clearBuffers:     () => void;
}

export const usePlotStore = create<PlotStore>((set, get) => ({
  selectedSignals:  [],
  availableSignals: [],
  windowSec:        60,

  toggleSignal: (key) => {
    const { selectedSignals } = get();
    if (selectedSignals.includes(key)) {
      set({ selectedSignals: selectedSignals.filter((k) => k !== key) });
    } else if (selectedSignals.length < MAX_SIGNALS) {
      set({ selectedSignals: [...selectedSignals, key] });
    }
  },

  setWindowSec: (windowSec) => set({ windowSec }),

  clearBuffers: () => {
    ringBuffers.clear();
    set({ selectedSignals: [], availableSignals: [] });
  },
}));