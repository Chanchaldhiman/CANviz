import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
  flexRender,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFrameStore } from '../../store/frameStore';
import type { FrameRow, DecodedSignal } from '../../types/can';

// How long the row flash lasts (must match CSS animation)
const FLASH_DURATION_MS = 400;

// ============================================================
// Flash tracker (outside React state to avoid re-renders)
// ============================================================
const flashTimers = new Map<number, ReturnType<typeof setTimeout>>();

function triggerFlash(el: HTMLElement, id: number) {
  if (flashTimers.has(id)) {
    clearTimeout(flashTimers.get(id));
    el.classList.remove('row-flash');
    // Force reflow to restart animation
    void el.offsetHeight;
  }
  el.classList.add('row-flash');
  const t = setTimeout(() => {
    el.classList.remove('row-flash');
    flashTimers.delete(id);
  }, FLASH_DURATION_MS);
  flashTimers.set(id, t);
}

// ============================================================
// Rate colorizer
// ============================================================
function rateColor(fps: number): string {
  if (fps === 0) return 'var(--text-muted)';
  if (fps < 10)  return 'var(--text-secondary)';
  if (fps < 100) return 'var(--accent-amber)';
  return 'var(--accent-red)';
}

// ============================================================
// Expanded signal sub-row
// ============================================================
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

// ============================================================
// Column definitions
// ============================================================
const columns: ColumnDef<FrameRow>[] = [
  {
    id: 'expand',
    size: 24,
    cell: () => null, // controlled externally via expandedRows state
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

// ============================================================
// Main component
// ============================================================
const ROW_HEIGHT = 30;
const SIGNAL_ROW_HEIGHT = 18;

export function MessageTable() {
  const frameList = useFrameStore((s) => s.frameList);
  const showDecoded = useFrameStore((s) => s.filter.showDecoded);

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Refs to DOM rows for flash effect
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Track previous flashKey per row to detect updates
  const prevFlashKeys = useRef<Map<number, number>>(new Map());

  // Trigger flash on updated rows
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

  const table = useReactTable({
    data: frameList,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  const parentRef = useRef<HTMLDivElement>(null);

  // Build a flat list of items including signal sub-rows for virtualizer
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
            {/* Expand column */}
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
                    {frame.isExtended && <span className="badge badge-muted">EXT</span>}
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
