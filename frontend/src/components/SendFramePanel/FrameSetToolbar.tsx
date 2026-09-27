import { useEffect, useRef, useState } from 'react';
import {
  useSendFrameStore,
  parseFrameSetFile,
  serializeFrameSets,
  type FrameSet,
} from '../../store/sendFrameStore';

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string) {
  return name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'frames';
}

/**
 * Save / restore bar for the Send Frame panel.
 *
 * Frame sets are kept in localStorage (so they survive reloads) and can be
 * exported to / imported from JSON files to move them between machines or
 * keep them next to a bench setup in version control.
 */
export function FrameSetToolbar() {
  const sets        = useSendFrameStore((s) => s.sets);
  const activeSet   = useSendFrameStore((s) => s.activeSet);
  const dirty       = useSendFrameStore((s) => s.dirty);
  const saveSet     = useSendFrameStore((s) => s.saveSet);
  const loadSet     = useSendFrameStore((s) => s.loadSet);
  const deleteSet   = useSendFrameStore((s) => s.deleteSet);
  const importSets  = useSendFrameStore((s) => s.importSets);
  const currentAsSet = useSendFrameStore((s) => s.currentAsSet);

  const [name, setName]   = useState(activeSet ?? '');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the name field in step with whatever set was last loaded / saved
  useEffect(() => { setName(activeSet ?? ''); }, [activeSet]);

  const confirmDiscard = () =>
    !dirty || window.confirm('Discard unsaved changes to the current frames?');

  const handleLoad = (setName: string) => {
    if (!setName || !confirmDiscard()) return;
    setError(null);
    loadSet(setName);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a name to save the frame set'); return; }
    if (trimmed !== activeSet && sets.some((s) => s.name === trimmed) &&
        !window.confirm(`Overwrite saved set "${trimmed}"?`)) return;
    setError(null);
    saveSet(trimmed);
  };

  const handleDelete = () => {
    if (!activeSet || !window.confirm(`Delete saved set "${activeSet}"?`)) return;
    deleteSet(activeSet);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // allow re-importing the same file
    if (!file || !confirmDiscard()) return;
    try {
      const parsed: FrameSet[] = parseFrameSetFile(await file.text(), file.name.replace(/\.json$/i, ''));
      const clashes = parsed.filter((p) => sets.some((s) => s.name === p.name)).map((p) => p.name);
      if (clashes.length && !window.confirm(`Overwrite saved set(s): ${clashes.join(', ')}?`)) return;
      importSets(parsed);
      setError(null);
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`);
    }
  };

  const handleExport = () => {
    const current = { ...currentAsSet(), name: name.trim() || currentAsSet().name };
    download(`${safeFilename(current.name)}.canviz.json`, serializeFrameSets([current]));
  };

  const handleExportAll = () => {
    download('canviz-frame-sets.json', serializeFrameSets(sets));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={styles.bar}>
        <select
          style={{ ...styles.input, width: 150, cursor: 'pointer' }}
          value={activeSet ?? ''}
          onChange={(e) => handleLoad(e.target.value)}
          title="Load a saved frame set"
        >
          <option value="" disabled>{sets.length ? 'Load saved set…' : 'No saved sets'}</option>
          {sets.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.frames.length})
            </option>
          ))}
        </select>

        <input
          style={{ ...styles.input, flex: '0 1 180px', minWidth: 80 }}
          value={name}
          placeholder="Set name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        />

        <button className="btn btn-ghost btn-sm" onClick={handleSave} title="Save current frames under this name">
          Save
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleDelete}
          disabled={!activeSet}
          title={activeSet ? `Delete saved set "${activeSet}"` : 'No saved set loaded'}
        >
          Delete
        </button>

        <span style={styles.sep} />

        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} title="Import frame sets from a JSON file">
          Import
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleExport} title="Export current frames to a JSON file">
          Export
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleExportAll}
          disabled={sets.length === 0}
          title="Export every saved set to one JSON file"
        >
          Export all
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImport} />

        {dirty && (
          <span style={styles.dirty} title="Current frames differ from the last save / load">
            ● unsaved
          </span>
        )}
      </div>

      {error && (
        <div style={styles.error}>⚠ {error}</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    paddingBottom: 6,
    borderBottom: '1px solid var(--border-subtle)',
  },
  input: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    height: 24,
    padding: '0 6px',
    outline: 'none',
  },
  sep: {
    width: 1,
    height: 16,
    background: 'var(--border-default)',
    margin: '0 2px',
  },
  dirty: {
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    color: 'var(--accent-amber)',
    whiteSpace: 'nowrap',
  },
  error: {
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    color: '#ef4444',
  },
};
