import { useEffect, useRef, useCallback } from 'react';
import { useFrameStore } from '../store/frameStore';
import { useStatsStore } from '../store/statsStore';
import { useJ1939Store } from '../store/j1939Store';
import type { CanFrame } from '../types/can';

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/ws/frames`;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const ingestFrame      = useFrameStore((s) => s.ingestFrame);
  const updateStats      = useStatsStore((s) => s.updateStats);
  const updateJ1939Stats = useJ1939Store((s) => s.updateFromStats);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.type === 'stats') {
          updateStats(msg);
          // J1939 status is piggy-backed on every stats payload
          if (msg.j1939_mode !== undefined || msg.j1939_detected !== undefined) {
            updateJ1939Stats(msg);
          }
        } else {
          // "frame" type — pass to frame store (includes optional j1939 field)
          ingestFrame(msg as CanFrame);
        }
      } catch {
        // Malformed message — ignore
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;

      reconnectCountRef.current += 1;
      if (reconnectCountRef.current > MAX_RECONNECT_ATTEMPTS) return;

      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      // onclose handles reconnect
    };
  }, [ingestFrame, updateStats, updateJ1939Stats]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);
}
