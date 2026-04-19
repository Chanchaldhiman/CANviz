import { useConnectionStore } from '../../store/connectionStore';
import { useFrameStore } from '../../store/frameStore';

const STATUS_LABELS: Record<string, string> = {
  idle: 'DISCONNECTED',
  connecting: 'CONNECTING',
  connected: 'LIVE',
  disconnecting: 'DISCONNECTING',
  error: 'ERROR',
};

export function TopBar() {
  const status = useConnectionStore((s) => s.status);
  const config = useConnectionStore((s) => s.config);
  const fps = useFrameStore((s) => s.framesPerSecond);
  const total = useFrameStore((s) => s.totalFramesReceived);

  const statusLabel = STATUS_LABELS[status] ?? status.toUpperCase();
  const isLive = status === 'connected';

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
            {config.interface === 'slcan' && config.channel ? ` · ${config.channel}` : ''}
            {config.interface === 'gs_usb' ? ` · idx:${config.index ?? 0}` : ''}
            {` · ${(config.bitrate / 1000).toFixed(0)}k`}
          </span>
        )}
      </div>

      {/* Stats + status */}
      <div style={styles.right}>
        {isLive && (
          <>
            <div style={styles.stat}>
              <span style={styles.statVal} className="mono">{fps}</span>
              <span style={styles.statUnit}>fps</span>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.stat}>
              <span style={styles.statVal} className="mono">
                {total.toLocaleString()}
              </span>
              <span style={styles.statUnit}>frames</span>
            </div>
            <div style={styles.statDivider} />
          </>
        )}

        <div style={styles.statusPill} data-status={status}>
          <span className={`status-dot ${status}`} />
          <span style={styles.statusText}>{statusLabel}</span>
        </div>
      </div>
    </div>
  );
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
  logoCanvas: {
    color: 'var(--accent-green)',
  },
  logoVas: {
    color: 'var(--text-secondary)',
  },
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
  },
  statVal: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--accent-green)',
    minWidth: 40,
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
