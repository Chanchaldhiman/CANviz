import { useRef, useEffect } from 'react';
import { useLogStore } from '../../store/logStore';

const SPEED_OPTIONS = [
  { label: '0.5×', value: 0.5 },
  { label: '1×',   value: 1 },
  { label: '2×',   value: 2 },
  { label: '5×',   value: 5 },
  { label: '10×',  value: 10 },
];

const POLL_INTERVAL_MS = 500;

export function ReplayPanel() {
  const fileRef = useRef<HTMLInputElement>(null);

  const replaying            = useLogStore((s) => s.replaying);
  const replayPaused         = useLogStore((s) => s.replayPaused);
  const replaySpeed          = useLogStore((s) => s.replaySpeed);
  const replayFilename       = useLogStore((s) => s.replayFilename);
  const replayProgress       = useLogStore((s) => s.replayProgress);
  const replayError          = useLogStore((s) => s.replayError);
  const replayDone           = useLogStore((s) => s.replayDone);

  const uploadAndStartReplay = useLogStore((s) => s.uploadAndStartReplay);
  const pauseReplay          = useLogStore((s) => s.pauseReplay);
  const resumeReplay         = useLogStore((s) => s.resumeReplay);
  const stopReplay           = useLogStore((s) => s.stopReplay);
  const setReplaySpeed       = useLogStore((s) => s.setReplaySpeed);
  const setReplayProgress    = useLogStore((s) => s.setReplayProgress);
  const setReplayDone        = useLogStore((s) => s.setReplayDone);

  // Poll backend for progress while replaying
  useEffect(() => {
    if (!replaying || replayDone) return;

    const poll = async () => {
      try {
        const res = await fetch('/replay/status');
        if (!res.ok) return;
        const data = await res.json();
        setReplayProgress(data.progress ?? 0);
        if (!data.active) {
          setReplayProgress(100);
          setReplayDone(true);
        }
      } catch {
        // Ignore poll errors
      }
    };

    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [replaying, replayDone, setReplayProgress, setReplayDone]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAndStartReplay(file, replaySpeed);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) uploadAndStartReplay(file, replaySpeed);
  };

  const handleReplayAgain = () => {
    stopReplay().then(() => {
      fileRef.current?.click();
    });
  };

  return (
    <div>
      {/* Speed selector — always visible */}
      <div className="field-group">
        <label className="field-label">Playback Speed</label>
        <div style={styles.speedRow}>
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`btn btn-sm ${replaySpeed === opt.value ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, padding: '0 4px' }}
              onClick={() => setReplaySpeed(opt.value)}
              disabled={replaying && !replayDone}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!replaying ? (
        /* Upload drop zone */
        <>
          <div
            className="file-drop"
            onClick={() => fileRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="file-drop-text">
              Drop .asc or .csv log file or click to browse
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".asc,.csv"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
        </>
      ) : (
        /* Replay in progress or done */
        <>
          {/* Filename */}
          <div style={styles.filenameRow}>
            <span className={`badge ${replayDone ? 'badge-muted' : 'badge-amber'}`}>
              {replayDone ? 'DONE' : 'REPLAY'}
            </span>
            <span className="mono text-xs" style={styles.filename} title={replayFilename ?? ''}>
              {replayFilename}
            </span>
          </div>

          {/* Progress bar */}
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${Math.min(100, replayProgress)}%`,
                background: replayDone ? 'var(--text-muted)' : 'var(--accent-amber)',
              }}
            />
          </div>
          <div style={styles.progressLabel} className="mono text-xs text-muted">
            {replayProgress.toFixed(0)}%
          </div>

          {/* Controls */}
          {replayDone ? (
            /* Finished state */
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn btn-primary flex-1" onClick={handleReplayAgain}>
                ↺ Replay Again
              </button>
              <button className="btn btn-ghost" onClick={stopReplay}>
                ✕ Close
              </button>
            </div>
          ) : (
            /* Active state */
            <div className="btn-row" style={{ marginTop: 8 }}>
              {replayPaused ? (
                <button className="btn btn-primary flex-1" onClick={resumeReplay}>
                  ▶ Resume
                </button>
              ) : (
                <button className="btn btn-amber flex-1" onClick={pauseReplay}>
                  ❙❙ Pause
                </button>
              )}
              <button className="btn btn-ghost" onClick={stopReplay}>
                ■ Stop
              </button>
            </div>
          )}
        </>
      )}

      {replayError && (
        <div className="error-banner" style={{ marginTop: 6 }}>{replayError}</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  speedRow: {
    display: 'flex',
    gap: 4,
  },
  filenameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  filename: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-secondary)',
  },
  progressTrack: {
    height: 4,
    background: 'var(--bg-elevated)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 400ms ease, background 300ms ease',
  },
  progressLabel: {
    marginTop: 3,
    textAlign: 'right',
  },
};
