/**
 * ProtocolPanel.tsx
 * -----------------
 * Right-side panel housing protocol decoders: J1939 and CANopen.
 * Freed from the height-constrained bottom tab strip -- decoders
 * now get full panel height with their own tab switcher.
 *
 * Drag handle on the LEFT edge; dragging left widens the panel.
 */

import { useState } from 'react';
import { J1939Panel } from '../J1939Panel/J1939Panel';
import { CANopenPanel } from '../CANopenPanel/CANopenPanel';
import { OBDPanel } from '../OBDPanel/OBDPanel';
import { useJ1939Store } from '../../store/j1939Store';
import { useCANopenStore } from '../../store/canopenStore';
import { useOBDStore } from '../../store/obdStore';

type ProtocolTab = 'canopen' | 'j1939' | 'obd';

interface Props {
  onResizeMouseDown: (e: React.MouseEvent) => void;
  dragging: boolean;
}

const tabDot: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 4,
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--accent-amber)',
  boxShadow: '0 0 4px var(--accent-amber)',
};

export function ProtocolPanel({ onResizeMouseDown, dragging }: Props) {
  const [activeTab, setActiveTab] = useState<ProtocolTab>('canopen');

  const j1939Detected  = useJ1939Store((s) => s.autoDetected);
  const j1939Mode      = useJ1939Store((s) => s.mode);
  const showJ1939Dot   = j1939Detected && j1939Mode === 'off';

  const canopenDetected = useCANopenStore((s) => s.autoDetected);
  const canopenMode     = useCANopenStore((s) => s.mode);
  const showCanopenDot  = canopenDetected && canopenMode === 'off';

  const obdMode = useOBDStore((s) => s.mode);
  const obdStalled = useOBDStore((s) => s.dataStalled);
  const obdWatchedCount = useOBDStore((s) => s.watchedPids.length);

  return (
    <div
      className="app-rightpanel panel"
      style={{
        display:        'flex',
        flexDirection:  'column',
        overflow:       'hidden',
        borderTop:      'none',
        borderRight:    'none',
        borderBottom:   'none',
        borderLeft:     '1px solid var(--border-subtle)',
        position:       'relative',
      }}
    >
      {/* Vertical drag handle -- on LEFT edge of the panel */}
      <div
        style={{
          position:   'absolute',
          left:       0,
          top:        0,
          bottom:     0,
          width:      6,
          cursor:     'ew-resize',
          zIndex:     10,
          background: dragging ? 'var(--accent-green-dim)' : 'transparent',
          transition: 'background 100ms',
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseDown={onResizeMouseDown}
        title="Drag to resize"
      >
        <div style={{
          width: 2, height: 32, borderRadius: 2,
          background: dragging ? 'var(--accent-green)' : 'var(--border-strong)',
          transition: 'background 100ms',
        }} />
      </div>

      {/* Tab bar */}
      <div className="tab-bar" style={{ paddingLeft: 8, flexShrink: 0 }}>
        <button
          className={`tab-btn ${activeTab === 'canopen' ? 'active' : ''}`}
          onClick={() => setActiveTab('canopen')}
          style={{ position: 'relative' }}
        >
          CANopen
          {showCanopenDot && (
            <span style={tabDot} title="CANopen traffic detected -- enable decoder" />
          )}
        </button>
        <button
          className={`tab-btn ${activeTab === 'j1939' ? 'active' : ''}`}
          onClick={() => setActiveTab('j1939')}
          style={{ position: 'relative' }}
        >
          J1939
          {showJ1939Dot && (
            <span style={tabDot} title="J1939 traffic detected -- enable decoder" />
          )}
        </button>
        <button
          className={`tab-btn ${activeTab === 'obd' ? 'active' : ''}`}
          onClick={() => setActiveTab('obd')}
          style={{ position: 'relative' }}
        >
          OBD-II
          {obdMode === 'on' && obdWatchedCount > 0 && !obdStalled && (
            <span style={{ ...tabDot, background: 'var(--accent-green)', boxShadow: '0 0 4px var(--accent-green)' }} title="Receiving live OBD-II data" />
          )}
          {obdMode === 'on' && obdWatchedCount > 0 && obdStalled && (
            <span style={{ ...tabDot, background: 'var(--accent-amber)', boxShadow: '0 0 4px var(--accent-amber)' }} title="Enabled, but not receiving responses" />
          )}
          {obdMode === 'on' && obdWatchedCount === 0 && (
            <span style={{ ...tabDot, background: 'var(--text-muted)' }} title="Enabled -- select a PID to see live data" />
          )}
        </button>
      </div>

      {/* Panel content -- full height, scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 14px' }}>
        {activeTab === 'canopen' && <CANopenPanel />}
        {activeTab === 'j1939'   && <J1939Panel />}
        {activeTab === 'obd'     && <OBDPanel />}
      </div>
    </div>
  );
}
