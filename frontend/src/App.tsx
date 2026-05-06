import { useEffect, useRef, useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useStatusSync } from './hooks/useStatusSync';
import { TopBar } from './components/Layout/TopBar';
import { Sidebar } from './components/Layout/Sidebar';
import { MessageTable } from './components/MessageTable/MessageTable';
import { BottomPanel } from './components/Layout/BottomPanel';
import { ProtocolPanel } from './components/Layout/ProtocolPanel';

const MIN_RIGHTPANEL = 240;
const MAX_RIGHTPANEL = 1100;
const STORAGE_KEY    = 'canvaz:rightPanelWidth';

function loadRightWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return Math.min(MAX_RIGHTPANEL, Math.max(MIN_RIGHTPANEL, parseInt(v)));
  } catch { /* ignore */ }
  return 360;
}

export function App() {
  useStatusSync();
  useWebSocket();

  const [rightWidth, setRightWidth] = useState<number>(loadRightWidth);
  const [dragging, setDragging]     = useState(false);
  const dragStartX  = useRef(0);
  const dragStartW  = useRef(0);

  // Keep CSS variable in sync
  useEffect(() => {
    document.documentElement.style.setProperty('--rightpanel-width', `${rightWidth}px`);
    try { localStorage.setItem(STORAGE_KEY, String(rightWidth)); } catch { /* ignore */ }
  }, [rightWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = rightWidth;
    setDragging(true);
  }, [rightWidth]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      // Dragging the handle LEFT increases the panel width
      const delta = dragStartX.current - e.clientX;
      setRightWidth(Math.min(MAX_RIGHTPANEL, Math.max(MIN_RIGHTPANEL, dragStartW.current + delta)));
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
    <div className="app-shell">
      <TopBar />
      <Sidebar />
      <MessageTable />
      <BottomPanel />
      <ProtocolPanel onResizeMouseDown={onMouseDown} dragging={dragging} />
    </div>
  );
}
