import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
  flexRender,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFrameStore } from '../../store/frameStore';
import { useJ1939Store } from '../../store/j1939Store';
import { useCANopenStore } from '../../store/canopenStore';
import type { FrameRow, DecodedSignal, CANopenInfo } from '../../types/can';

const FLASH_DURATION_MS = 400;
const ROW_HEIGHT = 30;
const SIGNAL_ROW_HEIGHT = 18;

// ── Flash tracker ─────────────────────────────────────────────────────────────
const flashTimers = new Map<number, ReturnType<typeof setTimeout>>();

function triggerFlash(el: HTMLElement, id: number) {
  if (flashTimers.has(id)) {
    clearTimeout(flashTimers.get(id));
    el.classList.remove('row-flash');
    void el.offsetHeight;
  }
  el.classList.add('row-flash');
  const t = setTimeout(() => {
    el.classList.remove('row-flash');
    flashTimers.delete(id);
  }, FLASH_DURATION_MS);
  flashTimers.set(id, t);
}

// ── Rate colorizer ────────────────────────────────────────────────────────────
function rateColor(fps: number): string {
  if (fps === 0) return 'var(--text-muted)';
  if (fps < 10)  return 'var(--text-secondary)';
  if (fps < 100) return 'var(--accent-amber)';
  return 'var(--accent-red)';
}

// ── Signal sub-row ────────────────────────────────────────────────────────────
function SignalRows({ signals }: { signals: DecodedSignal[] }) {
  return (
    <div style={styles.signalContainer}>
      {signals.map((sig) => (
        <div key={sig.name} style={styles.signalRow}>
          <span style={styles.signalName}>{sig.message_name}.{sig.name}</span>
          <span style={styles.signalValue} className="mono">
            {typeof sig.value === 'number' ? sig.value.toFixed(3) : sig.value}
          </span>
          <span style={styles.signalUnit}>{sig.unit}</span>
        </div>
      ))}
    </div>
  );
}

