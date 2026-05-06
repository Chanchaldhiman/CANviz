/**
 * CANopenPanel.tsx  --  v1.2
 *
 * Section order:
 *   1.  Mode toggle
 *   2.  SYNC strip
 *   3.  Nodes table
 *   4.  CiA 402 Drive Control  (quick state buttons, one-time warning)
 *   5.  EMCY Events
 *   6.  SDO Log
 *   7.  SDO Read
 *   8.  SDO Write  (direct send, no two-step)
 *   9.  NMT Commands
 *   10. Object Dictionary  (collapsible)
 *   11. Read All Node Objects
 *   12. EDS upload
 */

import { useEffect, useRef, useState } from 'react';
import { useCANopenStore } from '../../store/canopenStore';
import type { CANopenNode, SdoTransaction, EmcyRecord } from '../../store/canopenStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(s: number | null): string {
  if (s === null) return 'never';
  if (s < 2)     return 'just now';
  if (s < 60)    return `${Math.round(s)}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function nmtColor(state: string): string {
  if (state === 'Operational')     return 'var(--accent-green)';
  if (state === 'Pre-Operational') return 'var(--accent-amber)';
  if (state === 'Stopped')         return 'var(--accent-red)';
  return 'var(--text-muted)';
}

function cia402Color(state: string): string {
  if (state.includes('Operation Enabled')) return 'var(--accent-green)';
  if (state.includes('Fault'))             return 'var(--accent-red)';
  if (state.includes('Quick Stop'))        return 'var(--accent-amber)';
  return 'var(--accent-amber)';
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root:  { fontSize: 13, color: 'var(--text-primary)' },
  mono:  { fontFamily: 'var(--font-mono, monospace)', fontSize: 12 },
  muted: { color: 'var(--text-muted)', fontSize: 12 },

  modeRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)',
    gap: 10, flexWrap: 'wrap' as const,
  },
  modeLabel: { fontWeight: 600, fontSize: 13, marginBottom: 2 },
  modeSub:   { fontSize: 11, color: 'var(--text-muted)' },

  activeChip: {
    marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
    background: 'rgba(0,200,100,0.12)', color: 'var(--accent-green)',
    border: '1px solid var(--accent-green)', borderRadius: 4, padding: '1px 6px',
  },
  detectedBadge: {
    fontSize: 10, fontWeight: 600,
    background: 'rgba(255,180,0,0.12)', color: 'var(--accent-amber)',
    border: '1px solid var(--accent-amber)', borderRadius: 4, padding: '2px 8px',
  },

  sectionHead: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    color: 'var(--text-muted)', textTransform: 'uppercase' as const,
    marginTop: 14, marginBottom: 6,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  badge: {
    fontSize: 10, fontWeight: 700,
    background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
    borderRadius: 3, padding: '1px 5px', color: 'var(--text-secondary)',
  },

  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: {
    padding: '4px 6px', borderBottom: '1px solid var(--border-subtle)',
    textAlign: 'left' as const, color: 'var(--text-muted)', fontWeight: 600, fontSize: 11,
  },
  td: { padding: '3px 6px', borderBottom: '1px solid var(--border-subtle)' },

  inputRow:   { display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' as const },
  inputGroup: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  inputLabel: { fontSize: 10, color: 'var(--text-muted)' },
  input: {
    background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
    borderRadius: 4, padding: '3px 7px', color: 'var(--text-primary)', fontSize: 12, width: 80,
  },
  inputWide: {
    background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
    borderRadius: 4, padding: '3px 7px', color: 'var(--text-primary)', fontSize: 12, width: 100,
  },
  select: {
    background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
    borderRadius: 4, padding: '3px 7px', color: 'var(--text-primary)', fontSize: 12,
  },

  resultOk:  { fontSize: 11, marginTop: 5, color: 'var(--accent-green)' },
  resultErr: { fontSize: 11, marginTop: 5, color: 'var(--accent-red)' },

  faultBadge: {
    fontSize: 10, fontWeight: 700, color: 'var(--accent-red)',
    background: 'rgba(220,50,50,0.12)', border: '1px solid var(--accent-red)',
    borderRadius: 3, padding: '1px 5px', marginLeft: 6,
  },

  edsChip: {
    fontSize: 11, fontWeight: 600,
    background: 'rgba(0,200,100,0.10)', color: 'var(--accent-green)',
    border: '1px solid var(--accent-green)', borderRadius: 4, padding: '2px 8px',
  },

  accordionTrigger: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    cursor: 'pointer', userSelect: 'none' as const,
    marginTop: 14, padding: '6px 0 5px',
    borderTop: '1px solid var(--border-subtle)',
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    color: 'var(--text-muted)', textTransform: 'uppercase' as const,
  },
};

// ── CiA 402 Drive Control ─────────────────────────────────────────────────────

const WARNING_KEY = 'canviz:cia402_warning_accepted';

// Standard CiA 402 Controlword values for common state transitions
const CIA402_ACTIONS = [
  {
    label: 'Enable',
    controlword: 0x000F,
    color: 'var(--accent-green)',
    help: 'Sends 0x000F to 0x6040 -- transitions to Operation Enabled. Motor becomes live.',
  },
  {
    label: 'Switch On',
    controlword: 0x0007,
    color: 'var(--accent-blue)',
    help: 'Sends 0x0007 to 0x6040 -- transitions to Switched On. Power applied, motor not yet moving.',
  },
  {
    label: 'Shutdown',
    controlword: 0x0006,
    color: 'var(--accent-amber)',
    help: 'Sends 0x0006 to 0x6040 -- transitions to Ready to Switch On.',
  },
  {
    label: 'Quick Stop',
    controlword: 0x0002,
    color: '#e06c75',
    help: 'Sends 0x0002 to 0x6040 -- initiates Quick Stop deceleration.',
  },
  {
    label: 'Disable',
    controlword: 0x0000,
    color: 'var(--text-muted)',
    help: 'Sends 0x0000 to 0x6040 -- Disable Voltage. Drive goes to Switch On Disabled.',
  },
  {
    label: 'Fault Reset',
    controlword: 0x0080,
    color: 'var(--accent-amber)',
    help: 'Sends 0x0080 to 0x6040 -- clears active fault. Drive returns to Switch On Disabled.',
  },
];

function DriveControlPanel({ nodes }: { nodes: CANopenNode[] }) {
  const [accepted,  setAccepted]  = useState(() => !!localStorage.getItem(WARNING_KEY));
  const [targetId,  setTargetId]  = useState<number>(nodes[0]?.node_id ?? 1);
  const [result,    setResult]    = useState<string | null>(null);
  const [busy,      setBusy]      = useState(false);

  const sendControlword = async (cw: number) => {
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/canopen/sdo/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id:   targetId,
          index:     0x6040,
          subindex:  0,
          data:      [cw & 0xFF, (cw >> 8) & 0xFF],
          confirmed: true,
        }),
      });
      const data = await res.json();
      setResult(data.ok
        ? `Sent Controlword 0x${cw.toString(16).toUpperCase().padStart(4, '0')} to node 0x${targetId.toString(16).padStart(2, '0').toUpperCase()}`
        : `Error: ${data.detail}`);
    } catch { setResult('Send failed'); }
    finally { setBusy(false); }
  };

  const acceptWarning = () => {
    localStorage.setItem(WARNING_KEY, '1');
    setAccepted(true);
  };

  const targetNode = nodes.find((n) => n.node_id === targetId);

  // Warning banner
  if (!accepted) {
    return (
      <div style={{
        padding: '10px 12px', borderRadius: 6,
        background: 'rgba(239,68,68,0.07)',
        border: '1px solid rgba(239,68,68,0.3)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--accent-red)', marginBottom: 6 }}>
          Safety notice -- CiA 402 Drive Control
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
          These buttons write directly to the drive Controlword (0x6040).
          Sending <strong>Enable (0x000F)</strong> will activate the drive and may cause
          motor motion immediately. Ensure the machine, drive, and surrounding
          personnel are in a safe state before proceeding.
        </div>
        <button
          className="btn btn-sm"
          style={{ background: 'var(--accent-red)', color: '#fff', border: 'none', fontWeight: 700 }}
          onClick={acceptWarning}
        >
          I understand, show drive controls
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Node selector + current state */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' as const }}>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Target node</span>
          <select style={s.select} value={targetId}
            onChange={(e) => { setTargetId(parseInt(e.target.value)); setResult(null); }}>
            {nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>
                Node {n.node_id_hex}
              </option>
            ))}
          </select>
        </div>
        {targetNode?.cia402_state && (
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>State: </span>
            <span style={{ fontWeight: 700, color: cia402Color(targetNode.cia402_state) }}>
              {targetNode.cia402_state}
            </span>
          </div>
        )}
        <button
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 10, alignSelf: 'flex-end' }}
          onClick={() => { localStorage.removeItem(WARNING_KEY); setAccepted(false); }}
          title="Re-read safety notice"
        >
          safety notice
        </button>
      </div>

      {/* Quick action buttons */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
        {CIA402_ACTIONS.map((action) => (
          <button
            key={action.label}
            title={action.help}
            disabled={busy}
            onClick={() => sendControlword(action.controlword)}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 600,
              borderRadius: 5, border: `1px solid ${action.color}`,
              background: 'transparent', color: action.color,
              cursor: 'pointer', transition: 'all 0.12s',
              opacity: busy ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = action.color;
              (e.currentTarget as HTMLButtonElement).style.color = '#111';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = action.color;
            }}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div style={{ ...s.muted, marginTop: 5 }}>
        Hover a button to see what Controlword value it sends. Writes go to 0x6040:0 via SDO.
        Response appears in SDO log.
      </div>

      {result && (
        <div style={{ ...(result.startsWith('Error') ? s.resultErr : s.resultOk), marginTop: 4 }}>
          {result}
        </div>
      )}
    </div>
  );
}

// ── EDS upload ────────────────────────────────────────────────────────────────

function EdsSection() {
  const edsLoaded   = useCANopenStore((x) => x.edsLoaded);
  const edsFilename = useCANopenStore((x) => x.edsFilename);
  const canopenLib  = useCANopenStore((x) => x.canopenLibAvailable);
  const [busy, setBusy] = useState(false);
  const [msg,  setMsg]  = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch('/canopen/eds', { method: 'POST', body: form });
      const data = await res.json();
      setMsg(data.ok ? `Loaded: ${file.name}` : `Error: ${data.detail || data.message}`);
    } catch { setMsg('Upload failed'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const handleClear = async () => {
    await fetch('/canopen/eds', { method: 'DELETE' });
    setMsg(null);
  };

  return (
    <div style={{
      marginTop: 14, padding: '10px 12px', borderRadius: 6,
      background: edsLoaded ? 'rgba(0,200,100,0.06)' : 'var(--bg-input)',
      border: edsLoaded ? '1px solid rgba(0,200,100,0.3)' : '1px solid var(--border-strong)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' as const }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
            EDS / DCF File
            {edsLoaded && <span style={{ ...s.edsChip, marginLeft: 8 }}>{edsFilename}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {edsLoaded
              ? 'PDO signals are now decoded. Named signals appear in the message table and plot selector.'
              : 'Optional -- enables named PDO signal decode. Standard CiA 301/402 objects are always named without EDS.'}
          </div>
          {!canopenLib && !edsLoaded && (
            <div style={{ fontSize: 10, color: 'var(--accent-amber)', marginTop: 2 }}>
              pip install canopen required for PDO signal decode
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {edsLoaded ? (
            <button className="btn btn-ghost btn-sm" onClick={handleClear}>Remove</button>
          ) : (
            <>
              <input
                ref={fileRef} type="file" accept=".eds,.dcf"
                onChange={handleUpload} style={{ display: 'none' }}
                id="canopen-eds-input"
              />
              <label htmlFor="canopen-eds-input" className="btn btn-primary btn-sm"
                style={{ cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                {busy ? 'Uploading...' : 'Upload EDS / DCF'}
              </label>
            </>
          )}
          {msg && <span style={msg.startsWith('Error') ? s.resultErr : s.resultOk}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Node table ────────────────────────────────────────────────────────────────

function NodeTable({ nodes }: { nodes: CANopenNode[] }) {
  if (nodes.length === 0) {
    return (
      <div style={{ ...s.muted, lineHeight: 1.7 }}>
        No nodes seen yet. Heartbeat frames (0x701-0x77F) identify nodes automatically.
        Any 11-bit CAN frame in the CANopen ID range is tracked here.
      </div>
    );
  }

  return (
    <table style={s.table}>
      <thead>
        <tr>
          {['Node', 'NMT State', 'Heartbeat', 'Interval', 'Frames'].map((h) => (
            <th key={h} style={s.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {nodes.map((n) => (
          <>
            <tr key={n.node_id}>
              <td style={{ ...s.td, ...s.mono, color: 'var(--accent-green)' }}>{n.node_id_hex}</td>
              <td style={{ ...s.td, color: nmtColor(n.nmt_state), fontWeight: 600 }}>
                {n.nmt_state}
                {n.emcy_active && <span style={s.faultBadge}>FAULT</span>}
              </td>
              <td style={{ ...s.td, color: 'var(--text-muted)' }}>{relTime(n.last_heartbeat_s)}</td>
              <td style={{ ...s.td, ...s.mono, color: 'var(--text-muted)' }}>
                {n.heartbeat_interval_ms !== null ? `${n.heartbeat_interval_ms}ms` : '--'}
              </td>
              <td style={{ ...s.td, ...s.mono }}>{n.frame_count.toLocaleString()}</td>
            </tr>
            {n.cia402_state && (
              <tr key={`${n.node_id}-402`}>
                <td style={{ ...s.td, paddingLeft: 18 }} colSpan={2}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CiA 402: </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, marginLeft: 4,
                    color: cia402Color(n.cia402_state),
                    background: 'rgba(0,0,0,0.15)',
                    border: `1px solid ${cia402Color(n.cia402_state)}`,
                    borderRadius: 3, padding: '1px 5px',
                  }}>
                    {n.cia402_state}
                  </span>
                  {n.cia402_statusword && (
                    <span style={{ ...s.mono, color: 'var(--text-muted)', marginLeft: 8, fontSize: 10 }}>
                      SW {n.cia402_statusword}
                    </span>
                  )}
                </td>
                <td style={{ ...s.td, color: 'var(--text-muted)', fontSize: 11 }} colSpan={3}>
                  {n.cia402_mode ?? ''}
                </td>
              </tr>
            )}
          </>
        ))}
      </tbody>
    </table>
  );
}

// ── SDO log ───────────────────────────────────────────────────────────────────

function SdoLog({ records }: { records: SdoTransaction[] }) {
  if (records.length === 0) {
    return <div style={s.muted}>SDO request/response pairs appear here when observed or sent.</div>;
  }

  return (
    <div style={{ maxHeight: 180, overflowY: 'auto' }}>
      <table style={s.table}>
        <thead>
          <tr>
            {['Node', 'Index:Sub', 'Name', 'Value', 'Status'].map((h) => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              <td style={{ ...s.td, ...s.mono, color: 'var(--accent-green)' }}>
                0x{r.node_id.toString(16).toUpperCase().padStart(2, '0')}
              </td>
              <td style={{ ...s.td, ...s.mono }}>{r.index}:{r.subindex}</td>
              <td style={{
                ...s.td, color: 'var(--text-secondary)',
                maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
              }}>
                {r.object_name || '--'}
              </td>
              <td style={{ ...s.td, ...s.mono }}>
                {r.data_hex || '--'}
                {r.value_int !== null && r.value_int !== undefined && (
                  <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({r.value_int})</span>
                )}
              </td>
              <td style={{ ...s.td, fontSize: 11, color: r.is_abort ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                {r.is_abort ? 'ABORT' : 'OK'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── EMCY log ──────────────────────────────────────────────────────────────────

function EmcyLog({ records }: { records: EmcyRecord[] }) {
  return (
    <>
      {records.map((r, i) => (
        <div key={i} style={{
          marginBottom: 5, padding: '5px 8px', fontSize: 12,
          background: 'rgba(220,50,50,0.06)',
          border: '1px solid rgba(220,50,50,0.2)', borderRadius: 4,
        }}>
          <span style={{ ...s.mono, color: 'var(--accent-red)', fontWeight: 700, marginRight: 8 }}>
            Node 0x{r.node_id.toString(16).toUpperCase().padStart(2, '0')}
          </span>
          <span style={s.mono}>{r.error_code_hex}</span>
          <span style={{ marginLeft: 8 }}>{r.error_name}</span>
          {r.error_register_flags.length > 0 && (
            <span style={{ ...s.muted, marginLeft: 8 }}>
              [{r.error_register_flags.join(', ')}]
            </span>
          )}
        </div>
      ))}
    </>
  );
}

// ── SDO read ──────────────────────────────────────────────────────────────────

interface SdoReadProps {
  prefillIndex?: string;
  prefillSub?: number;
}

function SdoReadPanel({ prefillIndex, prefillSub }: SdoReadProps) {
  const [nodeId,   setNodeId]   = useState('1');
  const [index,    setIndex]    = useState('0x1008');
  const [subindex, setSubindex] = useState('0');
  const [result,   setResult]   = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  useEffect(() => { if (prefillIndex) setIndex(prefillIndex); }, [prefillIndex]);
  useEffect(() => { if (prefillSub !== undefined) setSubindex(String(prefillSub)); }, [prefillSub]);

  const send = async () => {
    setBusy(true); setResult(null);
    try {
      const res  = await fetch('/canopen/sdo/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id:  parseInt(nodeId),
          index:    parseInt(index.replace(/^0x/i, ''), 16),
          subindex: parseInt(subindex),
        }),
      });
      const data = await res.json();
      setResult(data.ok ? 'Sent -- response appears in SDO log above.' : `Error: ${data.detail}`);
    } catch { setResult('Request failed'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={s.inputRow}>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Node ID</span>
          <input style={s.input} value={nodeId}
            onChange={(e) => setNodeId(e.target.value)} placeholder="1" />
        </div>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Index</span>
          <input style={s.inputWide} value={index}
            onChange={(e) => setIndex(e.target.value)} placeholder="0x1008" />
        </div>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Sub</span>
          <input style={{ ...s.input, width: 50 }} value={subindex}
            onChange={(e) => setSubindex(e.target.value)} placeholder="0" />
        </div>
        <button className="btn btn-primary btn-sm" onClick={send} disabled={busy}
          style={{ alignSelf: 'flex-end' }}>
          {busy ? '...' : 'Read'}
        </button>
      </div>
      {result && <div style={result.startsWith('Error') ? s.resultErr : s.resultOk}>{result}</div>}
    </div>
  );
}

// ── SDO write (direct, no two-step) ──────────────────────────────────────────

function SdoWritePanel() {
  const [nodeId,  setNodeId]  = useState('1');
  const [index,   setIndex]   = useState('0x6040');
  const [subIdx,  setSubIdx]  = useState('0');
  const [dataHex, setDataHex] = useState('');
  const [objName, setObjName] = useState<string | null>(null);
  const [result,  setResult]  = useState<string | null>(null);
  const [busy,    setBusy]    = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const q    = index.replace(/^0x/i, '').toUpperCase();
        const res  = await fetch(`/canopen/objects?q=${encodeURIComponent('0x' + q)}`);
        const data = await res.json();
        const sub  = parseInt(subIdx) || 0;
        const match = (data.results as Array<{index: string; subindex: number; name: string}>)
          ?.find((r) => r.index.toUpperCase() === ('0x' + q) && r.subindex === sub);
        setObjName(match?.name ?? data.results?.[0]?.name ?? null);
      } catch { setObjName(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [index, subIdx]);

  const parseBytes = (): number[] | null => {
    const parts = dataHex.trim().split(/\s+|,/).filter(Boolean);
    const out: number[] = [];
    for (const p of parts) {
      const b = parseInt(p.replace(/^0x/i, ''), 16);
      if (isNaN(b) || b < 0 || b > 255) return null;
      out.push(b);
    }
    return out.length >= 1 && out.length <= 4 ? out : null;
  };

  const bytes    = parseBytes();
  const hasBytes = bytes !== null && dataHex.trim().length > 0;

  const handleSend = async () => {
    if (!bytes) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/canopen/sdo/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id:   parseInt(nodeId),
          index:     parseInt(index.replace(/^0x/i, ''), 16),
          subindex:  parseInt(subIdx),
          data:      bytes,
          confirmed: true,
        }),
      });
      const data = await res.json();
      setResult(data.ok ? `Sent -- watch SDO log for node ${nodeId} acknowledgement.`
        : `Error: ${data.detail}`);
    } catch { setResult('Request failed'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={s.inputRow}>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Node ID</span>
          <input style={s.input} value={nodeId}
            onChange={(e) => setNodeId(e.target.value)} placeholder="1" />
        </div>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Index</span>
          <input style={s.inputWide} value={index}
            onChange={(e) => setIndex(e.target.value)} placeholder="0x6040" />
        </div>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Sub</span>
          <input style={{ ...s.input, width: 50 }} value={subIdx}
            onChange={(e) => setSubIdx(e.target.value)} placeholder="0" />
        </div>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Data (LE hex bytes, 1-4)</span>
          <input
            style={{
              ...s.inputWide, width: 120,
              borderColor: dataHex.trim() && !hasBytes ? 'var(--accent-red)' : undefined,
            }}
            value={dataHex}
            onChange={(e) => { setDataHex(e.target.value); setResult(null); }}
            placeholder="0F 00"
          />
        </div>
        <button
          className="btn btn-sm"
          style={{
            fontWeight: 700, border: 'none', alignSelf: 'flex-end',
            background: hasBytes ? 'var(--accent-amber)' : 'var(--bg-input)',
            color: hasBytes ? '#111' : 'var(--text-muted)',
          }}
          onClick={handleSend}
          disabled={!hasBytes || busy}
        >
          {busy ? '...' : 'Write'}
        </button>
      </div>
      {objName && (
        <div style={{ fontSize: 11, color: 'var(--accent-blue)', marginTop: 4 }}>{objName}</div>
      )}
      {result && <div style={result.startsWith('Error') ? s.resultErr : s.resultOk}>{result}</div>}
    </div>
  );
}

// ── NMT commands ──────────────────────────────────────────────────────────────

const NMT_CMDS = [
  { value: 0x01, label: 'Operational',     color: 'var(--accent-green)' },
  { value: 0x80, label: 'Pre-Operational', color: 'var(--accent-amber)' },
  { value: 0x02, label: 'Stop',            color: 'var(--accent-red)'   },
  { value: 0x81, label: 'Reset Node',      color: '#e06c75'             },
  { value: 0x82, label: 'Reset Comm',      color: '#be5046'             },
];

function NmtPanel({ nodes }: { nodes: CANopenNode[] }) {
  const [pending, setPending] = useState<number | null>(null);
  const [target,  setTarget]  = useState(0);
  const [result,  setResult]  = useState<string | null>(null);
  const [busy,    setBusy]    = useState(false);

  const handleClick = (v: number) => {
    setPending((prev) => prev === v ? null : v);
    setResult(null);
  };

  const handleSend = async () => {
    if (pending === null) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/canopen/nmt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: target, command: pending, confirmed: true }),
      });
      const data = await res.json();
      if (data.ok) { setResult(data.message); setPending(null); }
      else setResult(`Error: ${data.detail}`);
    } catch { setResult('Send failed'); }
    finally { setBusy(false); }
  };

  const pendingCmd = NMT_CMDS.find((c) => c.value === pending);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
        {NMT_CMDS.map((cmd) => {
          const sel = pending === cmd.value;
          return (
            <button key={cmd.value} onClick={() => handleClick(cmd.value)}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                borderRadius: 5, border: `1px solid ${cmd.color}`,
                background: sel ? cmd.color : 'transparent',
                color: sel ? '#111' : cmd.color,
                cursor: 'pointer', transition: 'all 0.12s',
              }}>
              {cmd.label}
            </button>
          );
        })}
      </div>

      {pending !== null && pendingCmd && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
          padding: '7px 10px', borderRadius: 5,
          background: 'var(--bg-input)', border: `1px solid ${pendingCmd.color}`,
          flexWrap: 'wrap' as const,
        }}>
          <span style={{ fontSize: 12, color: pendingCmd.color, fontWeight: 600 }}>
            {pendingCmd.label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
          <select style={s.select} value={target}
            onChange={(e) => setTarget(parseInt(e.target.value))}>
            <option value={0}>All nodes (broadcast)</option>
            {nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>
                Node {n.node_id_hex} ({n.nmt_state})
              </option>
            ))}
          </select>
          <button className="btn btn-sm"
            style={{ background: pendingCmd.color, color: '#111', fontWeight: 700, border: 'none', opacity: busy ? 0.6 : 1 }}
            onClick={handleSend} disabled={busy}>
            {busy ? 'Sending...' : 'Send'}
          </button>
          <button className="btn btn-ghost btn-sm"
            onClick={() => { setPending(null); setResult(null); }}>
            Cancel
          </button>
        </div>
      )}

      {result && <div style={result.startsWith('Error') ? s.resultErr : s.resultOk}>{result}</div>}
    </div>
  );
}

// ── Object dictionary browser (collapsible) ───────────────────────────────────

interface OdEntry { index: string; subindex: number; name: string; unit: string; }

function ObjectDictionaryBrowser({ onSelect }: { onSelect: (idx: string, sub: number) => void }) {
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<OdEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const lastQ = useRef('');

  const doSearch = async (q: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`/canopen/objects?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    if (query === lastQ.current) return;
    lastQ.current = query;
    const t = setTimeout(() => doSearch(query), 220);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    if (open && results.length === 0 && !loading) doSearch('');
  }, [open]);

  return (
    <div>
      <div style={s.accordionTrigger} role="button" tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((v) => !v)}>
        <span>Object Dictionary (CiA 301 + CiA 402 built-in)</span>
        <span style={{ fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 6 }}>
            <input
              style={{ ...s.input, width: '100%', boxSizing: 'border-box' as const }}
              placeholder="Search by name or index  e.g. velocity, 6064, 0x6041"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          {loading && <div style={s.muted}>Searching...</div>}
          {!loading && results.length === 0 && query && (
            <div style={s.muted}>No matches for "{query}"</div>
          )}
          {results.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    {['Index', 'Name', 'Unit', ''].map((h) => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...s.td, ...s.mono, color: 'var(--accent-blue)', whiteSpace: 'nowrap' as const }}>
                        {r.index}{r.subindex > 0 ? `:${r.subindex}` : ''}
                      </td>
                      <td style={{
                        ...s.td, maxWidth: 150,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                      }}>
                        {r.name}
                      </td>
                      <td style={{ ...s.td, color: 'var(--text-muted)', whiteSpace: 'nowrap' as const }}>
                        {r.unit || '--'}
                      </td>
                      <td style={s.td}>
                        <button className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10, padding: '1px 6px' }}
                          onClick={() => onSelect(r.index, r.subindex)}>
                          Read
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Export / Read All Node Objects ────────────────────────────────────────────

