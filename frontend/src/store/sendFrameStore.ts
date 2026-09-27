import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { apiSendFrame } from '../api/client';

// Module-scope timer registry — never put intervals in Zustand state
const timers = new Map<string, ReturnType<typeof setInterval>>();

let counter = 0;
const uid = () => `f_${++counter}_${Date.now()}`;

export interface TransmitFrame {
  id:         string;   // internal key
  label:      string;   // optional user-facing name, e.g. "Ignition ON"
  canId:      string;   // "0x123"
  dlc:        number;
  data:       string;   // "FF 00 3C ..."
  isExtended: boolean;
  intervalMs: number;   // 0 = manual only
  isRunning:  boolean;
  lastSent:   string | null;
  error:      string | null;
}

// The persistable part of a frame — runtime state (timers, feedback) is dropped
export type SavedFrame = Pick<TransmitFrame, 'label' | 'canId' | 'dlc' | 'data' | 'isExtended' | 'intervalMs'>;

export interface FrameSet {
  name:    string;
  savedAt: number;      // Date.now() ms
  frames:  SavedFrame[];
}

// On-disk format for Export / Import
export const FRAME_SET_FILE_FORMAT = 'canviz-send-frames';
export const FRAME_SET_FILE_VERSION = 1;

export interface FrameSetFile {
  format:  typeof FRAME_SET_FILE_FORMAT;
  version: number;
  sets:    FrameSet[];
}

function makeFrame(): TransmitFrame {
  return {
    id: uid(), label: '', canId: '0x123', dlc: 8,
    data: '00 00 00 00 00 00 00 00',
    isExtended: false, intervalMs: 100,
    isRunning: false, lastSent: null, error: null,
  };
}

function toSaved(f: TransmitFrame): SavedFrame {
  return {
    label: f.label, canId: f.canId, dlc: f.dlc,
    data: f.data, isExtended: f.isExtended, intervalMs: f.intervalMs,
  };
}

