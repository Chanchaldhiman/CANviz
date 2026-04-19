import { useState, useCallback } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { apiSendFrame } from '../../api/client';

function parseHexBytes(input: string): number[] | null {
  // Accept "FF 00 3C" or "FF003C" or "FF,00,3C"
  const cleaned = input.replace(/[,\s]+/g, ' ').trim();
  if (!cleaned) return [];
  const parts = cleaned.split(' ');
  const bytes: number[] = [];
  for (const p of parts) {
    const v = parseInt(p, 16);
    if (isNaN(v) || v < 0 || v > 255) return null;
    bytes.push(v);
  }
  return bytes;
}

function parseHexId(input: string): number | null {
  const v = parseInt(input.replace(/^0x/i, ''), 16);
  return isNaN(v) ? null : v;
}

const DLC_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export function SendFramePanel() {
  const status = useConnectionStore((s) => s.status);
  const isConnected = status === 'connected';

  const [idInput, setIdInput] = useState('0x123');
  const [dlc, setDlc] = useState(8);
  const [dataInput, setDataInput] = useState('00 00 00 00 00 00 00 00');
  const [isExtended, setIsExtended] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const handleDlcChange = useCallback((newDlc: number) => {
    setDlc(newDlc);
    // Auto-pad/trim data bytes to match DLC
    const bytes = parseHexBytes(dataInput) ?? [];
    const padded = Array.from({ length: newDlc }, (_, i) => bytes[i] ?? 0);
    setDataInput(padded.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
  }, [dataInput]);

  const handleSend = async () => {
    setError(null);

    const id = parseHexId(idInput);
    if (id === null) { setError('Invalid CAN ID — enter a hex value e.g. 0x123'); return; }

    const maxId = isExtended ? 0x1FFFFFFF : 0x7FF;
    if (id > maxId) { setError(`ID 0x${id.toString(16).toUpperCase()} exceeds max for ${isExtended ? 'extended (29-bit)' : 'standard (11-bit)'} frame`); return; }

    const data = parseHexBytes(dataInput);
    if (data === null) { setError('Invalid data — enter hex bytes separated by spaces e.g. FF 00 3C'); return; }
    if (data.length > dlc) { setError(`${data.length} bytes entered but DLC is ${dlc}`); return; }

    // Pad to DLC
    while (data.length < dlc) data.push(0);

    setSending(true);
    try {
      await apiSendFrame({ id, dlc, data, is_extended_id: isExtended });
      setLastSent(
        `${isExtended ? '[EXT]' : '[STD]'} 0x${id.toString(16).toUpperCase()} [${dlc}] ` +
        data.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {/* CAN ID */}
      <div className="field-group">
        <label className="field-label">CAN ID (hex)</label>
        <input
          className="field-input"
          type="text"
          placeholder="0x123"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
        />
      </div>

      {/* DLC */}
      <div className="field-group">
        <label className="field-label">DLC (bytes)</label>
        <select
          className="field-select"
          value={dlc}
          onChange={(e) => handleDlcChange(parseInt(e.target.value))}
        >
          {DLC_OPTIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Data */}
      <div className="field-group">
        <label className="field-label">Data (hex bytes)</label>
        <input
          className="field-input"
          type="text"
          placeholder="FF 00 3C 00 00 00 00 00"
          value={dataInput}
          onChange={(e) => setDataInput(e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
        />
      </div>

      {/* Extended ID toggle */}
      <div className="toggle-row">
        <label className="toggle-label" htmlFor="ext-toggle">Extended ID (29-bit)</label>
        <label className="toggle" htmlFor="ext-toggle">
          <input
            id="ext-toggle"
            type="checkbox"
            checked={isExtended}
            onChange={(e) => setIsExtended(e.target.checked)}
          />
          <span className="toggle-track" />
        </label>
      </div>

      {/* Error */}
      {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}

      {/* Last sent */}
      {lastSent && !error && (
        <div style={styles.lastSent} className="mono text-xs">
          ↑ {lastSent}
        </div>
      )}

      {/* Send button */}
      <button
        className="btn btn-primary btn-full"
        style={{ marginTop: 10 }}
        disabled={!isConnected || sending}
        onClick={handleSend}
      >
        {sending ? 'Sending…' : isConnected ? 'Send Frame' : 'Not Connected'}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  lastSent: {
    marginTop: 6,
    padding: '4px 6px',
    background: 'var(--accent-green-dim)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--accent-green)',
    wordBreak: 'break-all',
  },
};
