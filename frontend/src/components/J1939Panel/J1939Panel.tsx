import { useEffect, useState } from 'react';
import { useJ1939Store } from '../../store/j1939Store';
import type { SARecord, BamRecord, Dm1Fault } from '../../store/j1939Store';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(secs: number): string {
  if (secs < 2)   return 'just now';
  if (secs < 60)  return `${Math.round(secs)}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModeToggle() {
  const mode         = useJ1939Store((s) => s.mode);
  const autoDetected = useJ1939Store((s) => s.autoDetected);
  const setMode      = useJ1939Store((s) => s.setMode);
  const pgnDbSize    = useJ1939Store((s) => s.pgnDbSize);
  const hasPretty    = useJ1939Store((s) => s.hasPrettyJ1939);
  const isOn         = mode === 'on';

  return (
    <div style={s.modeRow}>
      <div>
        <div style={s.modeLabel}>
          J1939 Decoder
          {isOn && (
            <span style={s.activeChip}>● Active</span>
          )}
        </div>
        <div style={s.modeSub}>
          {pgnDbSize > 0
            ? `${pgnDbSize} PGN definitions${hasPretty ? ' (pretty_j1939)' : ' (built-in fallback)'}`
            : 'Fetching PGN database size…'}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Auto-detect badge - shown when traffic seen but decoder is off */}
        {autoDetected && !isOn && (
          <span style={s.detectedBadge} title="29-bit extended-ID frames detected - likely J1939 traffic">
            J1939 traffic detected
          </span>
        )}

        {/* Clear Enable / Disable action button */}
        <button
          onClick={() => setMode(isOn ? 'off' : 'on')}
          className={isOn ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm'}
        >
          {isOn ? 'Disable Decoder' : 'Enable Decoder'}
        </button>
      </div>
    </div>
  );
}

function SATable({ records }: { records: SARecord[] }) {
  if (records.length === 0) {
    return (
      <div style={{ ...s.empty, textAlign: 'left' as const }}>
        <div style={{ marginBottom: 6 }}>No nodes seen yet.</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-secondary)' }}>What are Nodes?</strong><br />
          Every device on a J1939 network claims a unique Source Address (SA, 0–253).
          This table shows which ECUs are actively transmitting - effectively your live
          network topology without needing a wiring diagram.
        </div>
      </div>
    );
  }

  return (
    <table style={s.table}>
      <thead>
        <tr>
          {['SA', 'Name', 'Frames', 'Last Seen'].map((h) => (
            <th key={h} style={s.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.sa} style={s.tr}>
            <td style={{ ...s.td, ...s.mono, color: 'var(--accent-green)' }}>{r.sa_hex}</td>
            <td style={s.td}>{r.sa_name}</td>
            <td style={{ ...s.td, ...s.mono }}>{r.frame_count.toLocaleString()}</td>
            <td style={{ ...s.td, color: 'var(--text-muted)' }}>{relativeTime(r.last_seen_s)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BamLog({ records }: { records: BamRecord[] }) {
  if (records.length === 0) {
    return (
      <div style={{ ...s.empty, textAlign: 'left' as const }}>
        <div style={{ marginBottom: 6 }}>No multi-packet messages reassembled yet.</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-secondary)' }}>What is the BAM Log?</strong><br />
          CAN frames are limited to 8 bytes. When J1939 needs to send more (a VIN is 17+
          characters, software version strings are longer), it uses the Broadcast Announce
          Message (BAM) transport protocol - splitting the data across multiple frames and
          reassembling them. This log shows completed multi-packet messages, with the full
          reassembled payload.
        </div>
      </div>
    );
  }

  return (
    <div style={s.bamList}>
      {records.map((r, i) => (
        <div key={i} style={s.bamRow}>
          <span style={{ ...s.mono, color: 'var(--accent-green)' }}>{r.pgn_hex}</span>
          <span style={s.bamName}>{r.pgn_name}</span>
          <span style={{ ...s.mono, color: 'var(--text-muted)', fontSize: 11 }}>
            {r.length}B
          </span>
          <span style={{ ...s.mono, color: 'var(--text-secondary)', fontSize: 11 }}>
            {r.data_hex.slice(0, 47)}{r.data_hex.length > 47 ? '…' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

// FMI code → human description (J1939 standard, 32 codes 0–31)
const FMI_DESCRIPTIONS: Record<number, string> = {
  0:  'Above normal operating range',
  1:  'Below normal operating range',
  2:  'Erratic, intermittent or incorrect',
  3:  'Voltage above normal / short to high source',
  4:  'Voltage below normal / short to low source',
  5:  'Current below normal / open circuit',
  6:  'Current above normal / short to ground',
  7:  'Mechanical system not responding properly',
  8:  'Abnormal frequency, pulse width or period',
  9:  'Abnormal update rate',
  10: 'Abnormal rate of change',
  11: 'Root cause not known',
  12: 'Bad intelligent device or component',
  13: 'Out of calibration',
  14: 'Special instructions',
  15: 'Reserved for SAE assignment',
  31: 'Condition exists (no specific failure mode)',
};

function fmiLabel(fmi: number): string {
  return FMI_DESCRIPTIONS[fmi] ?? `Code ${fmi} - see SAE J1939-73`;
}

// Lamp column definitions with full names and descriptions for tooltips
const LAMP_COLS = [
  {
    key: 'MIL',
    label: 'MIL',
    fullName: 'Malfunction Indicator Lamp',
    description: 'The "check engine" light shown to the driver. Active means the driver can see this warning on the dashboard.',
  },
  {
    key: 'RSL',
    label: 'Red Stop',
    fullName: 'Red Stop Lamp',
    description: 'Serious fault - stop the vehicle immediately. The most severe J1939 warning level.',
  },
  {
    key: 'AWL',
    label: 'Amber Warn',
    fullName: 'Amber Warning Lamp',
    description: 'Caution - service required soon but not immediately dangerous. Driver can continue operating.',
  },
  {
    key: 'Protect',
    label: 'Protect',
    fullName: 'Protect Lamp',
    description: 'Engine protection system has activated. Engine may be derated to prevent damage.',
  },
];

function Dm1Log({ faults }: { faults: Dm1Fault[] }) {
  if (faults.length === 0) {
    return (
      <div style={{ ...s.empty, textAlign: 'left' as const }}>
        <div style={{ marginBottom: 8 }}>No active DM1 fault codes detected.</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-secondary)' }}>What is DM1?</strong><br />
          DM1 (Diagnostic Message 1) is the J1939 standard for broadcasting active faults.
          ECUs transmit DM1 whenever a fault is present - it contains the SPN (what component),
          FMI (how it's failing), occurrence count, and which dashboard warning lamps are lit.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>

      {/* Legend row - explains abbreviations inline */}
      <div style={s.legendBox}>
        <span style={s.legendTitle}>Key</span>
        <span style={s.legendItem}>
          <strong>SPN</strong> Suspect Parameter Number - identifies the component
        </span>
        <span style={s.legendItem}>
          <strong>FMI</strong> Failure Mode Identifier - describes how it's failing
        </span>
        <span style={s.legendItem}>
          <strong>OC</strong> Occurrence Count - how many times detected (0–127)
        </span>
      </div>

      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th} title="Suspect Parameter Number - identifies the component that has the fault">
              SPN
            </th>
            <th style={s.th}>Component</th>
            <th style={s.th} title="Failure Mode Identifier - describes how the component is failing (0–31)">
              FMI - Failure Mode
            </th>
            <th style={s.th} title="Occurrence Count - how many times this fault has been detected since last cleared (0–127)">
              OC
            </th>
            {LAMP_COLS.map((col) => (
              <th key={col.key} style={s.th} title={`${col.fullName} - ${col.description}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {faults.map((f, i) => (
            <tr key={i} style={s.tr}>
              {/* SPN number */}
              <td style={{ ...s.td, ...s.mono, color: 'var(--accent-amber)', fontWeight: 600 }}>
                {f.spn}
              </td>

              {/* Component name + units */}
              <td style={{ ...s.td, fontSize: 11 }}>
                <span style={{ color: 'var(--text-primary)' }}>
                  {(f as any).spn_name || <span style={{ color: 'var(--text-muted)' }}>SPN {f.spn}</span>}
                </span>
                {(f as any).units
                  ? <span style={{ color: 'var(--text-muted)', marginLeft: 4, fontSize: 10 }}>
                      {(f as any).units}
                    </span>
                  : null}
              </td>

              {/* FMI with text description */}
              <td style={{ ...s.td, fontSize: 11 }}>
                <span style={{ ...s.mono, color: 'var(--text-secondary)', marginRight: 6 }}>
                  {f.fmi}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                  {fmiLabel(f.fmi)}
                </span>
              </td>

              {/* Occurrence count */}
              <td style={{ ...s.td, ...s.mono, color: 'var(--text-secondary)' }}>
                {f.oc}
              </td>

              {/* Lamp columns */}
              {LAMP_COLS.map((col) => (
                <td
                  key={col.key}
                  style={lampCell(f.lamps[col.key] ?? 'Not Available')}
                  title={`${col.fullName}: ${f.lamps[col.key] ?? 'Not Available'}`}
                >
                  {f.lamps[col.key] === 'Active'
                    ? `● ${col.fullName}`
                    : f.lamps[col.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function lampCell(state: string): React.CSSProperties {
  const color = state === 'Active'
    ? 'var(--accent-red)'
    : state === 'Not Available'
    ? 'var(--text-muted)'
    : 'var(--text-secondary)';
  return { ...s.td, color, fontSize: 11 };
}

// ── Main panel ────────────────────────────────────────────────────────────────

type SubTab = 'nodes' | 'bam' | 'dm1';

export function J1939Panel() {
  const mode        = useJ1939Store((s) => s.mode);
  const saTable     = useJ1939Store((s) => s.saTable);
  const recentBam   = useJ1939Store((s) => s.recentBam);
  const recentDm1   = useJ1939Store((s) => s.recentDm1);
  const updateFromStatus = useJ1939Store((s) => s.updateFromStatus);

  const [subTab, setSubTab] = useState<SubTab>('nodes');

  // Always fetch status once on mount to get pgnDbSize upfront
  // (avoids "Loading PGN database..." appearing until the user enables the decoder)
  useEffect(() => {
    const fetchOnce = async () => {
      try {
        const res = await fetch('/j1939/status');
        if (!res.ok) return;
        const data = await res.json();
        updateFromStatus({
          mode:              data.mode,
          autoDetected:      data.auto_detected,
          hasPrettyJ1939:    data.has_pretty_j1939,
          pgnDbSize:         data.pgn_db_size,
          saTable:           data.sa_table,
          recentBam:         data.recent_bam,
          recentDm1:         data.recent_dm1,
          activeBamSessions: data.active_bam_sessions,
        });
      } catch { /* backend not reachable */ }
    };
    fetchOnce();
  }, [updateFromStatus]);

  // Poll every 2s when mode is on to refresh SA table + BAM log + DM1
  useEffect(() => {
    if (mode !== 'on') return;
    const poll = async () => {
      try {
        const res = await fetch('/j1939/status');
        if (!res.ok) return;
        const data = await res.json();
        updateFromStatus({
          mode:              data.mode,
          autoDetected:      data.auto_detected,
          hasPrettyJ1939:    data.has_pretty_j1939,
          pgnDbSize:         data.pgn_db_size,
          saTable:           data.sa_table,
          recentBam:         data.recent_bam,
          recentDm1:         data.recent_dm1,
          activeBamSessions: data.active_bam_sessions,
        });
      } catch { /* backend not reachable */ }
    };
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [mode, updateFromStatus]);

  const SUB_TABS: { id: SubTab; label: string; count?: number }[] = [
    { id: 'nodes', label: 'Nodes',    count: saTable.length },
    { id: 'bam',   label: 'BAM Log',  count: recentBam.length },
    { id: 'dm1',   label: 'DM1 Faults', count: recentDm1.length },
  ];

  return (
    <div style={s.root}>
      {/* Mode toggle header */}
      <ModeToggle />

      {mode === 'off' ? (
        <div style={s.offState}>
          <div style={s.offIcon}>⬡</div>
          <div style={s.offText}>
            Enable the J1939 decoder to see node addresses, PGN names,
            BAM multi-packet reassembly, and DM1 active fault codes in the message table.
            You can enable it before or after connecting - decoding starts as soon as the bus is live.
          </div>
          <div style={s.bitrateNote}>
            <div style={s.bitrateTitle}>Typical J1939 bitrates</div>
            <div style={s.bitrateRow}>
              <span style={s.bitrateLabel}>Trucks / Agriculture / Marine (NMEA 2000)</span>
              <span style={s.bitrateVal}>250 kbps</span>
            </div>
            <div style={s.bitrateRow}>
              <span style={s.bitrateLabel}>J1939/14 high-speed variant</span>
              <span style={s.bitrateVal}>500 kbps</span>
            </div>
            <div style={s.bitrateRow}>
              <span style={s.bitrateLabel}>Passenger cars (OBD-II / UDS)</span>
              <span style={s.bitrateVal}>500 kbps - not J1939</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Sub-tab bar */}
          <div style={s.subTabBar}>
            {SUB_TABS.map((t) => (
              <button
                key={t.id}
                style={{
                  ...s.subTab,
                  ...(subTab === t.id ? s.subTabActive : {}),
                }}
                onClick={() => setSubTab(t.id)}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span style={s.tabCount}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={s.content}>
            {subTab === 'nodes' && <SATable records={saTable} />}
            {subTab === 'bam'   && <BamLog  records={recentBam} />}
            {subTab === 'dm1'   && <Dm1Log  faults={recentDm1} />}
          </div>
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    height: '100%',
  },
  modeRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0 10px',
    borderBottom: '1px solid var(--border-subtle)',
    marginBottom: 10,
  },
  modeLabel: {
    fontWeight: 600,
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  modeSub: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  detectedBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 3,
    background: 'var(--accent-amber-dim)',
    color: 'var(--accent-amber)',
    border: '1px solid var(--accent-amber)',
    letterSpacing: '0.04em',
  },
  offState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 8,
    padding: '24px 16px',
    textAlign: 'center',
  },
  offIcon: {
    fontSize: 32,
    color: 'var(--text-muted)',
    lineHeight: 1,
  },
  offText: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    maxWidth: 360,
    lineHeight: 1.5,
  },
  offHint: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 4,
  },
  activeChip: {
    marginLeft: 8,
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--accent-green)',
    background: 'var(--accent-green-dim)',
    border: '1px solid var(--accent-green)',
    borderRadius: 3,
    padding: '1px 6px',
    letterSpacing: '0.04em',
  },
  bitrateNote: {
    marginTop: 14,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
    padding: '10px 14px',
    width: '100%',
    maxWidth: 420,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  bitrateTitle: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted)',
    marginBottom: 2,
  },
  bitrateRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  bitrateLabel: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  bitrateVal: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap' as const,
  },
  subTabBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 10,
    borderBottom: '1px solid var(--border-subtle)',
    paddingBottom: 8,
  },
  subTab: {
    fontSize: 11,
    fontWeight: 500,
    padding: '3px 10px',
    borderRadius: 3,
    border: '1px solid var(--border-default)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
  subTabActive: {
    background: 'var(--accent-green-dim)',
    border: '1px solid var(--accent-green)',
    color: 'var(--accent-green)',
  },
  tabCount: {
    fontSize: 10,
    background: 'var(--bg-elevated)',
    borderRadius: 8,
    padding: '1px 5px',
    minWidth: 16,
    textAlign: 'center' as const,
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
  },
  th: {
    padding: '4px 8px',
    textAlign: 'left' as const,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border-subtle)',
  },
  tr: {
    borderBottom: '1px solid var(--border-subtle)',
  },
  td: {
    padding: '5px 8px',
    color: 'var(--text-primary)',
    fontSize: 12,
  },
  mono: {
    fontFamily: 'var(--font-mono)',
  },
  empty: {
    color: 'var(--text-muted)',
    fontSize: 12,
    padding: '16px 0',
    textAlign: 'center' as const,
  },
  bamList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  bamRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    padding: '4px 6px',
    borderRadius: 3,
    background: 'var(--bg-elevated)',
    fontSize: 12,
    flexWrap: 'wrap' as const,
  },
  bamName: {
    flex: 1,
    color: 'var(--text-secondary)',
    fontSize: 12,
  },
  legendBox: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px 16px',
    padding: '7px 10px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 4,
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  legendTitle: {
    fontWeight: 600,
    fontSize: 10,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted)',
    alignSelf: 'center' as const,
    marginRight: 4,
  },
  legendItem: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
};
