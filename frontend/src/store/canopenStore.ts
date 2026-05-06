/**
 * canopenStore.ts
 * ---------------
 * Tracks CANopen decoder state.
 * Pattern mirrors j1939Store.ts exactly:
 *   - updateFromStats() called by useWebSocket on every 1s stats message
 *   - updateFromStatus() called by CANopenPanel on mount and on 2s poll
 *   - setMode() calls REST /canopen/mode with optimistic update
 */

import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CANopenNode {
  node_id: number;
  node_id_hex: string;
  nmt_state: string;
  frame_count: number;
  last_heartbeat_s: number | null;
  heartbeat_interval_ms: number | null;
  emcy_active: boolean;
  cia402_state?: string;
  cia402_statusword?: string;
  cia402_mode?: string;
}

export interface SdoTransaction {
  node_id: number;
  index: string;       // e.g. "0x1008"
  subindex: number;
  request_cmd: string;
  response_cmd: string;
  data_hex: string;
  value_int: number | null;
  object_name?: string;
  data_type?: string;
  timestamp: number;
  is_abort: boolean;
}

export interface EmcyRecord {
  node_id: number;
  error_code: number;
  error_code_hex: string;
  error_name: string;
  error_register: number;
  error_register_flags: string[];
  manufacturer_data: string;
  timestamp: number;
}

export interface NmtCommand {
  cs: number;
  target_node: number;
  description: string;
}

// ── Store interface ───────────────────────────────────────────────────────────

interface CANopenStore {
  mode: 'off' | 'on';
  autoDetected: boolean;
  edsLoaded: boolean;
  edsFilename: string | null;
  canopenLibAvailable: boolean;
  nodes: CANopenNode[];
  recentSdo: SdoTransaction[];
  recentEmcy: EmcyRecord[];
  nmtLog: NmtCommand[];
  syncCount: number;
  lastSyncS: number | null;

  // Called by useWebSocket when a stats message arrives
  updateFromStats: (msg: { canopen_mode?: string; canopen_detected?: boolean }) => void;

  // Called by CANopenPanel on mount and every 2s
  updateFromStatus: (status: Partial<CANopenStore>) => void;

  // Toggle decoder via REST
  setMode: (mode: 'on' | 'off') => Promise<void>;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiSetMode(mode: 'on' | 'off'): Promise<void> {
  await fetch('/canopen/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCANopenStore = create<CANopenStore>((set, get) => ({
  mode: 'off',
  autoDetected: false,
  edsLoaded: false,
  edsFilename: null,
  canopenLibAvailable: false,
  nodes: [],
  recentSdo: [],
  recentEmcy: [],
  nmtLog: [],
  syncCount: 0,
  lastSyncS: null,

  updateFromStats: (msg) => {
    const patch: Partial<CANopenStore> = {};
    if (msg.canopen_mode !== undefined) {
      patch.mode = msg.canopen_mode as 'on' | 'off';
    }
    if (msg.canopen_detected !== undefined) {
      patch.autoDetected = msg.canopen_detected;
    }
    set(patch);
  },

  setMode: async (mode) => {
    set({ mode });
    try {
      await apiSetMode(mode);
    } catch {
      set({ mode: get().mode === 'on' ? 'off' : 'on' });
    }
  },

  updateFromStatus: (status) => {
    set({
      mode:                status.mode                ?? get().mode,
      autoDetected:        status.autoDetected        ?? get().autoDetected,
      edsLoaded:           status.edsLoaded           ?? get().edsLoaded,
      edsFilename:         status.edsFilename         ?? get().edsFilename,
      canopenLibAvailable: status.canopenLibAvailable ?? get().canopenLibAvailable,
      nodes:               status.nodes               ?? get().nodes,
      recentSdo:           status.recentSdo           ?? get().recentSdo,
      recentEmcy:          status.recentEmcy          ?? get().recentEmcy,
      nmtLog:              status.nmtLog              ?? get().nmtLog,
      syncCount:           status.syncCount           ?? get().syncCount,
      lastSyncS:           status.lastSyncS           ?? get().lastSyncS,
    });
  },
}));
