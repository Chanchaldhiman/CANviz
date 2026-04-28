import type { ConnectionConfig, ApiStatus } from '../types/can';

// In dev: Vite proxies /api/* → localhost:8080/* (stripping /api prefix)
// In prod: FastAPI serves at same origin with no prefix — use empty base
const BASE = import.meta.env.DEV ? '/api' : '';

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? 'Request failed');
  }
  return res.json() as Promise<T>;
}

// ============================================================
// Connection
// ============================================================

export function apiConnect(config: ConnectionConfig) {
  // FIX: JSON.stringify(config) would send camelCase keys (serialBaudrate)
  // but FastAPI's Pydantic model expects snake_case (serial_baudrate).
  // Pydantic silently ignores unknown fields, so this was always falling
  // back to the default 115200 regardless of what the UI selected.
  // Map explicitly here so the backend receives the correct field name.
  const body = {
    interface:        config.interface,
    channel:          config.channel ?? '',
    bitrate:          config.bitrate,
    index:            config.index ?? 0,
    serial_baudrate:  config.serialBaudrate ?? 115200,
  };

  return request<{ message: string }>('/connect', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function apiDisconnect() {
  return request<{ message: string }>('/disconnect', { method: 'POST' });
}

export function apiGetStatus() {
  return request<ApiStatus>('/status');
}

// ============================================================
// Send frame
// ============================================================

export interface SendFramePayload {
  id: number;
  dlc: number;
  data: number[];
  is_extended_id: boolean;
}

export function apiSendFrame(payload: SendFramePayload) {
  return request<{ message: string }>('/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ============================================================
// DBC
// ============================================================

export async function apiLoadDbc(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/dbc/load`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? 'DBC upload failed');
  }
  return res.json();
}

export function apiGetDbcMessages() {
  return request<{ messages: unknown[] }>('/dbc/messages');
}

// ============================================================
// Logging
// ============================================================

export interface LogStartResponse {
  ok: boolean;
  base: string;   // e.g. "canvaz_20260412_095000"
}

export interface LogStopResponse {
  ok: boolean;
  frames: number;
  asc_file: string;  // e.g. "logs/canvaz_20260412_095000.asc"
  csv_file: string;
}

export function apiLogStart() {
  return request<LogStartResponse>('/log/start', { method: 'POST' });
}

export function apiLogStop() {
  // Backend uses a global session — no body needed
  return request<LogStopResponse>('/log/stop', { method: 'POST' });
}

export function getLogDownloadUrl(filename: string) {
  // filename = basename only, e.g. "canvaz_20260412_095000.asc"
  return `${BASE}/log/download/${filename}`;
}

// ============================================================
// Replay
// ============================================================

export interface ReplayStartPayload {
  filename: string;
  speed: number;
}

export function apiReplayStart(payload: ReplayStartPayload) {
  return request<{ message: string }>('/replay/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function apiReplayStop() {
  return request<{ message: string }>('/replay/stop', { method: 'POST' });
}

export function apiReplayPause() {
  return request<{ message: string }>('/replay/pause', { method: 'POST' });
}

export function apiReplayResume() {
  return request<{ message: string }>('/replay/resume', { method: 'POST' });
}

export async function apiUploadReplayFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/replay/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? 'Upload failed');
  }
  const data = await res.json();
  return data.filename as string;
}