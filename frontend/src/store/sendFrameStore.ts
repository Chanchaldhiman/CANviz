import { create } from 'zustand';
import { apiSendFrame } from '../api/client';

// Module-scope timer registry — never put intervals in Zustand state
const timers = new Map<string, ReturnType<typeof setInterval>>();

let counter = 0;
const uid = () => `f_${++counter}_${Date.now()}`;

export interface TransmitFrame {
  id:         string;   // internal key
  canId:      string;   // "0x123"
  dlc:        number;
  data:       string;   // "FF 00 3C ..."
  isExtended: boolean;
  intervalMs: number;   // 0 = manual only
  isRunning:  boolean;
  lastSent:   string | null;
  error:      string | null;
}

function makeFrame(): TransmitFrame {
  return {
    id: uid(), canId: '0x123', dlc: 8,
    data: '00 00 00 00 00 00 00 00',
    isExtended: false, intervalMs: 100,
    isRunning: false, lastSent: null, error: null,
  };
}

function parseId(s: string): number | null {
  const v = parseInt(s.replace(/^0x/i, ''), 16);
  return isNaN(v) ? null : v;
}

function parseBytes(s: string): number[] | null {
  const cleaned = s.replace(/[,\s]+/g, ' ').trim();
  if (!cleaned) return [];
  const bytes: number[] = [];
  for (const p of cleaned.split(' ')) {
    const v = parseInt(p, 16);
    if (isNaN(v) || v < 0 || v > 255) return null;
    bytes.push(v);
  }
  return bytes;
}

async function doSend(f: TransmitFrame): Promise<string> {
  const id = parseId(f.canId);
  if (id === null) throw new Error('Invalid CAN ID');
  const data = parseBytes(f.data);
  if (data === null) throw new Error('Invalid data bytes');
  while (data.length < f.dlc) data.push(0);
  const trimmed = data.slice(0, f.dlc);
  await apiSendFrame({ id, dlc: f.dlc, data: trimmed, is_extended_id: f.isExtended });
  return (
    `${f.isExtended ? '[EXT]' : '[STD]'} 0x${id.toString(16).toUpperCase()}` +
    ` [${f.dlc}] ${trimmed.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`
  );
}

interface SendFrameStore {
  frames:      TransmitFrame[];
  addFrame:    () => void;
  removeFrame: (id: string) => void;
  updateFrame: (id: string, patch: Partial<TransmitFrame>) => void;
  sendOnce:    (id: string) => Promise<void>;
  toggleTimer: (id: string) => void;
  stopAll:     () => void;
}

export const useSendFrameStore = create<SendFrameStore>((set, get) => ({
  frames: [makeFrame()],

  addFrame: () => set((s) => ({ frames: [...s.frames, makeFrame()] })),

  removeFrame: (id) => {
    if (timers.has(id)) { clearInterval(timers.get(id)!); timers.delete(id); }
    set((s) => ({ frames: s.frames.filter((f) => f.id !== id) }));
  },

  updateFrame: (id, patch) =>
    set((s) => ({ frames: s.frames.map((f) => f.id === id ? { ...f, ...patch } : f) })),

  sendOnce: async (id) => {
    const frame = get().frames.find((f) => f.id === id);
    if (!frame) return;
    try {
      const lastSent = await doSend(frame);
      set((s) => ({ frames: s.frames.map((f) => f.id === id ? { ...f, lastSent, error: null } : f) }));
    } catch (e) {
      set((s) => ({ frames: s.frames.map((f) => f.id === id ? { ...f, error: (e as Error).message } : f) }));
    }
  },

  toggleTimer: (id) => {
    const frame = get().frames.find((f) => f.id === id);
    if (!frame) return;

    if (frame.isRunning) {
      if (timers.has(id)) { clearInterval(timers.get(id)!); timers.delete(id); }
      set((s) => ({ frames: s.frames.map((f) => f.id === id ? { ...f, isRunning: false } : f) }));
    } else {
      if (frame.intervalMs <= 0) return;
      const interval = setInterval(async () => {
        const current = get().frames.find((f) => f.id === id);
        if (!current) return;
        try {
          const lastSent = await doSend(current);
          set((s) => ({ frames: s.frames.map((f) => f.id === id ? { ...f, lastSent, error: null } : f) }));
        } catch (e) {
          set((s) => ({ frames: s.frames.map((f) => f.id === id ? { ...f, error: (e as Error).message } : f) }));
        }
      }, frame.intervalMs);
      timers.set(id, interval);
      set((s) => ({ frames: s.frames.map((f) => f.id === id ? { ...f, isRunning: true, error: null } : f) }));
    }
  },

  stopAll: () => {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    set((s) => ({ frames: s.frames.map((f) => ({ ...f, isRunning: false })) }));
  },
}));