// Mirrors _EXPORT_OBJECTS in routers/canopen.py exactly
const EXPORT_OBJECTS = [
  { index: '0x1008', sub: 0,  name: 'Manufacturer Device Name' },
  { index: '0x1018', sub: 1,  name: 'Identity: Vendor ID' },
  { index: '0x1018', sub: 2,  name: 'Identity: Product Code' },
  { index: '0x1018', sub: 3,  name: 'Identity: Revision Number' },
  { index: '0x1018', sub: 4,  name: 'Identity: Serial Number' },
  { index: '0x1009', sub: 0,  name: 'Manufacturer Hardware Version' },
  { index: '0x100A', sub: 0,  name: 'Manufacturer Software Version' },
  { index: '0x6041', sub: 0,  name: 'Statusword' },
  { index: '0x6061', sub: 0,  name: 'Modes of Operation Display' },
  { index: '0x6064', sub: 0,  name: 'Position Actual Value' },
  { index: '0x606C', sub: 0,  name: 'Velocity Actual Value' },
  { index: '0x6081', sub: 0,  name: 'Profile Velocity' },
  { index: '0x6083', sub: 0,  name: 'Profile Acceleration' },
  { index: '0x6084', sub: 0,  name: 'Profile Deceleration' },
  { index: '0x1017', sub: 0,  name: 'Producer Heartbeat Time' },
];

