/**
 * CANopenPanel.tsx
 * ----------------
 * CANopen decoder panel (CiA 301 + CiA 402) -- v1.
 *
 * Design principle: progressive disclosure.
 *   - Before enable: just the toggle (+ detected badge if traffic seen)
 *   - After enable, no nodes: helpful empty state only
 *   - EMCY section only appears when there are faults
 *   - EDS upload tucked as a collapsible at the bottom -- not front and center
 *   - CiA 402 drive state shown inline in node table, not as a separate section
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
  if (state === 'Operation Enabled') return 'var(--accent-green)';
  if (state.includes('Fault'))       return 'var(--accent-red)';
  if (state === 'Quick Stop Active') return 'var(--accent-amber)';
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
  th:    { padding: '4px 6px', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' as const, color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 },
  td:    { padding: '3px 6px', borderBottom: '1px solid var(--border-subtle)' },

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

  confirmRow: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, marginTop: 6, color: 'var(--accent-amber)',
  },

  faultBadge: {
    fontSize: 10, fontWeight: 700, color: 'var(--accent-red)',
    background: 'rgba(220,50,50,0.12)', border: '1px solid var(--accent-red)',
    borderRadius: 3, padding: '1px 5px', marginLeft: 6,
  },

  edsToggle: {
    fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer',
    marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
    userSelect: 'none' as const,
  },
  edsChip: {
    fontSize: 11, fontWeight: 600,
    background: 'rgba(0,200,100,0.10)', color: 'var(--accent-green)',
    border: '1px solid var(--accent-green)', borderRadius: 4, padding: '2px 8px',
  },
  edsRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    marginTop: 6, flexWrap: 'wrap' as const,
  },
};

// ── EDS upload (collapsible, below the fold) ──────────────────────────────────

function EdsSection() {
  const edsLoaded   = useCANopenStore((s) => s.edsLoaded);
  const edsFilename = useCANopenStore((s) => s.edsFilename);
  const canopenLib  = useCANopenStore((s) => s.canopenLibAvailable);
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
            Device EDS / DCF File
            {edsLoaded && <span style={{ ...s.edsChip, marginLeft: 8 }}>{edsFilename}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {edsLoaded
              ? 'PDO signal decode enabled for vendor-specific objects.'
              : 'Optional -- enables named PDO signals for device-specific objects. Standard CiA 301/402 objects (Statusword, Target Velocity etc) are always named without EDS.'}
          </div>
          {!canopenLib && !edsLoaded && (
            <div style={{ fontSize: 10, color: 'var(--accent-amber)', marginTop: 2 }}>
              pip install canopen required for full PDO signal decode
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
              <label htmlFor="canopen-eds-input" className="btn btn-primary btn-sm" style={{ cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
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
            {/* CiA 402 drive state shown inline -- no separate section needed */}
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

// ── SDO read ──────────────────────────────────────────────────────────────────

function SdoReadPanel() {
  const [nodeId,   setNodeId]   = useState('1');
  const [index,    setIndex]    = useState('0x1008');
  const [subindex, setSubindex] = useState('0');
  const [result,   setResult]   = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

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
      setResult(data.ok ? 'Sent -- response appears in SDO log below.' : `Error: ${data.detail}`);
    } catch { setResult('Request failed'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={s.inputRow}>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Node ID</span>
          <input style={s.input} value={nodeId} onChange={(e) => setNodeId(e.target.value)} placeholder="1" />
        </div>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Index</span>
          <input style={s.inputWide} value={index} onChange={(e) => setIndex(e.target.value)} placeholder="0x1008" />
        </div>
        <div style={s.inputGroup}>
          <span style={s.inputLabel}>Sub</span>
          <input style={{ ...s.input, width: 50 }} value={subindex} onChange={(e) => setSubindex(e.target.value)} placeholder="0" />
        </div>
        <button className="btn btn-primary btn-sm" onClick={send} disabled={busy} style={{ alignSelf: 'flex-end' }}>
          {busy ? '...' : 'Read'}
        </button>
      </div>
      {result && <div style={result.startsWith('Error') ? s.resultErr : s.resultOk}>{result}</div>}
    </div>
  );
}

// ── SDO log ───────────────────────────────────────────────────────────────────