// Tolerant of missing / malformed fields so hand-edited or older files still load
function fromSaved(s: Partial<SavedFrame>): TransmitFrame {
  const base = makeFrame();
  const dlc = Number(s.dlc);
  const intervalMs = Number(s.intervalMs);
  return {
    ...base,
    label:      typeof s.label === 'string' ? s.label : '',
    canId:      typeof s.canId === 'string' ? s.canId : base.canId,
    dlc:        Number.isInteger(dlc) && dlc >= 0 && dlc <= 8 ? dlc : base.dlc,
    data:       typeof s.data === 'string' ? s.data : base.data,
    isExtended: !!s.isExtended,
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : base.intervalMs,
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

/**
 * Parse an exported frame set file. Accepts the full multi-set format as well
 * as a bare FrameSet or a bare frame array, so simple hand-written files work.
 * Throws with a user-readable message on invalid input.
 */
export function parseFrameSetFile(text: string, fallbackName: string): FrameSet[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }

  const asSet = (v: unknown, name: string): FrameSet => {
    const obj = v as Partial<FrameSet>;
    if (!obj || !Array.isArray(obj.frames)) throw new Error('No frames found in file');
    return {
      name:    typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : name,
      savedAt: typeof obj.savedAt === 'number' ? obj.savedAt : Date.now(),
      frames:  obj.frames.map((f) => toSaved(fromSaved(f as Partial<SavedFrame>))),
    };
  };

  if (Array.isArray(raw)) return [asSet({ frames: raw }, fallbackName)];
  const obj = raw as Partial<FrameSetFile>;
  if (obj && Array.isArray(obj.sets)) {
    if (obj.format !== undefined && obj.format !== FRAME_SET_FILE_FORMAT) {
      throw new Error(`Unrecognised file format "${String(obj.format)}"`);
    }
    if (obj.sets.length === 0) throw new Error('File contains no frame sets');
    return obj.sets.map((s, i) => asSet(s, obj.sets!.length > 1 ? `${fallbackName} ${i + 1}` : fallbackName));
  }
  return [asSet(raw, fallbackName)];
}

export function serializeFrameSets(sets: FrameSet[]): string {
  const file: FrameSetFile = { format: FRAME_SET_FILE_FORMAT, version: FRAME_SET_FILE_VERSION, sets };
  return JSON.stringify(file, null, 2);
}

interface SendFrameStore {
  frames:      TransmitFrame[];
  // Saved frame sets (library), persisted to localStorage
  sets:        FrameSet[];
  // Name of the set the workspace was last loaded from / saved to
  activeSet:   string | null;
  // True when the workspace has changed since the last save / load
  dirty:       boolean;

  addFrame:    () => void;
  removeFrame: (id: string) => void;
  updateFrame: (id: string, patch: Partial<TransmitFrame>) => void;
  sendOnce:    (id: string) => Promise<void>;
  toggleTimer: (id: string) => void;
  stopAll:     () => void;

  saveSet:     (name: string) => void;
  loadSet:     (name: string) => void;
  deleteSet:   (name: string) => void;
  importSets:  (sets: FrameSet[]) => void;
  currentAsSet: () => FrameSet;
}

export const useSendFrameStore = create<SendFrameStore>()(
  persist(
    (set, get) => ({
      frames:    [makeFrame()],
      sets:      [],
      activeSet: null,
      dirty:     false,

      addFrame: () => set((s) => ({ frames: [...s.frames, makeFrame()], dirty: true })),

      removeFrame: (id) => {
        if (timers.has(id)) { clearInterval(timers.get(id)!); timers.delete(id); }
        set((s) => ({ frames: s.frames.filter((f) => f.id !== id), dirty: true }));
      },

      updateFrame: (id, patch) =>
        set((s) => ({ frames: s.frames.map((f) => f.id === id ? { ...f, ...patch } : f), dirty: true })),

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

      saveSet: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const entry: FrameSet = { name: trimmed, savedAt: Date.now(), frames: get().frames.map(toSaved) };
        set((s) => {
          const idx = s.sets.findIndex((x) => x.name === trimmed);
          const sets = idx >= 0
            ? s.sets.map((x, i) => (i === idx ? entry : x))
            : [...s.sets, entry].sort((a, b) => a.name.localeCompare(b.name));
          return { sets, activeSet: trimmed, dirty: false };
        });
      },

      loadSet: (name) => {
        const entry = get().sets.find((x) => x.name === name);
        if (!entry) return;
        // Never leave timers running against frames that are about to disappear
        get().stopAll();
        set({ frames: entry.frames.map(fromSaved), activeSet: entry.name, dirty: false });
      },

      deleteSet: (name) =>
        set((s) => ({
          sets: s.sets.filter((x) => x.name !== name),
          activeSet: s.activeSet === name ? null : s.activeSet,
        })),

      importSets: (incoming) => {
        if (incoming.length === 0) return;
        set((s) => {
          const byName = new Map(s.sets.map((x) => [x.name, x] as const));
          for (const x of incoming) byName.set(x.name, x);
          return { sets: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
        });
        get().loadSet(incoming[0].name);
      },

      currentAsSet: () => ({
        name: get().activeSet ?? 'frames',
        savedAt: Date.now(),
        frames: get().frames.map(toSaved),
      }),
    }),
    {
      name: 'canviz:sendFrames',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist the workspace + library, never runtime state (timers, feedback)
      partialize: (s) => ({
        frames:    s.frames.map(toSaved),
        sets:      s.sets,
        activeSet: s.activeSet,
        dirty:     s.dirty,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<{
          frames: SavedFrame[]; sets: FrameSet[]; activeSet: string | null; dirty: boolean;
        }>;
        return {
          ...current,
          frames:    Array.isArray(p.frames) ? p.frames.map(fromSaved) : current.frames,
          sets:      Array.isArray(p.sets) ? p.sets : current.sets,
          activeSet: typeof p.activeSet === 'string' ? p.activeSet : null,
          dirty:     !!p.dirty,
        };
      },
    },
  ),
);
