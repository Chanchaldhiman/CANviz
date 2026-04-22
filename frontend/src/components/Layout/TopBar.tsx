import { useConnectionStore } from '../../store/connectionStore';
import { useStatsStore } from '../../store/statsStore';

const STATUS_LABELS: Record<string, string> = {
  idle:          'DISCONNECTED',
  connecting:    'CONNECTING',
  connected:     'LIVE',
  disconnecting: 'DISCONNECTING',
  error:         'ERROR',
};

export function TopBar() {
  const status    = useConnectionStore((s) => s.status);
  const config    = useConnectionStore((s) => s.config);
  const stats     = useStatsStore((s) => s.stats);

  const statusLabel = STATUS_LABELS[status] ?? status.toUpperCase();
  const isLive      = status === 'connected';
  const isSlcan     = config.interface === 'slcan';

  return (
    <div className="app-topbar" style={styles.bar}>

      {/* Logo */}
      <div style={styles.logo}>
        <span style={styles.logoCanvas}>CAN</span>
        <span style={styles.logoVas}>viz</span>
      </div>

      {/* Connection info */}
      <div style={styles.center}>
        {isLive && (
          <span style={styles.ifaceTag} className="mono text-xs">
            {config.interface.toUpperCase()}
            {config.interface === 'slcan'     && config.channel ? ` · ${config.channel}` : ''}
            {config.interface === 'socketcan' && config.channel ? ` · ${config.channel}` : ''}
            {config.interface === 'gs_usb'  ? ` · idx:${config.index ?? 0}` : ''}
            {` · ${(config.bitrate / 1000).toFixed(0)}k`}
          </span>
        )}
      </div>

      {/* Stats */}
      <div style={styles.right}>
        {isLive && (
          <>
            {/* Rx frames */}
            <StatCell value={stats.frames_rx.toLocaleString()} unit="rx" />
            <Divider />

            {/* Tx frames */}
            <StatCell value={stats.frames_tx.toLocaleString()} unit="tx" />
            <Divider />

            {/* FPS */}
            <StatCell value={stats.fps.toFixed(1)} unit="fps" />
            <Divider />

            {/* Bus load */}
            <StatCell
              value={stats.bus_load_pct.toFixed(1) + '%'}
              unit="load"
              highlight={stats.bus_load_pct > 80}
            />
            <Divider />

            {/* Error frames — with slcan caveat tooltip */}
            <div style={styles.stat} title={
              isSlcan
                ? 'slcan firmware typically does not forward error frames to the host — this count will read 0% even on a degraded bus. Use gs_usb (Candlelight) for accurate error frame visibility.'
                : `${stats.error_pct.toFixed(2)}% of received frames`
            }>
              <span
                style={{
                  ...styles.statVal,
                  color: stats.error_frames > 0 && !isSlcan
                    ? 'var(--accent-red, #f87171)'
                    : 'var(--accent-green)',
                }}
                className="mono"
              >
                {stats.error_frames}
              </span>
              <span style={styles.statUnit}>
                err{isSlcan ? ' ⚠' : ''}
              </span>
            </div>
            <Divider />

            {/* Bus-off events */}
            {stats.bus_off_events > 0 && (
              <>
                <div style={styles.stat} title="Bus-off: the CAN controller has shut down TX due to excessive errors">
                  <span style={{ ...styles.statVal, color: 'var(--accent-red, #f87171)' }} className="mono">
                    {stats.bus_off_events}
                  </span>
                  <span style={styles.statUnit}>bus-off</span>
                </div>
                <Divider />
              </>
            )}
          </>
        )}

        {/* Status pill */}
        <div style={styles.statusPill} data-status={status}>
          <span className={`status-dot ${status}`} />
          <span style={styles.statusText}>{statusLabel}</span>
        </div>
      </div>
    </div>
  );
}

function StatCell({
  value,
  unit,
  highlight = false,
}: {
  value: string;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div style={styles.stat}>
      <span
        style={{
          ...styles.statVal,
          color: highlight ? 'var(--accent-amber, #fbbf24)' : 'var(--accent-green)',
        }}
        className="mono"
      >
        {value}
      </span>
      <span style={styles.statUnit}>{unit}</span>
    </div>
  );
}

function Divider() {
  return <div style={styles.statDivider} />;
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 14px',
    borderBottom: '1px solid var(--border-subtle)',
    background: 'var(--bg-panel)',
    gap: 12,
  },
  logo: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    fontSize: 16,
    letterSpacing: '-0.02em',
    flexShrink: 0,
  },
  logoCanvas: { color: 'var(--accent-green)' },
  logoVas:    { color: 'var(--text-secondary)' },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  ifaceTag: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 8px',
    color: 'var(--text-secondary)',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  stat: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
    cursor: 'default',
  },
  statVal: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--accent-green)',
    minWidth: 36,
    textAlign: 'right',
  },
  statUnit: {
    fontSize: 10,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  statDivider: {
    width: 1,
    height: 16,
    background: 'var(--border-subtle)',
  },
  statusPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 8px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-secondary)',
  },
};