function SdoLog({ records }: { records: SdoTransaction[] }) {
  if (records.length === 0) {
    return <div style={s.muted}>SDO request/response pairs appear here when observed or sent.</div>;
  }

  return (
    <div style={{ maxHeight: 150, overflowY: 'auto' }}>
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
              <td style={{ ...s.td, color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
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

// ── EMCY log (only shown when faults exist) ────────────────────────────────────

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

  const handleClick = (cmdValue: number) => {
    setPending((prev) => prev === cmdValue ? null : cmdValue);
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
      {/* 5 command buttons */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
        {NMT_CMDS.map((cmd) => {
          const isSelected = pending === cmd.value;
          return (
            <button
              key={cmd.value}
              onClick={() => handleClick(cmd.value)}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                borderRadius: 5, border: `1px solid ${cmd.color}`,
                background: isSelected ? cmd.color : 'transparent',
                color: isSelected ? '#111' : cmd.color,
                cursor: 'pointer', transition: 'all 0.12s',
              }}
            >
              {cmd.label}
            </button>
          );
        })}
      </div>

      {/* Inline confirm strip -- appears after clicking a button */}
      {pending !== null && pendingCmd && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
          padding: '7px 10px', borderRadius: 5,
          background: 'var(--bg-input)',
          border: `1px solid ${pendingCmd.color}`,
          flexWrap: 'wrap' as const,
        }}>
          <span style={{ fontSize: 12, color: pendingCmd.color, fontWeight: 600 }}>
            {pendingCmd.label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
          <select
            style={s.select}
            value={target}
            onChange={(e) => setTarget(parseInt(e.target.value))}
          >
            <option value={0}>All nodes (broadcast)</option>
            {nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>
                Node {n.node_id_hex} ({n.nmt_state})
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            style={{ background: pendingCmd.color, color: '#111', fontWeight: 700, border: 'none', opacity: busy ? 0.6 : 1 }}
            onClick={handleSend}
            disabled={busy}
          >
            {busy ? 'Sending...' : 'Send'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setPending(null); setResult(null); }}>
            Cancel
          </button>
        </div>
      )}

      {result && <div style={result.startsWith('Error') ? s.resultErr : s.resultOk}>{result}</div>}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CANopenPanel() {
  const mode             = useCANopenStore((s) => s.mode);
  const autoDetected     = useCANopenStore((s) => s.autoDetected);
  const nodes            = useCANopenStore((s) => s.nodes);
  const recentSdo        = useCANopenStore((s) => s.recentSdo);
  const recentEmcy       = useCANopenStore((s) => s.recentEmcy);
  const syncCount        = useCANopenStore((s) => s.syncCount);
  const lastSyncS        = useCANopenStore((s) => s.lastSyncS);
  const updateFromStatus = useCANopenStore((s) => s.updateFromStatus);
  const setMode          = useCANopenStore((s) => s.setMode);
  const isOn = mode === 'on';

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
    if (!isOn) return;
    const t = setInterval(fetchStatus, 2000);
    return () => clearInterval(t);
  }, [isOn]);

  return (
    <div style={s.root}>

      {/* Toggle row */}
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
          {/* SYNC strip -- only when SYNC frames are present */}
          {syncCount > 0 && (
            <div style={{ ...s.muted, marginTop: 6, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
              SYNC: {syncCount.toLocaleString()} frames
              {lastSyncS !== null && ` -- last ${relTime(lastSyncS)}`}
            </div>
          )}

          {/* Nodes */}
          <div style={s.sectionHead}>
            Nodes
            {nodes.length > 0 && <span style={s.badge}>{nodes.length}</span>}
          </div>
          <NodeTable nodes={nodes} />

          {/* EMCY -- only when faults exist */}
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

          {/* SDO read */}
          <div style={s.sectionHead}>SDO Read</div>
          <SdoReadPanel />

          {/* SDO log */}
          <div style={s.sectionHead}>
            SDO Log
            {recentSdo.length > 0 && <span style={s.badge}>{recentSdo.length}</span>}
          </div>
          <SdoLog records={recentSdo} />

          {/* NMT */}
          <div style={s.sectionHead}>NMT Commands</div>
          <NmtPanel nodes={nodes} />

          {/* EDS -- collapsible, at the bottom */}
          <EdsSection />
        </>
      )}
    </div>
  );
}
