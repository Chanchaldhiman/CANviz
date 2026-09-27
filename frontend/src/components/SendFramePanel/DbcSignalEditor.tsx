import { useEffect, useState } from 'react';
import type { DbcMessage, DbcSignal } from '../../types/can';
import { defaultSignalValue, useSendFrameStore, type TransmitFrame } from '../../store/sendFrameStore';

function fmt(v: number): string {
  // Trim float noise from scaled values (0.1 * 3 → 0.3)
  return String(Number(v.toPrecision(10)));
}

/** Signals present for the current multiplexer value(s) */
function isActive(sig: DbcSignal, values: Record<string, number>, msg: DbcMessage): boolean {
  if (!sig.multiplexer_ids || !sig.multiplexer_signal) return true;
  const mux = msg.signals.find((s) => s.name === sig.multiplexer_signal);
  const muxValue = values[sig.multiplexer_signal] ?? (mux ? defaultSignalValue(mux) : 0);
  return sig.multiplexer_ids.includes(muxValue);
}

function outOfRange(sig: DbcSignal, v: number): boolean {
  return (sig.min !== null && v < sig.min) || (sig.max !== null && v > sig.max);
}

function rangeText(sig: DbcSignal): string {
  if (sig.min === null && sig.max === null) return '';
  return `[${sig.min === null ? '…' : fmt(sig.min)} … ${sig.max === null ? '…' : fmt(sig.max)}]`;
}

/**
 * Numeric input that keeps the user's in-progress text ("1.", "-") locally and
 * only commits parseable numbers to the store.
 */
function NumberField({ value, invalid, onCommit, title }: {
  value: number;
  invalid: boolean;
  onCommit: (v: number) => void;
  title: string;
}) {
  const [draft, setDraft] = useState(fmt(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => { if (!focused) setDraft(fmt(value)); }, [value, focused]);

  return (
    <input
      style={{ ...inp, borderColor: invalid ? 'var(--accent-amber)' : 'var(--border-default)' }}
      value={draft}
      inputMode="decimal"
      title={title}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setDraft(fmt(value)); }}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v)) onCommit(v);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function DbcSignalEditor({ frame, message }: { frame: TransmitFrame; message: DbcMessage }) {
  const setSignalValue = useSendFrameStore((s) => s.setSignalValue);
  const values = frame.dbc?.signals ?? {};

  const signals = message.signals.filter((sig) => isActive(sig, values, message));
  if (signals.length === 0) {
    return <div style={{ ...note, padding: '4px 2px' }}>{message.name} has no signals</div>;
  }

  return (
    <div style={grid}>
      {signals.map((sig) => {
        const value = values[sig.name] ?? defaultSignalValue(sig);
        const choices = Object.entries(sig.choices ?? {});
        const oor = outOfRange(sig, value);
        const tip = [
          sig.name,
          sig.comment,
          `${sig.length} bit${sig.length === 1 ? '' : 's'} @ ${sig.start}, ${sig.byte_order.replace('_', ' ')}` +
            `${sig.is_signed ? ', signed' : ''}, ×${fmt(sig.scale)} + ${fmt(sig.offset)}`,
          oor ? `Outside DBC range ${rangeText(sig)} — will still be sent` : '',
        ].filter(Boolean).join('\n');

        return (
          <div key={sig.name} style={cell} title={tip}>
            <span style={nameStyle}>
              {sig.is_multiplexer && <span style={muxBadge}>MUX</span>}
              {sig.name}
            </span>

            {choices.length > 0 ? (
              <select
                style={{ ...inp, cursor: 'pointer', borderColor: oor ? 'var(--accent-amber)' : 'var(--border-default)' }}
                value={fmt(value)}
                onChange={(e) => void setSignalValue(frame.id, sig.name, Number(e.target.value))}
              >
                {/* Choice keys are raw values; the editor works in physical units */}
                {choices.map(([raw, label]) => {
                  const phys = fmt(Number(raw) * sig.scale + sig.offset);
                  return <option key={raw} value={phys}>{label} ({raw})</option>;
                })}
                {!choices.some(([raw]) => fmt(Number(raw) * sig.scale + sig.offset) === fmt(value)) && (
                  <option value={fmt(value)}>{fmt(value)}</option>
                )}
              </select>
            ) : (
              <NumberField
                value={value}
                invalid={oor}
                title={tip}
                onCommit={(v) => void setSignalValue(frame.id, sig.name, v)}
              />
            )}

            <span style={unitStyle}>
              {sig.unit}
              {rangeText(sig) && <span style={{ opacity: 0.7 }}> {rangeText(sig)}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const inp: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '2px 5px',
  outline: 'none',
  width: '100%',
  minWidth: 0,
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: '3px 12px',
  paddingTop: 4,
  borderTop: '1px solid var(--border-subtle)',
};

const cell: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(90px, 1fr) 100px minmax(60px, 1fr)',
  alignItems: 'center',
  gap: 5,
};

const nameStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const unitStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const muxBadge: React.CSSProperties = {
  fontSize: 8,
  color: 'var(--accent-amber)',
  border: '1px solid var(--accent-amber)',
  borderRadius: 3,
  padding: '0 3px',
  marginRight: 4,
};

const note: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-muted)',
};
