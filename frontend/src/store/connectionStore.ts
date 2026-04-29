import { create } from 'zustand';
import type { ConnectionConfig, ConnectionStatus, InterfaceType } from '../types/can';
import { apiConnect, apiDisconnect } from '../api/client';
import { useFrameStore } from './frameStore';

interface ConnectionStore {
  status: ConnectionStatus;
  config: ConnectionConfig;
  error: string | null;

  // Actions
  setStatus: (s: ConnectionStatus) => void;
  setConfig: (patch: Partial<ConnectionConfig>) => void;
  setInterface: (iface: InterfaceType) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  status: 'idle',
  config: {
    interface: 'gs_usb',
    index: 0,
    bitrate: 500000,
  },
  error: null,

  setStatus: (status) => set({ status }),

  setConfig: (patch) =>
    set((s) => ({ config: { ...s.config, ...patch } })),

  setInterface: (iface) =>
    set((s) => ({
      config: {
        ...s.config,
        interface: iface,
        // Reset interface-specific fields when switching
        channel:        (iface === 'slcan' || iface === 'seeedstudio') ? (s.config.channel ?? 'COM3') : undefined,
        index:          (iface === 'gs_usb' || iface === 'kvaser') ? (s.config.index ?? 0) : undefined,
      },
    })),

  connect: async () => {
    const { config } = get();
    set({ status: 'connecting', error: null });
    // Clear stale frames at the START of a new session so the table
    // fills with fresh data. Clearing on disconnect would wipe the
    // last-known state which the user may want to inspect after stopping.
    useFrameStore.getState().clearFrames();
    try {
      await apiConnect(config);
      set({ status: 'connected' });
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
    }
  },

  disconnect: async () => {
    set({ status: 'disconnecting', error: null });
    try {
      await apiDisconnect();
    } catch {
      // Ignore — always transition to idle
    }
    // Do NOT clear frames here — the table should freeze at last state
    // so the user can inspect counts, fps, and last values after stopping.
    set({ status: 'idle' });
  },
}));