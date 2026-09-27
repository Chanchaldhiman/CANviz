import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { apiSendFrame, apiDbcEncode, apiDbcDecode } from '../api/client';
import { useDbcStore } from './dbcStore';
import type { DbcMessage } from '../types/can';

// Module-scope timer registry — never put intervals in Zustand state
const timers = new Map<string, ReturnType<typeof setInterval>>();

let counter = 0;
const uid = () => `f_${++counter}_${Date.now()}`;

// Latest DBC encode/decode request per frame — older responses are dropped
const dbcSeq = new Map<string, number>();

// Link between a transmit frame and a DBC message: the frame's payload is
// generated from these physical signal values
export interface FrameDbcLink {
  message: string;                  // DBC message name
  signals: Record<string, number>;  // physical values keyed by signal name
}

export interface TransmitFrame {
  id:         string;   // internal key
  label:      string;   // optional user-facing name, e.g. "Ignition ON"
  canId:      string;   // "0x123"
  dlc:        number;
  data:       string;   // "FF 00 3C ..."
  isExtended: boolean;
  intervalMs: number;   // 0 = manual only
  dbc:        FrameDbcLink | null;
  isRunning:  boolean;
  lastSent:   string | null;
  error:      string | null;
}

// The persistable part of a frame — runtime state (timers, feedback) is dropped
export type SavedFrame = Pick<TransmitFrame, 'label' | 'canId' | 'dlc' | 'data' | 'isExtended' | 'intervalMs' | 'dbc'>;

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
    isExtended: false, intervalMs: 100, dbc: null,
    isRunning: false, lastSent: null, error: null,
  };
}

function toSaved(f: TransmitFrame): SavedFrame {
  return {
    label: f.label, canId: f.canId, dlc: f.dlc,
    data: f.data, isExtended: f.isExtended, intervalMs: f.intervalMs,
    dbc: f.dbc ? { message: f.dbc.message, signals: { ...f.dbc.signals } } : null,
  };
}

