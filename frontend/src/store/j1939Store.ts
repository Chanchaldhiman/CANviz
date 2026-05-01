/**
 * j1939Store.ts
 * -------------
 * Tracks J1939 decoder state pushed from the backend via WebSocket stats
 * messages, and exposes the toggle action (calls REST /j1939/mode).
 */

import { create } from 'zustand';

export interface SARecord {
  sa: number;
  sa_hex: string;
  sa_name: string;
  frame_count: number;
  last_seen_s: number;
}

export interface BamRecord {
  pgn: number;
  pgn_hex: string;
  pgn_name: string;
  data_hex: string;
  length: number;
  dm1_faults?: Dm1Fault[];
}

export interface Dm1Fault {
  spn: number;
  fmi: number;
  oc: number;
  cm: number;
  lamps: Record<string, string>;
}

interface J1939Store {
  mode: 'off' | 'on';
  autoDetected: boolean;
  hasPrettyJ1939: boolean;
  pgnDbSize: number;
  saTable: SARecord[];
  recentBam: BamRecord[];
  recentDm1: Dm1Fault[];
  activeBamSessions: number;

  // Called by useWebSocket when a stats message arrives with j1939 fields
  updateFromStats: (msg: { j1939_mode?: string; j1939_detected?: boolean }) => void;

  // Called by the J1939Panel to toggle via REST
  setMode: (mode: 'on' | 'off') => Promise<void>;

  // Called when GET /j1939/status is fetched (full panel refresh)
  updateFromStatus: (status: Partial<J1939Store>) => void;
}

async function apiSetMode(mode: 'on' | 'off'): Promise<void> {
  await fetch('/j1939/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

export const useJ1939Store = create<J1939Store>((set, get) => ({
  mode: 'off',
  autoDetected: false,
  hasPrettyJ1939: false,
  pgnDbSize: 0,
  saTable: [],
  recentBam: [],
  recentDm1: [],
  activeBamSessions: 0,

  updateFromStats: (msg) => {
    const patch: Partial<J1939Store> = {};
    if (msg.j1939_mode !== undefined) {
      patch.mode = msg.j1939_mode as 'on' | 'off';
    }
    if (msg.j1939_detected !== undefined) {
      patch.autoDetected = msg.j1939_detected;
    }
    set(patch);
  },

  setMode: async (mode) => {
    // Optimistic update
    set({ mode });
    try {
      await apiSetMode(mode);
    } catch {
      // Revert on failure
      set({ mode: get().mode === 'on' ? 'off' : 'on' });
    }
  },

  updateFromStatus: (status) => {
    set({
      mode:               status.mode              ?? get().mode,
      autoDetected:       status.autoDetected       ?? get().autoDetected,
      hasPrettyJ1939:     status.hasPrettyJ1939     ?? get().hasPrettyJ1939,
      pgnDbSize:          status.pgnDbSize          ?? get().pgnDbSize,
      saTable:            status.saTable            ?? get().saTable,
      recentBam:          status.recentBam          ?? get().recentBam,
      recentDm1:          status.recentDm1          ?? get().recentDm1,
      activeBamSessions:  status.activeBamSessions  ?? get().activeBamSessions,
    });
  },
}));
