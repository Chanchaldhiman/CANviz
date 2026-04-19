import { useState, useEffect, useRef } from 'react';
import { useLogStore } from '../../store/logStore';
import { useConnectionStore } from '../../store/connectionStore';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function LogControls() {
  const status        = useConnectionStore((s) => s.status);
  const isConnected   = status === 'connected';

  const recording      = useLogStore((s) => s.recording);
  const recordingStart = useLogStore((s) => s.recordingStart);
  const ascUrl         = useLogStore((s) => s.ascUrl);
  const csvUrl         = useLogStore((s) => s.csvUrl);
  const logError       = useLogStore((s) => s.logError);
  const startRecording = useLogStore((s) => s.startRecording);
  const stopRecording  = useLogStore((s) => s.stopRecording);

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick elapsed timer while recording
  useEffect(() => {
    if (recording && recordingStart) {
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - recordingStart);
      }, 500);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (!recording) setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recording, recordingStart]);

  return (
    <div>
      {/* Recording controls */}
      <div className="btn-row" style={{ marginBottom: 8 }}>
        {!recording ? (
          <button
            className="btn btn-primary flex-1"
            disabled={!isConnected}
            onClick={startRecording}
          >
            ● Record
          </button>
        ) : (
          <>
            <button
              className="btn btn-danger flex-1"
              onClick={stopRecording}
            >
              ■ Stop
            </button>
            <div style={styles.timer} className="mono">
              <span style={styles.timerDot} />
              {formatElapsed(elapsed)}
            </div>
          </>
        )}
      </div>

      {logError && <div className="error-banner">{logError}</div>}

      {/* Download links — shown after stop */}
      {(ascUrl || csvUrl) && !recording && (
        <div style={styles.downloads}>
          <span style={styles.downloadsLabel} className="text-xs text-muted">
            Session saved — download:
          </span>
          <div className="btn-row">
            {ascUrl && (
              <a
                href={ascUrl}
                download
                className="btn btn-ghost btn-sm flex-1"
                style={{ textDecoration: 'none', textAlign: 'center' }}
              >
                ↓ .asc
              </a>
            )}
            {csvUrl && (
              <a
                href={csvUrl}
                download
                className="btn btn-ghost btn-sm flex-1"
                style={{ textDecoration: 'none', textAlign: 'center' }}
              >
                ↓ .csv
              </a>
            )}
          </div>
        </div>
      )}

      {!isConnected && !recording && (
        <div className="text-xs text-muted" style={{ marginTop: 4 }}>
          Connect to a bus to enable recording
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  timer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 10px',
    background: 'var(--accent-red-dim)',
    border: '1px solid var(--accent-red)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--accent-red)',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.04em',
    minWidth: 70,
    justifyContent: 'center',
  },
  timerDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--accent-red)',
    animation: 'pulse-amber 1s infinite',
    flexShrink: 0,
  },
  downloads: {
    marginTop: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  downloadsLabel: {
    display: 'block',
  },
};
