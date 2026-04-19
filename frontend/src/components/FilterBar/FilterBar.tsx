import { useEffect, useCallback } from 'react';
import { useFrameStore } from '../../store/frameStore';

// Sync filter state to/from URL search params
function readUrlParams(): { idText: string; signalName: string } {
  const p = new URLSearchParams(window.location.search);
  return {
    idText: p.get('id') ?? '',
    signalName: p.get('sig') ?? '',
  };
}

function writeUrlParams(idText: string, signalName: string) {
  const p = new URLSearchParams(window.location.search);
  idText     ? p.set('id',  idText)     : p.delete('id');
  signalName ? p.set('sig', signalName) : p.delete('sig');
  const search = p.toString();
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export function FilterBar() {
  const filter    = useFrameStore((s) => s.filter);
  const setFilter = useFrameStore((s) => s.setFilter);

  // Load from URL on mount
  useEffect(() => {
    const { idText, signalName } = readUrlParams();
    if (idText || signalName) {
      setFilter({ idText, signalName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIdChange = useCallback(
    (idText: string) => {
      setFilter({ idText });
      writeUrlParams(idText, filter.signalName);
    },
    [filter.signalName, setFilter],
  );

  const handleSignalChange = useCallback(
    (signalName: string) => {
      setFilter({ signalName });
      writeUrlParams(filter.idText, signalName);
    },
    [filter.idText, setFilter],
  );

  const clearAll = () => {
    setFilter({ idText: '', signalName: '' });
    writeUrlParams('', '');
  };

  const hasFilter = filter.idText.trim() || filter.signalName.trim();

  return (
    <div>
      <div className="field-group">
        <label className="field-label">ID Filter</label>
        <input
          className="field-input"
          type="text"
          placeholder="e.g. 0x1A2  or  0x100-0x1FF"
          value={filter.idText}
          onChange={(e) => handleIdChange(e.target.value)}
        />
        <span style={styles.hint}>Hex ID or range (0x100-0x1FF)</span>
      </div>

      <div className="field-group">
        <label className="field-label">Signal Name</label>
        <input
          className="field-input"
          type="text"
          placeholder="e.g. EngineSpeed"
          value={filter.signalName}
          onChange={(e) => handleSignalChange(e.target.value)}
        />
        <span style={styles.hint}>Substring match on signal or message name</span>
      </div>

      {hasFilter && (
        <button className="btn btn-ghost btn-sm btn-full" onClick={clearAll}>
          ✕ Clear filters
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  hint: {
    fontSize: 10,
    color: 'var(--text-muted)',
    marginTop: 2,
  },
};
