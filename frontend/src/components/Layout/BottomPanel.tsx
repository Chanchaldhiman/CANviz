import { useState, useRef, useCallback, useEffect } from 'react';
import { SendFramePanel } from '../SendFramePanel/SendFramePanel';
import { LogControls } from '../LogControls/LogControls';
import { ReplayPanel } from '../ReplayPanel/ReplayPanel';
import { SignalPlot } from '../SignalPlot/SignalPlot';

const TABS = [
  { id: 'send',   label: 'Send Frame' },
  { id: 'log',    label: 'Record' },
  { id: 'replay', label: 'Replay' },
  { id: 'plot',   label: 'Plot' },
] as const;

type TabId = typeof TABS[number]['id'];

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 760;
const DEFAULT_HEIGHT = 300;
const STORAGE_KEY = 'canvaz:bottomPanelHeight';

function loadHeight(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parseInt(v)));
  } catch { /* ignore */ }
  return DEFAULT_HEIGHT;
}

export function BottomPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('send');
  const [height, setHeight]       = useState<number>(loadHeight);
  const [dragging, setDragging]   = useState(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  useEffect(() => {
    document.documentElement.style.setProperty('--bottompanel-height', `${height}px`);
    try { localStorage.setItem(STORAGE_KEY, String(height)); } catch { /* ignore */ }
  }, [height]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartH.current = height;
    setDragging(true);
  }, [height]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartH.current + delta)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  return (
    <div className="app-bottom panel" style={styles.panel}>
      {/* Drag handle */}
      <div
        style={{ ...styles.handle, cursor: 'ns-resize' }}
        onMouseDown={onMouseDown}
        title="Drag to resize"
      >
        <div style={styles.handleGrip} />
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            style={{ position: 'relative' }}
          >
            {tab.label}

          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'send'   && <SendFramePanel />}
        {activeTab === 'log'    && <LogControls />}
        {activeTab === 'replay' && <ReplayPanel />}
        {activeTab === 'plot'   && <SignalPlot />}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    borderTop: 'none',
    borderRight: 'none',
    borderLeft: '1px solid var(--border-subtle)',
    borderBottom: 'none',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  handle: {
    height: 8,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-panel)',
    borderTop: '1px solid var(--border-subtle)',
    userSelect: 'none',
  },
  handleGrip: {
    width: 32,
    height: 3,
    borderRadius: 2,
    background: 'var(--border-strong)',
    pointerEvents: 'none',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px 14px',
  },
  tabDot: {
    position: 'absolute',
    top: 6,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--accent-amber)',
    boxShadow: '0 0 4px var(--accent-amber)',
  },
};
