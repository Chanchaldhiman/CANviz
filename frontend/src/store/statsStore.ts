import { create } from 'zustand';

export interface BusStats {
  frames_rx: number;
  frames_tx: number;
  error_frames: number;
  error_pct: number;
  bus_off_events: number;
  fps: number;
  bus_load_pct: number;
  bytes_rx: number;
  bytes_tx: number;
  bitrate: number;
  uptime_s: number | null;
  connected: boolean;
}

const DEFAULT_STATS: BusStats = {
  frames_rx: 0,
  frames_tx: 0,
  error_frames: 0,
  error_pct: 0,
  bus_off_events: 0,
  fps: 0,
  bus_load_pct: 0,
  bytes_rx: 0,
  bytes_tx: 0,
  bitrate: 500000,
  uptime_s: null,
  connected: false,
};

interface StatsStore {
  stats: BusStats;
  updateStats: (s: BusStats) => void;
  reset: () => void;
}

export const useStatsStore = create<StatsStore>((set) => ({
  stats: DEFAULT_STATS,
  updateStats: (stats) => set({ stats }),
  reset: () => set({ stats: DEFAULT_STATS }),
}));