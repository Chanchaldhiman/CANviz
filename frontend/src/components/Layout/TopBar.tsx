import { useConnectionStore } from '../../store/connectionStore';
import { useStatsStore } from '../../store/statsStore';
import { useThemeStore } from '../../store/themeStore';

const STATUS_LABELS: Record<string, string> = {
  idle:          'DISCONNECTED',
  connecting:    'CONNECTING',
  connected:     'LIVE',
  disconnecting: 'DISCONNECTING',
  error:         'ERROR',
};

// Sun icon (light mode) and Moon icon (dark mode) as inline SVG
function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1"  x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1"  y1="12" x2="3"  y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36" />
      <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function TopBar() {
  const status    = useConnectionStore((s) => s.status);
  const config    = useConnectionStore((s) => s.config);
  const stats     = useStatsStore((s) => s.stats);
  const { theme, toggle } = useThemeStore();

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

            {/* Error frames - with slcan caveat tooltip */}
            <div style={styles.stat} title={
              isSlcan
                ? 'slcan firmware typically does not forward error frames to the host - this count will read 0% even on a degraded bus. Use gs_usb (Candlelight) for accurate error frame visibility.'
                : `${stats.error_pct.toFixed(2)}% of received frames`
            }>
              <span
                style={{
                  ...styles.statVal,
                  color: stats.error_frames > 0 && !isSlcan
                    ? 'var(--accent-red)'
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
                  <span style={{ ...styles.statVal, color: 'var(--accent-red)' }} className="mono">
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

        <Divider />

        {/* Theme toggle */}
        <button
          className="theme-toggle"
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
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
          color: highlight ? 'var(--accent-amber)' : 'var(--accent-green)',
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
