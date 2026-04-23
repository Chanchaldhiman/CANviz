import { useEffect } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { useSendFrameStore } from '../../store/sendFrameStore';

const DLC_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function rateLabel(ms: number): string {
  if (ms <= 0) return '';
  const hz = 1000 / ms;
  return hz >= 1 ? `${hz % 1 === 0 ? hz : hz.toFixed(1)} Hz` : `${(1 / hz).toFixed(1)} s`;
}

export function SendFramePanel() {
  const status      = useConnectionStore((s) => s.status);
  const isConnected = status === 'connected';

  const { frames, addFrame, removeFrame, updateFrame, sendOnce, toggleTimer, stopAll } =
    useSendFrameStore();

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

      {/* Column headers */}
      <div style={{ display: 'grid', ...gridStyle, color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', padding: '0 2px' }}>
        <span>CAN ID</span>
        <span>DLC</span>
        <span>Data (hex)</span>
        <span style={{ textAlign: 'center' }}>EXT</span>
        <span>Interval</span>
        <span />
      </div>

      {/* Frame rows */}
      {frames.map((f) => (
        <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 3,
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
          border: `1px solid ${f.isRunning ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
          padding: '5px 7px', transition: 'border-color 0.2s' }}>

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

            {/* Extended toggle */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <input
                type="checkbox"
                checked={f.isExtended}
                onChange={(e) => updateFrame(f.id, { isExtended: e.target.checked })}
                title="Extended 29-bit ID"
                style={{ cursor: 'pointer', accentColor: 'var(--accent-green)' }}
              />
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
      ))}

      {/* Add frame button */}
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
          width: '100%',
        }}
      >
        + Add Frame
      </button>
    </div>
  );
}

const gridStyle = {
  gridTemplateColumns: '72px 44px 1fr 28px 110px auto',
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