// ── Base column definitions (always shown) ────────────────────────────────────
const BASE_COLUMNS: ColumnDef<FrameRow>[] = [
  {
    id: 'expand',
    size: 24,
    cell: () => null,
  },
  {
    accessorKey: 'idHex',
    header: 'ID',
    size: 90,
    cell: (info) => (
      <span className="mono" style={styles.idCell}>
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'dlc',
    header: 'DLC',
    size: 40,
    cell: (info) => (
      <span className="mono" style={{ color: 'var(--text-secondary)' }}>
        {info.getValue<number>()}
      </span>
    ),
  },
  {
    accessorKey: 'dataHex',
    header: 'Data',
    size: 220,
    cell: (info) => (
      <span className="mono" style={styles.dataCell}>
        {info.getValue<string>()}
      </span>
    ),
  },
  {
    accessorKey: 'count',
    header: 'Count',
    size: 70,
    cell: (info) => (
      <span className="mono" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
        {info.getValue<number>().toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: 'rate',
    header: 'Rate',
    size: 60,
    cell: (info) => {
      const fps = info.getValue<number>();
      return (
        <span className="mono" style={{ color: rateColor(fps), fontSize: 11, fontWeight: 500 }}>
          {fps}
        </span>
      );
    },
  },
  {
    accessorKey: 'lastSeen',
    header: 'Last Seen',
    size: 90,
    cell: (info) => {
      const ms = info.getValue<number>();
      const d = new Date(ms);
      return (
        <span className="mono" style={styles.timeCell}>
          {d.toTimeString().slice(0, 8)}.{String(d.getMilliseconds()).padStart(3, '0')}
        </span>
      );
    },
  },
];

// ── J1939 column definitions (appended when decoder is on) ────────────────────
const J1939_COLUMNS: ColumnDef<FrameRow>[] = [
  {
    id: 'j1939_pgn',
    header: 'PGN',
    size: 70,
    cell: ({ row }) => {
      const j = row.original.j1939;
      if (!j) return <span style={styles.j1939Absent}>—</span>;
      return (
        <span className="mono" style={{ color: 'var(--accent-blue)', fontSize: 11 }}>
          {j.pgn_hex}
        </span>
      );
    },
  },
  {
    id: 'j1939_pgn_name',
    header: 'PGN Name',
    size: 180,
    cell: ({ row }) => {
      const j = row.original.j1939;
      if (!j) return <span style={styles.j1939Absent}>—</span>;
      return (
        <span style={styles.pgnName} title={j.pgn_name}>
          {j.pgn_name}
        </span>
      );
    },
  },
  {
    id: 'j1939_sa',
    header: 'SA',
    size: 80,
    cell: ({ row }) => {
      const j = row.original.j1939;
      if (!j) return <span style={styles.j1939Absent}>—</span>;
      return (
        <span title={j.sa_name} style={styles.saCell}>
          <span className="mono" style={{ color: 'var(--accent-amber)', fontSize: 11 }}>
            {j.sa_hex}
          </span>
          <span style={styles.saName}>{j.sa_name}</span>
        </span>
      );
    },
  },
  {
    id: 'j1939_da',
    header: 'DA',
    size: 60,
    cell: ({ row }) => {
      const j = row.original.j1939;
      if (!j) return <span style={styles.j1939Absent}>—</span>;
      return (
        <span className="mono" style={{
          color: j.is_broadcast ? 'var(--text-muted)' : 'var(--text-secondary)',
          fontSize: 11,
        }}>
          {j.is_broadcast ? 'BC' : j.da_hex}
        </span>
      );
    },
  },
];

// ── CANopen helpers ───────────────────────────────────────────────────────────

const CANOPEN_TYPE_COLORS: Record<string, string> = {
  NMT:        'var(--accent-amber)',
  SYNC:       'var(--text-muted)',
  TIME:       'var(--text-muted)',
  EMCY:       'var(--accent-red)',
  Heartbeat:  'var(--accent-green)',
  TPDO1:      '#61afef',
  TPDO2:      '#61afef',
  TPDO3:      '#61afef',
  TPDO4:      '#61afef',
  RPDO1:      '#c678dd',
  RPDO2:      '#c678dd',
  RPDO3:      '#c678dd',
  RPDO4:      '#c678dd',
  'SDO-req':  'var(--text-muted)',
  'SDO-resp': 'var(--accent-green)',
};

function canopenTypeColor(frameType: string): string {
  return CANOPEN_TYPE_COLORS[frameType] ?? 'var(--text-secondary)';
}

function canopenDetail(co: CANopenInfo): string {
  // SDO response with paired transaction -- show object name + value
  if (co.sdo_transaction && co.sdo_transaction.object_name) {
    const t = co.sdo_transaction;
    const val = t.data_hex ?? '';
    return `${t.object_name}${val ? ' = ' + val : ''}`;
  }
  // Heartbeat -- just the NMT state
  if (co.frame_type === 'Heartbeat' && co.nmt_state) {
    return co.nmt_state;
  }
  // EMCY -- error name
  if (co.frame_type === 'EMCY' && co.emcy) {
    return co.emcy.error_name;
  }
  // NMT command
  if (co.frame_type === 'NMT' && co.nmt) {
    return co.nmt.description;
  }
  // PDO with signals (EDS decoded)
  if (co.pdo_signals?.length) {
    return co.pdo_signals.map((s) => `${s.name}=${s.value}`).join('  ');
  }
  // Generic detail string
  return co.detail ?? '';
}

// ── CANopen column definitions ────────────────────────────────────────────────

const CANOPEN_COLUMNS: ColumnDef<FrameRow>[] = [
  {
    id: 'co_type',
    header: 'Type',
    size: 80,
    cell: ({ row }) => {
      const co = row.original.canopen;
      if (!co) return <span style={styles.coAbsent}>—</span>;
      return (
        <span
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: canopenTypeColor(co.frame_type),
          }}
        >
          {co.frame_type}
        </span>
      );
    },
  },
  {
    id: 'co_node',
    header: 'Node',
    size: 50,
    cell: ({ row }) => {
      const co = row.original.canopen;
      if (!co || co.node_id === null) return <span style={styles.coAbsent}>—</span>;
      return (
        <span className="mono" style={{ fontSize: 11, color: 'var(--accent-amber)' }}>
          0x{co.node_id.toString(16).toUpperCase().padStart(2, '0')}
        </span>
      );
    },
  },
  {
    id: 'co_info',
    header: 'Protocol Info',
    size: 200,
    cell: ({ row }) => {
      const co = row.original.canopen;
      if (!co) return <span style={styles.coAbsent}>—</span>;
      const detail = canopenDetail(co);
      return (
        <span
          style={{
            fontSize: 11,
            color: co.frame_type === 'EMCY' ? 'var(--accent-red)' : 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'block',
            maxWidth: 190,
          }}
          title={detail}
        >
          {detail}
        </span>
      );
    },
  },
];
export function MessageTable() {
  const frameList   = useFrameStore((s) => s.frameList);
  const showDecoded = useFrameStore((s) => s.filter.showDecoded);
  const j1939Mode   = useJ1939Store((s) => s.mode);
  const canopenMode = useCANopenStore((s) => s.mode);

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rowRefs       = useRef<Map<number, HTMLDivElement>>(new Map());
  const prevFlashKeys = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    for (const row of frameList) {
      const prev = prevFlashKeys.current.get(row.id);
      if (prev !== undefined && prev !== row.flashKey) {
        const el = rowRefs.current.get(row.id);
        if (el) triggerFlash(el, row.id);
      }
      prevFlashKeys.current.set(row.id, row.flashKey);
    }
  }, [frameList]);

  // Append protocol columns dynamically based on active decoders
  const columns = useMemo<ColumnDef<FrameRow>[]>(() => {
    let cols: ColumnDef<FrameRow>[] = [...BASE_COLUMNS];
    if (j1939Mode   === 'on') cols = [...cols, ...J1939_COLUMNS];
    if (canopenMode === 'on') cols = [...cols, ...CANOPEN_COLUMNS];
    return cols;
  }, [j1939Mode, canopenMode]);

  const table = useReactTable({
    data: frameList,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();
  const parentRef = useRef<HTMLDivElement>(null);

  const flatItems = useMemo(() => {
    const items: Array<
      | { type: 'row'; row: typeof rows[0] }
      | { type: 'signals'; frameId: number; signals: DecodedSignal[] }
    > = [];
    for (const row of rows) {
      items.push({ type: 'row', row });
      const frameId = row.original.id;
      if (expandedRows.has(frameId) && row.original.decodedSignals?.length) {
        items.push({ type: 'signals', frameId, signals: row.original.decodedSignals });
      }
    }
    return items;
  }, [rows, expandedRows]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const item = flatItems[i];
      if (item.type === 'signals') {
        return item.signals.length * SIGNAL_ROW_HEIGHT + 8;
      }
      return ROW_HEIGHT;
    },
    overscan: 20,
  });

  const isEmpty = frameList.length === 0;

  return (
    <div className="app-main" style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        {table.getHeaderGroups().map((hg) => (
          <div key={hg.id} style={styles.headerRow}>
            <div style={{ ...styles.headerCell, width: 30, flexShrink: 0 }} />
            {hg.headers.slice(1).map((header) => (
              <div
                key={header.id}
                style={{ ...styles.headerCell, width: header.getSize(), flexShrink: 0 }}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Virtualised body */}
      <div ref={parentRef} style={styles.body}>
        {isEmpty ? (
          <div style={styles.empty}>
            <span style={styles.emptyIcon}>◈</span>
            <span style={styles.emptyText}>No frames received</span>
            <span style={styles.emptyHint}>Connect to a CAN bus to start streaming</span>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const item = flatItems[vi.index];

              if (item.type === 'signals') {
                return (
                  <div
                    key={`sig-${item.frameId}`}
                    style={{
                      position: 'absolute',
                      top: vi.start,
                      width: '100%',
                      height: vi.size,
                    }}
                  >
                    <SignalRows signals={item.signals} />
                  </div>
                );
              }

              const { row } = item;
              const frame = row.original;
              const isExpanded = expandedRows.has(frame.id);
              const hasSignals = (frame.decodedSignals?.length ?? 0) > 0;

              return (
                <div
                  key={row.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(frame.id, el);
                    else rowRefs.current.delete(frame.id);
                  }}
                  style={{
                    position: 'absolute',
                    top: vi.start,
                    width: '100%',
                    height: ROW_HEIGHT,
                    display: 'flex',
                    alignItems: 'center',
                    cursor: hasSignals ? 'pointer' : 'default',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                  onClick={() => hasSignals && toggleExpand(frame.id)}
                >
                  {/* Expand toggle */}
                  <div style={styles.expandCell}>
                    {hasSignals && (
                      <span style={{
                        ...styles.expandIcon,
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}>
                        ▶
                      </span>
                    )}
                  </div>

                  {/* Data cells */}
                  {row.getVisibleCells().slice(1).map((cell) => (
                    <div
                      key={cell.id}
                      style={{ width: cell.column.getSize(), flexShrink: 0, paddingLeft: 8 }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}

                  {/* Badges */}
                  <div style={styles.badgeArea}>
                    {frame.j1939?.is_bam_cm && (
                      <span className="badge badge-blue" title="BAM Connection Management">BAM CM</span>
                    )}
                    {frame.j1939?.is_bam_dt && (
                      <span className="badge badge-muted" title="BAM Data Transfer">BAM DT</span>
                    )}
                    {frame.j1939?.dm1_faults && frame.j1939.dm1_faults.length > 0 && (
                      <span className="badge badge-red" title="Active Diagnostic Trouble Codes">
                        DM1 ({frame.j1939.dm1_faults.length})
                      </span>
                    )}
                    {frame.canopen?.frame_type === 'EMCY' && (
                      <span className="badge badge-red" title={frame.canopen.emcy?.error_name ?? 'Emergency'}>
                        EMCY
                      </span>
                    )}
                    {frame.canopen?.sdo_transaction && (
                      <span
                        className="badge badge-green"
                        title={frame.canopen.sdo_transaction.object_name ?? 'SDO paired'}
                      >
                        SDO
                      </span>
                    )}
                    {/* EXT badge: only for extended-ID frames that are not J1939 or CANopen */}
                    {frame.isExtended && !frame.j1939 && !frame.canopen && (
                      <span className="badge badge-muted">EXT</span>
                    )}
                    {frame.isFd && <span className="badge badge-blue">FD</span>}
                    {showDecoded && frame.decodedSignals?.length ? (
                      <span className="badge badge-green">DBC</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--bg-base)',
  },
  header: {
    background: 'var(--bg-panel)',
    borderBottom: '1px solid var(--border-subtle)',
    flexShrink: 0,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    height: 30,
  },
  headerCell: {
    paddingLeft: 8,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    userSelect: 'none',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  expandCell: {
    width: 30,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandIcon: {
    fontSize: 8,
    color: 'var(--text-muted)',
    transition: 'transform 150ms ease',
    display: 'inline-block',
  },
  badgeArea: {
    flex: 1,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 4,
    paddingRight: 10,
  },
  idCell: {
    fontWeight: 600,
    fontSize: 12,
    color: 'var(--accent-green)',
  },
  dataCell: {
    fontSize: 11,
    color: 'var(--text-primary)',
    letterSpacing: '0.04em',
  },
  timeCell: {
    fontSize: 10,
    color: 'var(--text-muted)',
  },
  j1939Absent: {
    color: 'var(--text-muted)',
    fontSize: 12,
  },
  coAbsent: {
    color: 'var(--text-muted)',
    fontSize: 12,
  },
  pgnName: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'block',
    maxWidth: 174,
  },
  saCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  saName: {
    fontSize: 9,
    color: 'var(--text-muted)',
    lineHeight: 1,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 8,
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 32,
    color: 'var(--text-muted)',
    opacity: 0.4,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  emptyHint: {
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  signalContainer: {
    paddingLeft: 30,
    paddingRight: 10,
    background: 'var(--bg-elevated)',
    borderBottom: '1px solid var(--border-subtle)',
  },
  signalRow: {
    display: 'flex',
    alignItems: 'center',
    height: SIGNAL_ROW_HEIGHT,
    gap: 8,
  },
  signalName: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    flex: 1,
  },
  signalValue: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--accent-green)',
    textAlign: 'right',
    minWidth: 60,
  },
  signalUnit: {
    fontSize: 10,
    color: 'var(--text-muted)',
    minWidth: 30,
  },
};
