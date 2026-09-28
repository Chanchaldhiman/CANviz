import { create } from 'zustand';
import type { DbcMessage } from '../types/can';
import { apiLoadDbc, apiGetDbcMessages, apiUnloadDbc } from '../api/client';

interface DbcStore {
  loaded: boolean;
  filename: string | null;
  messages: DbcMessage[];
  loading: boolean;
  error: string | null;

  loadFile: (file: File) => Promise<void>;
  fetchMessages: () => Promise<void>;
  clear: () => void;
}

export const useDbcStore = create<DbcStore>((set) => ({
  loaded: false,
  filename: null,
  messages: [],
  loading: false,
  error: null,

  loadFile: async (file: File) => {
    set({ loading: true, error: null });
    try {
      await apiLoadDbc(file);
      // Fetch the parsed message list from the backend
      const data = await apiGetDbcMessages();
      set({
        loaded: true,
        filename: file.name,
        messages: (data.messages as DbcMessage[]) ?? [],
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message, loaded: false });
    }
  },

  // Resync with the backend, which keeps the DBC loaded across page reloads
  fetchMessages: async () => {
    try {
      const data = await apiGetDbcMessages();
      if (data.loaded) {
        set({
          loaded: true,
          filename: data.filename ?? null,
          messages: (data.messages as DbcMessage[]) ?? [],
        });
      } else {
        set({ loaded: false, filename: null, messages: [] });
      }
    } catch {
      // Silent — not critical
    }
  },

  clear: () => {
    // Unload on the backend too, otherwise live frames keep being decoded
    apiUnloadDbc().catch(() => { /* ignore */ });
    set({ loaded: false, filename: null, messages: [], error: null });
  },
}));