function parseDbcLink(v: unknown): FrameDbcLink | null {
  const o = v as Partial<FrameDbcLink> | null | undefined;
  if (!o || typeof o.message !== 'string' || !o.message) return null;
  const signals: Record<string, number> = {};
  if (o.signals && typeof o.signals === 'object') {
    for (const [k, val] of Object.entries(o.signals)) {
      if (typeof val === 'number' && Number.isFinite(val)) signals[k] = val;
    }
  }
  return { message: o.message, signals };
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
    dbc:        parseDbcLink(s.dbc),
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

function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function findDbcMessage(name: string): DbcMessage | undefined {
  return useDbcStore.getState().messages.find((m) => m.name === name);
}

/** Physical value used for a signal when nothing else is known */
export function defaultSignalValue(sig: DbcMessage['signals'][number]): number {
  return typeof sig.initial === 'number' ? sig.initial : 0;
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

  // DBC integration
  addDbcFrame:      (message: string) => void;
  attachDbcMessage: (id: string, message: string | null) => Promise<void>;
  setSignalValue:   (id: string, signal: string, value: number) => Promise<void>;
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
        dbcSeq.delete(id);
        set((s) => ({ frames: s.frames.filter((f) => f.id !== id), dirty: true }));
      },

      updateFrame: (id, patch) => {
        const before = get().frames.find((f) => f.id === id);
        // Changing the identifier by hand breaks the link to the DBC message
        const detach = !!before?.dbc && (
          (patch.canId !== undefined && patch.canId !== before.canId) ||
          (patch.isExtended !== undefined && patch.isExtended !== before.isExtended)
        );
        set((s) => ({
          frames: s.frames.map((f) => f.id === id ? { ...f, ...patch, ...(detach ? { dbc: null } : {}) } : f),
          dirty: true,
        }));
        // Hand-edited payload on a DBC frame: refresh the signal values from it
        if (!detach && before?.dbc && patch.data !== undefined) {
          const bytes = parseBytes(patch.data);
          if (bytes !== null) void decodeInto(id, before.dbc.message, bytes);
        }
      },

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

      addDbcFrame: (message) => {
        const frame = makeFrame();
        set((s) => ({ frames: [...s.frames, frame], dirty: true }));
        void get().attachDbcMessage(frame.id, message);
      },

      attachDbcMessage: async (id, message) => {
        const frame = get().frames.find((f) => f.id === id);
        if (!frame) return;
        if (message === null) {
          dbcSeq.set(id, (dbcSeq.get(id) ?? 0) + 1);   // cancel in-flight updates
          patchFrame(id, { dbc: null, error: null });
          return;
        }
        const msg = findDbcMessage(message);
        if (!msg) return;
        if (msg.length > 8) {
          patchFrame(id, { error: `${msg.name} is ${msg.length} bytes; only classic CAN (≤ 8) can be sent` });
          return;
        }

        // Start from the frame's current payload when it already carries this
        // message's ID, otherwise from the DBC initial values
        const msgId = parseInt(msg.id, 16);
        const sameId = parseId(frame.canId) === msgId && frame.isExtended === msg.is_extended;
        let signals: Record<string, number> = Object.fromEntries(
          msg.signals.map((sig) => [sig.name, defaultSignalValue(sig)]),
        );
        if (sameId) {
          const bytes = parseBytes(frame.data);
          if (bytes) {
            try {
              const decoded = await apiDbcDecode(msg.name, bytes);
              signals = { ...signals, ...decoded.signals };
            } catch { /* fall back to initial values */ }
          }
        }

        patchFrame(id, {
          canId:      `0x${msgId.toString(16).toUpperCase()}`,
          isExtended: msg.is_extended,
          dlc:        msg.length,
          intervalMs: msg.cycle_time && msg.cycle_time > 0 ? msg.cycle_time : frame.intervalMs,
          label:      frame.label || msg.name,
          dbc:        { message: msg.name, signals },
          error:      null,
        });
        set({ dirty: true });
        await encodeInto(id);
      },

      setSignalValue: async (id, signal, value) => {
        const frame = get().frames.find((f) => f.id === id);
        if (!frame?.dbc) return;
        patchFrame(id, { dbc: { ...frame.dbc, signals: { ...frame.dbc.signals, [signal]: value } } });
        set({ dirty: true });
        await encodeInto(id);
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

function patchFrame(id: string, patch: Partial<TransmitFrame>) {
  useSendFrameStore.setState((s) => ({
    frames: s.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  }));
}

/** Re-encode a DBC-linked frame's payload from its signal values */
async function encodeInto(id: string) {
  const frame = useSendFrameStore.getState().frames.find((f) => f.id === id);
  if (!frame?.dbc) return;
  const seq = (dbcSeq.get(id) ?? 0) + 1;
  dbcSeq.set(id, seq);
  try {
    const res = await apiDbcEncode(frame.dbc.message, frame.dbc.signals);
    if (dbcSeq.get(id) !== seq) return;
    patchFrame(id, { dlc: res.dlc, data: toHex(res.data), error: null });
  } catch (e) {
    if (dbcSeq.get(id) !== seq) return;
    patchFrame(id, { error: (e as Error).message });
  }
}

/** Refresh a DBC-linked frame's signal values from a raw payload */
async function decodeInto(id: string, message: string, bytes: number[]) {
  const seq = (dbcSeq.get(id) ?? 0) + 1;
  dbcSeq.set(id, seq);
  try {
    const res = await apiDbcDecode(message, bytes);
    if (dbcSeq.get(id) !== seq) return;
    const frame = useSendFrameStore.getState().frames.find((f) => f.id === id);
    if (!frame?.dbc || frame.dbc.message !== message) return;
    patchFrame(id, { dbc: { ...frame.dbc, signals: { ...frame.dbc.signals, ...res.signals } }, error: null });
  } catch {
    // DBC not loaded / message gone — the raw payload is still valid to send
  }
}
