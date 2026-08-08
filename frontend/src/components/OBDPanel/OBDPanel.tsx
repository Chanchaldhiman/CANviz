import { useEffect, useState } from 'react';
import { useOBDStore } from '../../store/obdStore';
import type { LivePidValue } from '../../store/obdStore';

// ── Sub-components ────────────────────────────────────────────────────────────

function ModeToggle() {
  const mode      = useOBDStore((s) => s.mode);
  const setMode   = useOBDStore((s) => s.setMode);
  const dataStalled = useOBDStore((s) => s.dataStalled);
  const isOn      = mode === 'on';

  return (
    <div style={s.modeRow}>
      <div>
        <div style={s.modeLabel}>
          OBD-II (Mode 01)
          {isOn && !dataStalled && <span style={s.activeChip}>● Active</span>}
          {isOn && dataStalled && <span style={s.stalledChip}>● Not receiving data</span>}
        </div>
        <div style={s.modeSub}>Live PIDs over raw CAN -- no ELM327 required</div>
      </div>
      <button
        onClick={() => setMode(isOn ? 'off' : 'on')}
        className={isOn ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm'}
      >
        {isOn ? 'Disable' : 'Enable'}
      </button>
    </div>
  );
}

function MonitorStatusBar() {
  const mode = useOBDStore((s) => s.mode);
  const supported = useOBDStore((s) => s.monitorStatusSupported);
  const status = useOBDStore((s) => s.monitorStatus);

  if (mode !== 'on' || !supported) return null;

  const milOn = status?.mil_on ?? false;

  return (
    <div style={s.monitorBar}>
      <div style={s.monitorLeft}>
        <span style={milOn ? s.milDotOn : s.milDotOff} />
        <span style={{ fontWeight: 600, fontSize: 12, color: milOn ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
          {milOn ? 'Check Engine Light: ON' : 'Check Engine Light: Off'}
        </span>
      </div>
      <div style={s.monitorRight}>
        {status ? `${status.dtc_count} DTC${status.dtc_count === 1 ? '' : 's'} stored` : 'Reading\u2026'}
      </div>
    </div>
  );
}

function ScanSummary() {
  const scanning = useOBDStore((s) => s.scanning);
  const lastScanCount = useOBDStore((s) => s.lastScanCount);
  const knownCount = useOBDStore((s) => s.knownPids.length);
  const addressing = useOBDStore((s) => s.addressing);

  if (scanning) {
    return <div style={s.scanSummary}>Scanning the vehicle for supported PIDs (trying 11-bit and 29-bit addressing)…</div>;
  }
  if (lastScanCount === null) return null;
  if (lastScanCount === 0) {
    return (
      <div style={{ ...s.scanSummary, ...s.scanSummaryWarn }}>
        No response from any known PID on either 11-bit or 29-bit addressing. Check the
        connection -- the OBD-II connector is fully seated, the adapter is connected, and
        ignition is on -- then Rescan.
      </div>
    );
  }
  return (
    <div style={{ ...s.scanSummary, ...s.scanSummaryOk }}>
      Data available -- {lastScanCount} of {knownCount} known PIDs detected
      {addressing ? ` (${addressing} addressing)` : ''}. Use the dropdown below to add any to
      the live view.
    </div>
  );
}

// Fixed display order so the dropdown reads the same way every time,
// rather than shuffling with whatever order objects happen to iterate in.
const CATEGORY_ORDER = ['Engine', 'Fuel & Air', 'Temperatures', 'O2 Sensors', 'Emissions', 'Vehicle & Trip', 'Other'];

function PidPicker() {
  const mode          = useOBDStore((s) => s.mode);
  const scanning       = useOBDStore((s) => s.scanning);
  const scan            = useOBDStore((s) => s.scan);
  const supportedPids   = useOBDStore((s) => s.supportedPids);
  const lastScanCount   = useOBDStore((s) => s.lastScanCount);
  const knownPids       = useOBDStore((s) => s.knownPids);
  const watchedPids     = useOBDStore((s) => s.watchedPids);
  const setWatched      = useOBDStore((s) => s.setWatched);

  if (mode !== 'on') return null;

  // A scan having *run* (even if it found nothing) is what unlocks the
  // "supported" state -- supportedPids.length alone can't tell "never
  // scanned yet" apart from "scanned and found zero".
  const hasScanned = lastScanCount !== null;

  const addPid = (pidStr: string) => {
    const pid = Number(pidStr);
    if (!pid || watchedPids.includes(pid)) return;
    setWatched([...watchedPids, pid]);
  };

  const unwatched = knownPids.filter((k) => !watchedPids.includes(k.pid));
  const byCategory = new Map<string, typeof unwatched>();
  for (const k of unwatched) {
    const list = byCategory.get(k.category) ?? [];
    list.push(k);
    byCategory.set(k.category, list);
  }
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div style={s.scanBlock}>
      <div style={s.scanRow}>
        <button className="btn btn-ghost btn-sm" onClick={() => scan()} disabled={scanning}>
          {scanning ? 'Scanning\u2026' : hasScanned ? 'Rescan' : 'Scan Supported PIDs'}
        </button>
        <select
          value=""
          onChange={(e) => { if (e.target.value) addPid(e.target.value); }}
          style={s.addSelect}
        >
          <option value="">
            {!hasScanned ? '+ add PID (scan first to see what\u2019s available)' : '+ add PID to live view'}
          </option>
          {orderedCategories.map((cat) => (
            <optgroup key={cat} label={cat}>
              {byCategory.get(cat)!.map((k) => {
                const isSupported = hasScanned && supportedPids.includes(k.pid);
                return (
                  <option
                    key={k.pid}
                    value={k.pid}
                    disabled={!isSupported}
                    style={{ color: isSupported ? 'var(--accent-green)' : undefined }}
                  >
                    {isSupported
                      ? `\u2713 ${k.name} (${k.unit})`
                      : `${k.name} (${k.unit}) - not sent by this vehicle`}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}

function LiveTable({ values }: { values: LivePidValue[] }) {
  const scanning = useOBDStore((s) => s.scanning);
  const supportedPids = useOBDStore((s) => s.supportedPids);
  const watchedPids = useOBDStore((s) => s.watchedPids);
  const setWatched = useOBDStore((s) => s.setWatched);

  const removePid = (pid: number) => {
    setWatched(watchedPids.filter((p) => p !== pid));
  };

  if (values.length === 0) {
    return (
      <div style={{ ...s.empty, textAlign: 'left' as const }}>
        {scanning ? (
          <div>Scanning the vehicle for supported PIDs…</div>
        ) : supportedPids.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            The last scan found no supported PIDs. Check the vehicle is powered and the
            connector is fully seated, then click Rescan above.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 6 }}>Nothing selected right now.</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Use the dropdown above to add a PID here.
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <table style={s.table}>
      <thead>
        <tr>
          {['PID', 'Value', 'Unit', ''].map((h) => (
            <th key={h} style={s.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {values.map((v) => (
          <tr key={v.pid} style={s.tr}>
            <td style={s.td}>{v.name}</td>
            <td style={{ ...s.td, ...s.mono, color: v.stale ? 'var(--text-muted)' : 'var(--accent-green)' }}>
              {v.value !== undefined ? v.value : '-'}
              {v.stale ? ' (stale)' : ''}
            </td>
            <td style={{ ...s.td, color: 'var(--text-muted)' }}>{v.unit}</td>
            <td style={{ ...s.td, width: 20 }}>
              <button onClick={() => removePid(v.pid)} style={s.removeBtn} title={`Remove ${v.name}`}>×</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function OBDPanel() {
  const mode           = useOBDStore((s) => s.mode);
  const liveValues     = useOBDStore((s) => s.liveValues);
  const lastError      = useOBDStore((s) => s.lastError);
  const dataStalled    = useOBDStore((s) => s.dataStalled);
  const monitorStatusSupported = useOBDStore((s) => s.monitorStatusSupported);
  const updateFromStatus = useOBDStore((s) => s.updateFromStatus);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/obd/status');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        updateFromStatus(data);
        setLoaded(true);
      } catch {
        // network hiccup -- next tick will retry
      }
    };

    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [updateFromStatus]);

  return (
    <div style={s.root}>
      <ModeToggle />
      <MonitorStatusBar />

      {mode === 'off' ? (
        <div style={s.offState}>
          <div style={s.offIcon}>⛽</div>
          <div style={s.offText}>
            Reads standard Mode 01 PIDs (RPM, speed, coolant temp, throttle, MAF, fuel trim, O2,
            and dozens more) directly over raw CAN via ISO 15765-4 -- no ELM327 adapter needed.
            Works over both 11-bit and 29-bit addressing, auto-detected. Enabling scans
            automatically -- add any supported PID to the live view from the dropdown.
          </div>
          <div style={s.offHint}>Connect to the vehicle&apos;s OBD-II port, then enable above.</div>
        </div>
      ) : (
        <>
          {monitorStatusSupported && <div style={s.divider} />}
          <ScanSummary />
          <PidPicker />
          {lastError && (
            <div style={dataStalled ? s.warnBanner : s.errorBanner}>{lastError}</div>
          )}
          <LiveTable values={liveValues} />
          {!loaded && <div style={s.scanHint}>Loading status…</div>}
        </>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 0, height: '100%' },
  modeRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0 10px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 10,
  },
  modeLabel: { fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' },
  modeSub: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  monitorBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', marginBottom: 4, borderRadius: 4, background: 'var(--bg-elevated)',
  },
  monitorLeft: { display: 'flex', alignItems: 'center', gap: 6 },
  monitorRight: { fontSize: 11, color: 'var(--text-muted)' },
  milDotOn: {
    width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
    background: 'var(--accent-red)', boxShadow: '0 0 4px var(--accent-red)',
  },
  milDotOff: {
    width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
    background: 'var(--accent-green)',
  },
  divider: { borderTop: '1px solid var(--border-subtle)', margin: '4px 0 10px' },
  activeChip: {
    marginLeft: 8, fontSize: 10, fontWeight: 600, color: 'var(--accent-green)',
    background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)',
    borderRadius: 3, padding: '1px 6px', letterSpacing: '0.04em',
  },
  stalledChip: {
    marginLeft: 8, fontSize: 10, fontWeight: 600, color: 'var(--accent-amber)',
    background: 'var(--accent-amber-dim)', border: '1px solid var(--accent-amber)',
    borderRadius: 3, padding: '1px 6px', letterSpacing: '0.04em',
  },
  scanSummary: {
    fontSize: 11, borderRadius: 4, padding: '6px 10px', marginBottom: 10, lineHeight: 1.5,
  },
  scanSummaryOk: {
    color: 'var(--accent-green)', background: 'var(--accent-green-dim)', border: '1px solid var(--accent-green)',
  },
  scanSummaryWarn: {
    color: 'var(--accent-amber)', background: 'var(--accent-amber-dim)',
    border: '1px solid var(--accent-amber)',
  },
  offState: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    flex: 1, gap: 8, padding: '24px 16px', textAlign: 'center',
  },
  offIcon: { fontSize: 32, color: 'var(--text-muted)', lineHeight: 1 },
  offText: { fontSize: 12, color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.5 },
  offHint: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  scanBlock: { marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  scanRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  scanHint: { fontSize: 11, color: 'var(--text-muted)' },
  addSelect: {
    background: 'var(--bg-panel)', color: 'var(--text-secondary)',
    border: '1px dashed var(--border-strong)', borderRadius: 4,
    padding: '4px 8px', fontSize: 11, fontFamily: 'var(--font-mono, monospace)',
    cursor: 'pointer', maxWidth: 260,
  },
  removeBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px',
  },
  errorBanner: {
    fontSize: 11, color: 'var(--accent-red)', background: 'var(--accent-red-dim)',
    border: '1px solid var(--accent-red)', borderRadius: 4, padding: '6px 10px', marginBottom: 8,
  },
  warnBanner: {
    fontSize: 11, color: 'var(--accent-amber)', background: 'var(--accent-amber-dim)',
    border: '1px solid var(--accent-amber)', borderRadius: 4, padding: '6px 10px', marginBottom: 8,
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: {
    textAlign: 'left' as const, padding: '4px 8px', fontSize: 10, fontWeight: 600,
    letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border-subtle)',
  },
  tr: { borderBottom: '1px solid var(--border-subtle)' },
  td: { padding: '5px 8px' },
  mono: { fontFamily: 'var(--font-mono, monospace)' },
  empty: { padding: '16px 4px', color: 'var(--text-muted)', fontSize: 12 },
};
