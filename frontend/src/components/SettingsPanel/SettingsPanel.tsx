import { useConnectionStore } from '../../store/connectionStore';
import { useFrameStore } from '../../store/frameStore';
import type { InterfaceType } from '../../types/can';

const BITRATES = [
  { label: '125 kbps', value: 125000 },
  { label: '250 kbps', value: 250000 },
  { label: '500 kbps', value: 500000 },
  { label: '1 Mbps',   value: 1000000 },
];

export function SettingsPanel() {
  const status    = useConnectionStore((s) => s.status);
  const config    = useConnectionStore((s) => s.config);
  const setConfig = useConnectionStore((s) => s.setConfig);
  const setInterface = useConnectionStore((s) => s.setInterface);

  const clearFrames          = useFrameStore((s) => s.clearFrames);
  const totalFramesReceived  = useFrameStore((s) => s.totalFramesReceived);

  const isConnected = status === 'connected';

  return (
    <div>
      <div className="text-xs text-muted" style={{ marginBottom: 10, lineHeight: 1.5 }}>
        Changes apply on next Connect. Disconnect first to modify interface settings.
      </div>

      {/* Interface */}
      <div className="field-group">
        <label className="field-label">Interface</label>
        <select
          className="field-select"
          value={config.interface}
          disabled={isConnected}
          onChange={(e) => setInterface(e.target.value as InterfaceType)}
        >
          <option value="gs_usb">gs_usb (Candlelight)</option>
          <option value="slcan">slcan (COM port)</option>
          <option value="virtual">virtual (testing)</option>
        </select>
      </div>

      {/* COM port — slcan only */}
      {config.interface === 'slcan' && (
        <div className="field-group">
          <label className="field-label">COM Port</label>
          <input
            className="field-input"
            type="text"
            disabled={isConnected}
            value={config.channel ?? ''}
            onChange={(e) => setConfig({ channel: e.target.value })}
            placeholder="COM3"
          />
        </div>
      )}

      {/* Device index — gs_usb only */}
      {config.interface === 'gs_usb' && (
        <div className="field-group">
          <label className="field-label">Device Index</label>
          <input
            className="field-input"
            type="number"
            min={0}
            max={9}
            disabled={isConnected}
            value={config.index ?? 0}
            onChange={(e) => setConfig({ index: parseInt(e.target.value) || 0 })}
          />
        </div>
      )}

      {/* Bitrate */}
      {config.interface !== 'virtual' && (
        <div className="field-group">
          <label className="field-label">Bitrate</label>
          <select
            className="field-select"
            value={config.bitrate}
            disabled={isConnected}
            onChange={(e) => setConfig({ bitrate: parseInt(e.target.value) })}
          >
            {BITRATES.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="divider" />

      {/* Frame buffer */}
      <div style={styles.bufferRow}>
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Frame Buffer</div>
          <div className="mono text-xs text-muted">
            {totalFramesReceived.toLocaleString()} frames received
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={clearFrames}
          disabled={totalFramesReceived === 0}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bufferRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
};