function ExportPanel({ nodes }: { nodes: CANopenNode[] }) {
  const [open,   setOpen]   = useState(false);
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy(true); setResult(null);
    try {
      const res  = await fetch('/canopen/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_ids: [] }),
      });
      const data = await res.json();
      setResult(data.ok
        ? `Sent ${data.reads_sent} SDO reads to ${data.nodes.length} node(s). Check SDO log for values.`
        : `Error: ${data.detail}`);
    } catch { setResult('Request failed'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ ...s.muted, marginBottom: 6 }}>
        Sends SDO read requests for {EXPORT_OBJECTS.length} standard objects to each of the {nodes.length} discovered
        node(s). Responses appear in the SDO log above.{' '}
        <span
          style={{ color: 'var(--accent-blue)', cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'hide list' : 'what gets read?'}
        </span>
      </div>

      {open && (
        <div style={{
          marginBottom: 8, padding: '8px 10px', borderRadius: 5,
          background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
          fontSize: 11, lineHeight: 1.9,
        }}>
          {EXPORT_OBJECTS.map((o) => (
            <div key={`${o.index}:${o.sub}`} style={{ display: 'flex', gap: 12 }}>
              <span style={{ ...s.mono, color: 'var(--accent-blue)', width: 80, flexShrink: 0 }}>
                {o.index}:{o.sub}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{o.name}</span>
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={busy}>
        {busy ? 'Reading...' : `Read all nodes (${nodes.length})`}
      </button>
      {result && (
        <div style={{ ...(result.startsWith('Error') ? s.resultErr : s.resultOk), marginTop: 4 }}>
          {result}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CANopenPanel() {
  const mode             = useCANopenStore((x) => x.mode);
  const autoDetected     = useCANopenStore((x) => x.autoDetected);
  const nodes            = useCANopenStore((x) => x.nodes);
  const recentSdo        = useCANopenStore((x) => x.recentSdo);
  const recentEmcy       = useCANopenStore((x) => x.recentEmcy);
  const syncCount        = useCANopenStore((x) => x.syncCount);
  const lastSyncS        = useCANopenStore((x) => x.lastSyncS);
  const updateFromStatus = useCANopenStore((x) => x.updateFromStatus);
  const setMode          = useCANopenStore((x) => x.setMode);
  const isOn = mode === 'on';

  const [sdoPrefillIndex, setSdoPrefillIndex] = useState<string | undefined>();
  const [sdoPrefillSub,   setSdoPrefillSub]   = useState<number | undefined>();

  const fetchStatus = async () => {
    try {
      const res  = await fetch('/canopen/status');
      if (!res.ok) return;
      const data = await res.json();
      updateFromStatus({
        mode:                data.mode,
        autoDetected:        data.auto_detected,
        edsLoaded:           data.eds_loaded,
        edsFilename:         data.eds_filename,
        canopenLibAvailable: data.canopen_lib,
        nodes:               data.nodes,
        recentSdo:           data.recent_sdo,
        recentEmcy:          data.recent_emcy,
        nmtLog:              data.nmt_log,
        syncCount:           data.sync_count,
        lastSyncS:           data.last_sync_s,
      });
    } catch { /* backend not reachable */ }
  };

  useEffect(() => { fetchStatus(); }, []);
  useEffect(() => {
    // Always poll -- panel is permanently mounted in the right column
    const t = setInterval(fetchStatus, 2000);
    return () => clearInterval(t);
  }, []);

  // Detect whether any discovered node has CiA 402 data
  const has402Nodes = nodes.some((n) => n.cia402_state != null);

  return (
    <div style={s.root}>

      {/* Mode toggle */}
      <div style={s.modeRow}>
        <div>
          <div style={s.modeLabel}>
            CANopen Decoder
            {isOn && <span style={s.activeChip}>Active</span>}
          </div>
          <div style={s.modeSub}>CiA 301 passive decode + CiA 402 drive state</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {autoDetected && !isOn && (
            <span style={s.detectedBadge} title="11-bit CAN IDs in CANopen COB-ID range detected">
              CANopen traffic detected
            </span>
          )}
          <button
            className={isOn ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm'}
            onClick={() => setMode(isOn ? 'off' : 'on')}
          >
            {isOn ? 'Disable' : 'Enable Decoder'}
          </button>
        </div>
      </div>

      {isOn && (
        <>
          {/* SYNC strip */}
          {syncCount > 0 && (
            <div style={{ ...s.muted, marginTop: 6, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
              SYNC: {syncCount.toLocaleString()} frames
              {lastSyncS !== null && ` -- last ${relTime(lastSyncS)}`}
            </div>
          )}

          {/* 1. NODES */}
          <div style={s.sectionHead}>
            Nodes
            {nodes.length > 0 && <span style={s.badge}>{nodes.length}</span>}
          </div>
          <NodeTable nodes={nodes} />

          {/* 2. CiA 402 DRIVE CONTROL -- only when drive nodes found */}
          {(has402Nodes || nodes.length > 0) && (
            <>
              <div style={s.sectionHead}>CiA 402 Drive Control</div>
              <DriveControlPanel nodes={nodes} />
            </>
          )}

          {/* 3. EMCY -- only when faults exist */}
          {recentEmcy.length > 0 && (
            <>
              <div style={s.sectionHead}>
                <span style={{ color: 'var(--accent-red)' }}>EMCY Events</span>
                <span style={{ ...s.badge, color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}>
                  {recentEmcy.length}
                </span>
              </div>
              <EmcyLog records={recentEmcy} />
            </>
          )}

          {/* 4. SDO LOG */}
          <div style={s.sectionHead}>
            SDO Log
            {recentSdo.length > 0 && (
              <>
                <span style={s.badge}>{recentSdo.length}</span>
                <span style={{ ...s.muted, fontWeight: 400, textTransform: 'none' as const, letterSpacing: 0 }}>
                  auto-populated from bus traffic
                </span>
              </>
            )}
          </div>
          <SdoLog records={recentSdo} />

          {/* 5. SDO READ */}
          <div style={s.sectionHead}>SDO Read</div>
          <SdoReadPanel prefillIndex={sdoPrefillIndex} prefillSub={sdoPrefillSub} />

          {/* 6. SDO WRITE */}
          <div style={s.sectionHead}>SDO Write</div>
          <SdoWritePanel />

          {/* 7. NMT */}
          <div style={s.sectionHead}>NMT Commands</div>
          <NmtPanel nodes={nodes} />

          {/* 8. OBJECT DICTIONARY -- collapsible */}
          <ObjectDictionaryBrowser
            onSelect={(idx, sub) => { setSdoPrefillIndex(idx); setSdoPrefillSub(sub); }}
          />

          {/* 9. READ ALL NODE OBJECTS */}
          {nodes.length > 0 && (
            <>
              <div style={s.sectionHead}>Read All Node Objects</div>
              <ExportPanel nodes={nodes} />
            </>
          )}

          {/* 10. EDS */}
          <EdsSection />
        </>
      )}
    </div>
  );
}
