import { useEffect, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { useDbcStore } from '../../store/dbcStore';
import { useSendFrameStore } from '../../store/sendFrameStore';
import { FrameSetToolbar } from './FrameSetToolbar';
import { DbcSignalEditor } from './DbcSignalEditor';

const DLC_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function rateLabel(ms: number): string {
  if (ms <= 0) return '';
  const hz = 1000 / ms;
  return hz >= 1 ? `${hz % 1 === 0 ? hz : hz.toFixed(1)} Hz` : `${(1 / hz).toFixed(1)} s`;
}

export function SendFramePanel() {
  const status      = useConnectionStore((s) => s.status);
  const isConnected = status === 'connected';

  const { frames, addFrame, removeFrame, updateFrame, sendOnce, toggleTimer, stopAll,
    addDbcFrame, attachDbcMessage } = useSendFrameStore();

  const dbcLoaded   = useDbcStore((s) => s.loaded);
  const dbcMessages = useDbcStore((s) => s.messages);
  const sortedMessages = [...dbcMessages].sort((a, b) => a.name.localeCompare(b.name));

  // Frames whose signal editor is collapsed (expanded by default)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Stop all timers when disconnected
  useEffect(() => {
    if (!isConnected) stopAll();
  }, [isConnected, stopAll]);

  const inp: React.CSSProperties = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    padding: '2px 5px',
    outline: 'none',
    width: '100%',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* Save / restore frame sets */}
      <FrameSetToolbar />

      {/* Column headers */}
      <div style={{ display: 'grid', ...gridStyle, color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', padding: '0 2px' }}>
        <span>CAN ID</span>
        <span>DLC</span>
        <span>Data (hex)</span>
        <span />
        <span>Interval</span>
        <span />
      </div>

      {/* Frame rows */}
      {frames.map((f) => {
        const dbcMsg = f.dbc ? dbcMessages.find((m) => m.name === f.dbc!.message) : undefined;
        const showPicker = dbcLoaded || !!f.dbc;
        const isCollapsed = collapsed.has(f.id);
        return (
        <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 3,
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
          border: `1px solid ${f.isRunning ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
          padding: '5px 7px', transition: 'border-color 0.2s' }}>

          {/* Label row + DBC message picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              style={{ ...inp, flex: 1, fontFamily: 'var(--font-ui)', background: 'transparent',
                border: '1px solid transparent', color: 'var(--text-secondary)', padding: '1px 5px' }}
              value={f.label}
              placeholder="Label (optional)"
              onChange={(e) => updateFrame(f.id, { label: e.target.value })}
              title="A name for this frame, saved with the frame set"
            />
            {showPicker && (
              <select
                style={{ ...inp, width: 200, cursor: 'pointer',
                  color: f.dbc ? 'var(--accent-green)' : 'var(--text-muted)' }}
                value={f.dbc?.message ?? ''}
                onChange={(e) => void attachDbcMessage(f.id, e.target.value || null)}
                title="Build the payload from a DBC message's signals"
              >
                <option value="">Raw bytes (no DBC)</option>
                {f.dbc && !dbcMsg && (
                  <option value={f.dbc.message} disabled>{f.dbc.message} (not in loaded DBC)</option>
                )}
                {sortedMessages.map((m) => (
                  <option key={m.name} value={m.name} disabled={m.length > 8}>
                    {m.name} ({m.id.toUpperCase().replace('0X', '0x')}){m.length > 8 ? ' — CAN FD' : ''}
                  </option>
                ))}
              </select>
            )}
            {dbcMsg && (
              <button
                style={{ ...btnStyle, fontSize: 10, padding: '1px 6px', whiteSpace: 'nowrap' }}
                onClick={() => toggleCollapsed(f.id)}
                title={isCollapsed ? 'Show signals' : 'Hide signals'}
              >
                {isCollapsed ? '▸' : '▾'} {dbcMsg.signals.length} sig
              </button>
            )}
          </div>

          {/* Input row */}
          <div style={{ display: 'grid', ...gridStyle, alignItems: 'center', gap: 5 }}>

            {/* CAN ID */}
            <input
              style={inp}
              value={f.canId}
              placeholder="0x123"
              onChange={(e) => updateFrame(f.id, { canId: e.target.value })}
            />

            {/* DLC */}
            <select
              style={{ ...inp, cursor: 'pointer' }}
              value={f.dlc}
              onChange={(e) => {
                const dlc = parseInt(e.target.value);
                const bytes = f.data.trim().split(/\s+/).map((h) => parseInt(h, 16) || 0);
                const padded = Array.from({ length: dlc }, (_, i) => bytes[i] ?? 0);
                updateFrame(f.id, {
                  dlc,
                  data: padded.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
                });
              }}
            >
              {DLC_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Data */}
            <input
              style={{ ...inp, letterSpacing: '0.04em' }}
              value={f.data}
              placeholder="FF 00 3C ..."
              onChange={(e) => updateFrame(f.id, { data: e.target.value })}
            />

            {/* Extended ID toggle- label sits under checkbox so it fits the narrow column */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <input
                type="checkbox"
                checked={f.isExtended}
                onChange={(e) => updateFrame(f.id, { isExtended: e.target.checked })}
                title="29-bit extended ID- required for J1939 and some proprietary protocols. Standard CAN uses 11-bit."
                style={{ cursor: 'pointer', accentColor: 'var(--accent-green)', margin: 0 }}
              />
              <span style={{
                fontSize: 8,
                fontFamily: 'var(--font-mono)',
                color: f.isExtended ? 'var(--accent-green)' : 'var(--text-muted)',
                letterSpacing: '0.02em',
                lineHeight: 1,
                userSelect: 'none',
              }}>
                29-bit
              </span>
            </div>

            {/* Interval + rate label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <input
                style={{ ...inp, width: 52 }}
                type="number"
                min={10}
                max={60000}
                value={f.intervalMs}
                onChange={(e) => updateFrame(f.id, { intervalMs: parseInt(e.target.value) || 100 })}
                title="Interval in milliseconds"
              />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                ms{f.intervalMs > 0 ? ` · ${rateLabel(f.intervalMs)}` : ''}
              </span>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
              {/* Start / Stop timer */}
              <button
                title={f.isRunning ? 'Stop timer' : 'Start timer'}
                disabled={!isConnected || f.intervalMs <= 0}
                onClick={() => toggleTimer(f.id)}
                style={{
                  ...btnStyle,
                  background: f.isRunning ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)',
                  border: `1px solid ${f.isRunning ? '#ef444440' : '#22c55e40'}`,
                  color: f.isRunning ? '#ef4444' : '#22c55e',
                  opacity: (!isConnected || f.intervalMs <= 0) ? 0.4 : 1,
                }}
              >
                {f.isRunning ? '■' : '▶'}
              </button>

              {/* Send once */}
              <button
                title="Send once"
                disabled={!isConnected}
                onClick={() => sendOnce(f.id)}
                style={{ ...btnStyle, opacity: !isConnected ? 0.4 : 1 }}
              >
                ↑
              </button>

              {/* Remove */}
              <button
                title="Remove frame"
                onClick={() => removeFrame(f.id)}
                style={{ ...btnStyle, color: 'var(--text-muted)' }}
              >
                ×
              </button>
            </div>
          </div>

          {/* DBC signal editor */}
          {dbcMsg && !isCollapsed && <DbcSignalEditor frame={f} message={dbcMsg} />}

          {/* Feedback row */}
          {(f.lastSent || f.error) && (
            <div style={{
              fontSize: 10, fontFamily: 'var(--font-mono)',
              color: f.error ? '#ef4444' : 'var(--accent-green)',
              paddingTop: 2, borderTop: '1px solid var(--border-subtle)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {f.error ? `⚠ ${f.error}` : `↑ ${f.lastSent}`}
            </div>
          )}
        </div>
        );
      })}

      {/* Add frame buttons */}
      <div style={{ display: 'flex', gap: 5 }}>
        <button
          onClick={addFrame}
          style={{
            background: 'none',
            border: '1px dashed var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            padding: '5px',
            cursor: 'pointer',
            flex: 1,
          }}
        >
          + Add Frame
        </button>
        {dbcLoaded && sortedMessages.length > 0 && (
          <select
            style={{ ...inp, width: 220, cursor: 'pointer', border: '1px dashed var(--border-default)',
              color: 'var(--text-muted)', fontSize: 11 }}
            value=""
            onChange={(e) => { if (e.target.value) addDbcFrame(e.target.value); }}
            title="Add a frame built from a DBC message"
          >
            <option value="">+ Add from DBC…</option>
            {sortedMessages.map((m) => (
              <option key={m.name} value={m.name} disabled={m.length > 8}>
                {m.name} ({m.id.toUpperCase().replace('0X', '0x')})
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

const gridStyle = {
  gridTemplateColumns: '96px 44px 1fr 28px 110px auto',
  gap: 5,
};

const btnStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontSize: 12,
  padding: '2px 6px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  lineHeight: 1.4,
};