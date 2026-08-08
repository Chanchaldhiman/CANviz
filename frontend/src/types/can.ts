// ============================================================
// Core CAN types
// ============================================================

export interface J1939Info {
  priority: number;
  pgn: number;
  pgn_hex: string;
  pgn_name: string;
  sa: number;
  sa_hex: string;
  sa_name: string;
  da: number;
  da_hex: string;
  da_name: string;
  is_broadcast: boolean;
  is_bam_cm: boolean;
  is_bam_dt: boolean;
  bam_complete: {
    pgn: number;
    pgn_hex: string;
    pgn_name: string;
    data_hex: string;
    length: number;
  } | null;
  dm1_faults: Array<{
    spn: number;
    fmi: number;
    oc: number;
    cm: number;
    lamps: Record<string, string>;
  }> | null;
}

export interface CANopenInfo {
  frame_type: string;   // "NMT" | "SYNC" | "EMCY" | "TPDO1" | "SDO-req" | "Heartbeat" etc.
  node_id: number | null;
  cob_id_hex: string;
  detail?: string;
  // EMCY-specific
  emcy?: {
    error_code: number;
    error_code_hex: string;
    error_name: string;
    error_register: number;
    error_register_flags: string[];
    manufacturer_data: string;
  };
  // PDO-specific
  pdo_index?: number;
  is_tx?: boolean;
  data_hex?: string;
  pdo_signals?: Array<{ name: string; value: number; unit: string }>;
  cia402_state?: string;
  cia402_statusword?: string;
  // SDO-specific
  sdo_index?: string;
  sdo_sub?: number;
  sdo_desc?: string;
  //data_hex?: string;
  value_int?: number | null;
  sdo_transaction?: {
    node_id: number;
    index: string;
    subindex: number;
    request_cmd: string;
    response_cmd: string;
    data_hex: string;
    object_name?: string;
  };
  // NMT-specific
  nmt?: { cs: number; target_node: number; description: string };
  // Heartbeat-specific
  nmt_state?: string;
}

export interface CanFrame {
  // Backend sends id as hex string e.g. "0x1a2" - normalised to number in frameStore
  id: string | number;
  dlc: number;
  data: number[];
  timestamp: number;        // Unix epoch float (seconds)
  is_extended_id: boolean;
  is_fd: boolean;
  // Backend key is "signals"; frameStore normalises to decoded_signals
  signals?: DecodedSignal[];
  decoded_signals?: DecodedSignal[];
  j1939?: J1939Info;
  canopen?: CANopenInfo;
}

export interface DecodedSignal {
  name: string;
  value: number;
  unit: string;
  message_name: string;
}

// A row in the live message table - deduped by ID, with stats
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
  j1939?: J1939Info;        // Present when J1939 mode is on and frame is extended
  canopen?: CANopenInfo;        // Present when CANopen mode is on
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

export type InterfaceType = 'gs_usb' | 'slcan' | 'socketcan' | 'virtual' | 'pcan' | 'kvaser' | 'seeedstudio';

export interface ConnectionConfig {
  interface: InterfaceType;
  channel?: string;         // slcan: COM port e.g. "COM3" | socketcan: e.g. "can0"
  index?: number;           // gs_usb / kvaser: device index (default 0)
  bitrate: number;          // bps: 125000 | 250000 | 500000 | 1000000
  baudrate : number;        // baudrate for slcan port com
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
