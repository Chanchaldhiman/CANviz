import { useEffect, useRef, useCallback } from 'react';
import { useFrameStore } from '../store/frameStore';
import type { CanFrame } from '../types/can';

// WebSocket is always open while the app is running — independent of CAN
// connection status. This allows replay frames to flow even when no hardware
// is connected, and keeps the table frozen (not empty) after disconnect.
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

  const ingestFrame = useFrameStore((s) => s.ingestFrame);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const frame = JSON.parse(event.data as string) as CanFrame;
        ingestFrame(frame);
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
  }, [ingestFrame]);

  // Connect on mount, stay connected for the lifetime of the app
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);
}
