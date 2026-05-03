/**
 * useStatusSync.ts
 *
 * Fetches /status on mount and whenever the window regains focus.
 * Syncs connectionStore so the UI reflects the real backend state -
 * essential when `canviz serve` auto-connects before the browser opens.
 *
 * Usage: call once in App.tsx alongside useWebSocket().
 */

import { useEffect, useCallback } from 'react';
import { useConnectionStore } from '../store/connectionStore';

interface StatusResponse {
  connected: boolean;
  interface?: string;
  channel?: string;
  bitrate?: number;
  index?: number;
  serial_baudrate?: number;
}

export function useStatusSync() {
  const setStatus = useConnectionStore((s) => s.setStatus);
  const setConfig = useConnectionStore((s) => s.setConfig);
  const currentStatus = useConnectionStore((s) => s.status);

  const sync = useCallback(async () => {
    try {
      const res = await fetch('/status', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return;

      const data: StatusResponse = await res.json();

      if (data.connected) {
        // Backend is connected - update store so TopBar and stats render
        if (data.interface) {
          setConfig({
            interface: data.interface as never,
            channel: data.channel,
            bitrate: data.bitrate ?? 500000,
            index: data.index ?? 0,
          });
        }
        // Only flip to connected if we aren't already (avoids flickering)
        if (currentStatus !== 'connected') {
          setStatus('connected');
        }
      } else {
        // Backend is disconnected - if we thought we were connected, correct it
        if (currentStatus === 'connected') {
          setStatus('idle');
        }
      }
    } catch {
      // Network error or timeout - leave store as-is
    }
  }, [setStatus, setConfig, currentStatus]);

  // Sync on mount
  useEffect(() => {
    sync();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync when window regains focus (user alt-tabs back)
  useEffect(() => {
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [sync]);

  // Poll every 5s as a fallback (catches backend restarts)
  useEffect(() => {
    const id = setInterval(sync, 5000);
    return () => clearInterval(id);
  }, [sync]);
}
