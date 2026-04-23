import { create } from 'zustand';
import type { CanFrame, FrameRow, FilterState } from '../types/can';
import { usePlotStore } from './plotStore';
import { addSignalValues } from './plotStore';

// Rolling window duration for rate calculation (ms)
const RATE_WINDOW_MS = 1000;

// Per-ID timestamp ring buffer for rate calculation
const rateBuckets = new Map<number, number[]>();

function calcRate(id: number, nowMs: number): number {
  const bucket = rateBuckets.get(id) ?? [];
  // Keep only timestamps within the window
  const cutoff = nowMs - RATE_WINDOW_MS;
  const trimmed = bucket.filter((t) => t > cutoff);
  trimmed.push(nowMs);
  rateBuckets.set(id, trimmed);
  return trimmed.length; // frames in last second
}

function toHex(id: number, extended: boolean): string {
  const digits = extended ? 8 : 3;
  return '0x' + id.toString(16).toUpperCase().padStart(digits, '0');
}

function dataToHex(data: number[]): string {
  return data.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

// Parse filter input: supports "1A2", "0x1A2", "100-200", "0x100-0x1FF"
function parseIdFilter(text: string): { min?: number; max?: number } {
  const t = text.trim();
  if (!t) return {};
  const rangeParts = t.split('-').map((p) => p.trim());
  if (rangeParts.length === 2) {
    const min = parseInt(rangeParts[0], 16);
    const max = parseInt(rangeParts[1], 16);
    if (!isNaN(min) && !isNaN(max)) return { min, max };
  }
  const single = parseInt(t.replace(/^0x/i, ''), 16);
  if (!isNaN(single)) return { min: single, max: single };
  return {};
}

interface FrameStore {
  // Raw frame map keyed by CAN ID (always numeric)
  frames: Map<number, FrameRow>;

  // Derived sorted array (updated on every ingest)
  frameList: FrameRow[];

  // Stats
  totalFramesReceived: number;
  framesPerSecond: number;      // overall bus fps
  _fpsTicker: number[];         // timestamps for overall fps

  // Filter
  filter: FilterState;

  // Actions
  ingestFrame: (frame: CanFrame) => void;
  clearFrames: () => void;
  setFilter: (patch: Partial<FilterState>) => void;
}

export const useFrameStore = create<FrameStore>((set, get) => ({
  frames: new Map(),
  frameList: [],
  totalFramesReceived: 0,
  framesPerSecond: 0,
  _fpsTicker: [],
  filter: {
    idText: '',
    signalName: '',
    showDecoded: true,
  },

  ingestFrame: (frame: CanFrame) => {
    const nowMs = Date.now();
    const store = get();

    // Normalise id: backend sends hex string "0x1a2" or int - always store as number
    const numericId = typeof frame.id === 'string'
      ? parseInt(frame.id, 16)
      : frame.id;

    // Normalise signals key: backend uses "signals", type also accepts "decoded_signals"
    const signals = frame.signals ?? frame.decoded_signals;

    // Overall fps
    const cutoff = nowMs - 1000;
    const fpsTicker = [...store._fpsTicker.filter((t) => t > cutoff), nowMs];
    const framesPerSecond = fpsTicker.length;

    // Per-ID rate
    const rate = calcRate(numericId, nowMs);

    const existing = store.frames.get(numericId);
    const updated: FrameRow = {
      id: numericId,
      idHex: toHex(numericId, frame.is_extended_id),
      dlc: frame.dlc,
      data: frame.data,
      dataHex: dataToHex(frame.data),
      count: (existing?.count ?? 0) + 1,
      rate,
      lastSeen: nowMs,
      isExtended: frame.is_extended_id,
      isFd: frame.is_fd,
      flashKey: nowMs,
      decodedSignals: signals,
    };

    // Feed decoded signals into the plot store
    if (signals?.length) {
      const tSec = nowMs / 1000;
      addSignalValues(signals, tSec);
    }

    const frames = new Map(store.frames);
    frames.set(numericId, updated);

    // Sort by ID ascending
    const frameList = Array.from(frames.values()).sort((a, b) => a.id - b.id);

    // Apply current filter
    const { filter } = store;
    const filteredList = applyFilter(frameList, filter);
    
    set({
      frames,
      frameList: filteredList,
      totalFramesReceived: store.totalFramesReceived + 1,
      framesPerSecond,
      _fpsTicker: fpsTicker,
    });
  },

  clearFrames: () => {
    rateBuckets.clear();
    usePlotStore.getState().clearBuffers();
    set({
      frames: new Map(),
      frameList: [],
      totalFramesReceived: 0,
      framesPerSecond: 0,
      _fpsTicker: [],
    });
  },

  setFilter: (patch) => {
    const store = get();
    const filter: FilterState = { ...store.filter, ...patch };

    // Recompute filter from existing frames
    const frameList = applyFilter(
      Array.from(store.frames.values()).sort((a, b) => a.id - b.id),
      filter,
    );
    set({ filter, frameList });
  },
}));

function applyFilter(rows: FrameRow[], filter: FilterState): FrameRow[] {
  let result = rows;

  // ID filter
  if (filter.idText.trim()) {
    const { min, max } = parseIdFilter(filter.idText);
    if (min !== undefined && max !== undefined) {
      result = result.filter((r) => r.id >= min && r.id <= max);
    }
  }

  // Signal name filter
  if (filter.signalName.trim()) {
    const q = filter.signalName.toLowerCase();
    result = result.filter((r) =>
      r.decodedSignals?.some(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.message_name.toLowerCase().includes(q),
      ),
    );
  }

  return result;
}
