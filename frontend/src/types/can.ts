// ============================================================
// Core CAN types
// ============================================================

export interface CanFrame {
  // Backend sends id as hex string e.g. "0x1a2" — normalised to number in frameStore
  id: string | number;
  dlc: number;
  data: number[];
  timestamp: number;        // Unix epoch float (seconds)
  is_extended_id: boolean;
  is_fd: boolean;
  // Backend key is "signals"; frameStore normalises to decoded_signals
  signals?: DecodedSignal[];
  decoded_signals?: DecodedSignal[];
}

export interface DecodedSignal {
  name: string;
  value: number;
  unit: string;
  message_name: string;
}

// A row in the live message table — deduped by ID, with stats
export interface FrameRow {
  id: number;
  idHex: string;            // e.g. "0x1A2"
  dlc: number;
  data: number[];
  dataHex: string;          // e.g. "FF 00 3C 00 00 00 00 00"
  count: number;
  rate: number;             // frames per second (rolling 1s window)
  lastSeen: number;         // Date.now() ms
  isExtended: boolean;
  isFd: boolean;
  flashKey: number;         // bumped on every update, triggers flash
  decodedSignals?: DecodedSignal[];
}

// ============================================================
// Connection types
// ============================================================

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disconnecting';

export type InterfaceType = 'gs_usb' | 'slcan' | 'socketcan' | 'virtual';

export interface ConnectionConfig {
  interface: InterfaceType;
  channel?: string;   // slcan: COM port, e.g. "COM3"
  index?: number;     // gs_usb: device index (default 0)
  bitrate: number;    // bps: 125000 | 250000 | 500000 | 1000000
}

export interface ConnectionState {
  status: ConnectionStatus;
  config: ConnectionConfig;
  error?: string;
}

// ============================================================
// DBC types
// ============================================================

export interface DbcSignal {
  name: string;
  unit: string;
  min_value: number;
  max_value: number;
  start_bit: number;
  length: number;
  scale: number;
  offset: number;
}

export interface DbcMessage {
  id: number;
  name: string;
  length: number;
  signals: DbcSignal[];
}

// ============================================================
// Log / replay types
// ============================================================

export type LogFormat = 'asc' | 'csv';

export interface LogState {
  recording: boolean;
  sessionId?: string;
  startedAt?: number;
}

export interface ReplayState {
  active: boolean;
  paused: boolean;
  speed: number;      // multiplier: 0.5 | 1 | 2 | 5 | 10
  filename?: string;
  progress: number;   // 0–100
}

// ============================================================
// Filter types
// ============================================================

export interface FilterState {
  idMin?: number;     // inclusive, decimal
  idMax?: number;     // inclusive, decimal
  idText: string;     // raw input from user (hex string or range)
  signalName: string; // substring match
  showDecoded: boolean;
}

// ============================================================
// API response shapes
// ============================================================

export interface ApiStatus {
  status: ConnectionStatus;
  interface: InterfaceType;
  channel?: string;
  bitrate?: number;
  frame_count: number;
}

export interface ApiError {
  detail: string;
}
