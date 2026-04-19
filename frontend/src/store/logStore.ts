import { create } from 'zustand';
import {
  apiLogStart,
  apiLogStop,
  apiReplayStart,
  apiReplayStop,
  apiReplayPause,
  apiReplayResume,
  apiUploadReplayFile,
  getLogDownloadUrl,
} from '../api/client';

interface LogStore {
  // Recording
  recording: boolean;
  base: string | null;
  recordingStart: number | null;
  ascUrl: string | null;
  csvUrl: string | null;
  logError: string | null;

  // Replay
  replaying: boolean;
  replayPaused: boolean;
  replaySpeed: number;
  replayFilename: string | null;
  replayProgress: number;
  replayDone: boolean;
  replayError: string | null;

  // Actions — recording
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;

  // Actions — replay
  uploadAndStartReplay: (file: File, speed: number) => Promise<void>;
  pauseReplay: () => Promise<void>;
  resumeReplay: () => Promise<void>;
  stopReplay: () => Promise<void>;
  setReplaySpeed: (speed: number) => void;
  setReplayProgress: (pct: number) => void;
  setReplayDone: (done: boolean) => void;
}

// Extract just the filename from a path like "logs/canvaz_20260412_095000.asc"
function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export const useLogStore = create<LogStore>((set, get) => ({
  recording: false,
  base: null,
  recordingStart: null,
  ascUrl: null,
  csvUrl: null,
  logError: null,

  replaying: false,
  replayPaused: false,
  replaySpeed: 1,
  replayFilename: null,
  replayProgress: 0,
  replayDone: false,
  replayError: null,

  // ============================================================
  // Recording
  // ============================================================

  startRecording: async () => {
    set({ logError: null, ascUrl: null, csvUrl: null });
    try {
      const res = await apiLogStart();
      set({ recording: true, base: res.base, recordingStart: Date.now() });
    } catch (e) {
      set({ logError: (e as Error).message });
    }
  },

  stopRecording: async () => {
    if (!get().recording) return;
    try {
      const res = await apiLogStop();
      // Build download URLs from filenames returned by backend
      const ascUrl = getLogDownloadUrl(basename(res.asc_file));
      const csvUrl = getLogDownloadUrl(basename(res.csv_file));
      set({
        recording: false,
        base: null,
        recordingStart: null,
        ascUrl,
        csvUrl,
      });
    } catch (e) {
      set({ logError: (e as Error).message, recording: false });
    }
  },

  // ============================================================
  // Replay
  // ============================================================

  uploadAndStartReplay: async (file: File, speed: number) => {
    set({ replayError: null, replayProgress: 0, replayDone: false });
    try {
      const filename = await apiUploadReplayFile(file);
      await apiReplayStart({ filename, speed });
      set({
        replaying: true,
        replayPaused: false,
        replaySpeed: speed,
        replayFilename: file.name,
        replayDone: false,
      });
    } catch (e) {
      set({ replayError: (e as Error).message });
    }
  },

  pauseReplay: async () => {
    try {
      await apiReplayPause();
      set({ replayPaused: true });
    } catch (e) {
      set({ replayError: (e as Error).message });
    }
  },

  resumeReplay: async () => {
    try {
      await apiReplayResume();
      set({ replayPaused: false });
    } catch (e) {
      set({ replayError: (e as Error).message });
    }
  },

  stopReplay: async () => {
    try {
      await apiReplayStop();
    } catch {
      // Ignore
    }
    set({ replaying: false, replayPaused: false, replayProgress: 0,
          replayFilename: null, replayDone: false });
  },

  setReplaySpeed: (speed) => set({ replaySpeed: speed }),
  setReplayProgress: (pct) => set({ replayProgress: pct }),
  setReplayDone: (done) => set({ replayDone: done }),
}));
