/**
 * obdStore.ts
 * -----------
 * Tracks OBD-II Mode 01 state. Mode flag arrives via the WebSocket stats
 * piggyback (like J1939/CANopen); the live PID table and supported-PID
 * list are refreshed by the panel itself polling GET /obd/status, same
 * pattern J1939Panel uses for its node table.
 */

import { create } from 'zustand';

export interface KnownPid {
  pid: number;
  name: string;
  unit: string;
  category: string;
}

export interface LivePidValue {
  pid: number;
  name: string;
  unit: string;
  value?: number;
  ts: number;
  stale?: boolean;
}

export interface MonitorStatus {
  mil_on: boolean;
  dtc_count: number;
}

interface OBDStore {
  mode: 'off' | 'on';
  scanning: boolean;
  dataStalled: boolean;
  addressing: string | null; // '11-bit' | '29-bit' | null once detected by a scan
  supportedPids: number[];
  watchedPids: number[];
  liveValues: LivePidValue[];
  knownPids: KnownPid[];
  lastError: string | null;
  lastScanCount: number | null; // set right after a scan resolves, for the summary banner
  monitorStatus: MonitorStatus | null;
  monitorStatusSupported: boolean;

  updateFromStats: (msg: {
    obd_mode?: string;
    obd_scanning?: boolean;
    obd_data_stalled?: boolean;
    obd_addressing?: string | null;
  }) => void;
  updateFromStatus: (status: {
    mode?: string;
    scanning?: boolean;
    data_stalled?: boolean;
    addressing?: string | null;
    supported_pids?: number[];
    watched_pids?: number[];
    live_values?: LivePidValue[];
    known_pids?: KnownPid[];
    last_error?: string | null;
    monitor_status?: MonitorStatus | null;
    monitor_status_supported?: boolean;
  }) => void;

  setMode: (mode: 'on' | 'off') => Promise<void>;
  scan: () => Promise<void>;
  setWatched: (pids: number[]) => Promise<void>;
}

async function apiSetMode(mode: 'on' | 'off'): Promise<void> {
  const res = await fetch('/obd/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
}

export const useOBDStore = create<OBDStore>((set, get) => ({
  mode: 'off',
  scanning: false,
  dataStalled: false,
  addressing: null,
  supportedPids: [],
  watchedPids: [],
  liveValues: [],
  knownPids: [],
  lastError: null,
  lastScanCount: null,
  monitorStatus: null,
  monitorStatusSupported: false,

  updateFromStats: (msg) => {
    const patch: Partial<OBDStore> = {};
    if (msg.obd_mode !== undefined) patch.mode = msg.obd_mode as 'off' | 'on';
    if (msg.obd_scanning !== undefined) patch.scanning = msg.obd_scanning;
    if (msg.obd_data_stalled !== undefined) patch.dataStalled = msg.obd_data_stalled;
    if (msg.obd_addressing !== undefined) patch.addressing = msg.obd_addressing;
    set(patch);
  },

  updateFromStatus: (status) => {
    set({
      mode:          (status.mode as 'off' | 'on')  ?? get().mode,
      scanning:      status.scanning                ?? get().scanning,
      dataStalled:   status.data_stalled             ?? get().dataStalled,
      addressing:    status.addressing !== undefined ? status.addressing : get().addressing,
      supportedPids: status.supported_pids           ?? get().supportedPids,
      watchedPids:   status.watched_pids             ?? get().watchedPids,
      liveValues:    status.live_values              ?? get().liveValues,
      knownPids:     status.known_pids               ?? get().knownPids,
      lastError:     status.last_error !== undefined ? status.last_error : get().lastError,
      monitorStatus: status.monitor_status !== undefined ? status.monitor_status : get().monitorStatus,
      monitorStatusSupported: status.monitor_status_supported ?? get().monitorStatusSupported,
    });
  },

  setMode: async (mode) => {
    set({ mode });
    try {
      await apiSetMode(mode);
      set({ lastError: null });
      if (mode === 'on') {
        await get().scan(); // scan automatically -- selecting what to watch stays manual
      } else {
        set({ lastScanCount: null });
      }
    } catch (err) {
      set({
        mode: get().mode === 'on' ? 'off' : 'on',
        lastError: err instanceof Error ? err.message : 'Failed to change OBD-II mode',
      });
    }
  },

  scan: async () => {
    set({ scanning: true });
    try {
      const res = await fetch('/obd/scan', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const supported: number[] = data.supported_pids ?? [];
        set({
          supportedPids: supported,
          lastScanCount: supported.length,
          addressing: data.addressing ?? null,
        });
      }
    } finally {
      set({ scanning: false });
    }
  },

  setWatched: async (pids) => {
    set({ watchedPids: pids });
    await fetch('/obd/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pids }),
    });
  },
}));
