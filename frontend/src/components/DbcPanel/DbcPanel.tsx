import { useRef } from 'react';
import { useDbcStore } from '../../store/dbcStore';
import { useFrameStore } from '../../store/frameStore';

export function DbcPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { loaded, filename, messages, loading, error, loadFile, clear } = useDbcStore();
  const showDecoded = useFrameStore((s) => s.filter.showDecoded);
  const setFilter = useFrameStore((s) => s.setFilter);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.dbc')) loadFile(file);
  };

  return (
    <div>
      {/* File upload */}
      {!loaded ? (
        <>
          <div
            className="file-drop"
            onClick={() => fileRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="file-drop-text">
              {loading ? 'Parsing DBC…' : 'Drop .dbc file or click to browse'}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".dbc"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
          {error && <div className="error-banner">{error}</div>}
        </>
      ) : (
        <>
          {/* Loaded state */}
          <div style={styles.loadedRow}>
            <span className="badge badge-green">DBC</span>
            <span style={styles.filename} className="mono text-xs" title={filename ?? ''}>
              {filename}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={clear}>✕</button>
          </div>

          {/* Signal view toggle */}
          <div className="toggle-row" style={{ marginTop: 8 }}>
            <label className="toggle-label" htmlFor="decoded-toggle">Show decoded signals</label>
            <label className="toggle" htmlFor="decoded-toggle">
              <input
                id="decoded-toggle"
                type="checkbox"
                checked={showDecoded}
                onChange={(e) => setFilter({ showDecoded: e.target.checked })}
              />
              <span className="toggle-track" />
            </label>
          </div>

          <div className="divider" />

          {/* Message list */}
          <div style={styles.msgLabel} className="text-xs text-muted">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </div>
          <div style={styles.msgList}>
            {messages.slice(0, 40).map((msg) => (
              <div key={msg.id} style={styles.msgRow}>
                <span className="mono text-xs" style={{ color: 'var(--accent-green)' }}>
                  {('0x' + msg.id.toString(16).toUpperCase()).padStart(6, ' ')}
                </span>
                <span style={styles.msgName} className="text-xs">{msg.name}</span>
                <span className="text-xs text-muted">{msg.signals?.length ?? 0}s</span>
              </div>
            ))}
            {messages.length > 40 && (
              <div style={{ ...styles.msgRow, color: 'var(--text-muted)', fontSize: 10 }}>
                +{messages.length - 40} more
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  loadedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  filename: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-secondary)',
  },
  msgLabel: {
    marginBottom: 4,
  },
  msgList: {
    maxHeight: 180,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  msgRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 0',
    borderBottom: '1px solid var(--border-subtle)',
  },
  msgName: {
    flex: 1,
    color: 'var(--text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
