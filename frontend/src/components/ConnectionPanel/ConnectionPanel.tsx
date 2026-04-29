import { useConnectionStore } from '../../store/connectionStore';
import { useFrameStore } from '../../store/frameStore';
import type { InterfaceType } from '../../types/can';

const BITRATES = [
  { label: '125 kbps', value: 125000 },
  { label: '250 kbps', value: 250000 },
  { label: '500 kbps', value: 500000 },
  { label: '1 Mbps',   value: 1000000 },
];

const INTERFACES: { label: string; value: InterfaceType; hint: string }[] = [
  { value: 'gs_usb',      label: 'gs_usb (Candlelight)',        hint: 'FYSETC UCAN, CANable 2.0 Pro - no COM port' },
  { value: 'slcan',       label: 'slcan (COM port)',             hint: 'CANable slcan firmware - appears as COM3 etc.' },
  { value: 'seeedstudio', label: 'USB-CAN Analyzer (GY/Seeed)', hint: 'Cheap USB CAN analyzers with 0xAA/0x55 binary protocol - appears as COM port. No baud rate config needed.' },
  { value: 'socketcan',   label: 'SocketCAN (Linux)',            hint: 'Linux SocketCAN - Raspberry Pi, WSL2. Run: sudo ip link set can0 up type can bitrate 500000' },
  { value: 'virtual',     label: 'virtual (testing)',            hint: 'Software bus - no hardware required' },
  { value: 'pcan',        label: 'PCAN (PEAK)',                  hint: 'PEAK PCAN-USB - requires PEAK driver installed. Shows as CAN-Hardware in Device Manager.' },
  { value: 'kvaser',      label: 'Kvaser',                       hint: 'Kvaser hardware - requires Kvaser CANlib installed. Shows as CAN-Hardware (Kvaser) in Device Manager.' },
];

export function ConnectionPanel() {
  const status       = useConnectionStore((s) => s.status);
  const config       = useConnectionStore((s) => s.config);
  const error        = useConnectionStore((s) => s.error);
  const setInterface = useConnectionStore((s) => s.setInterface);
  const setConfig    = useConnectionStore((s) => s.setConfig);
  const connect      = useConnectionStore((s) => s.connect);
  const disconnect   = useConnectionStore((s) => s.disconnect);

  const totalFrames  = useFrameStore((s) => s.totalFramesReceived);
  const clearFrames  = useFrameStore((s) => s.clearFrames);

  const isConnected   = status === 'connected';
  const isBusy        = status === 'connecting' || status === 'disconnecting';
  const canConnect    = !isConnected && !isBusy;
  const canDisconnect = isConnected && !isBusy;

  const selectedIface = INTERFACES.find((i) => i.value === config.interface);

  return (
    <div>
      {/* Interface */}
      <div className="field-group">
        <label className="field-label">Interface</label>
        <select
          className="field-select"
          value={config.interface}
          disabled={isConnected || isBusy}
          onChange={(e) => setInterface(e.target.value as InterfaceType)}
        >
          {INTERFACES.map((i) => (
            <option key={i.value} value={i.value}>{i.label}</option>
          ))}
        </select>
        {selectedIface && (
          <span style={styles.hint}>{selectedIface.hint}</span>
        )}
      </div>

      {/* gs_usb: device index */}
      {config.interface === 'gs_usb' && (
        <div className="field-group">
          <label className="field-label">Device Index</label>
          <input
            className="field-input"
            type="number"
            min={0}
            max={9}
            value={config.index ?? 0}
            disabled={isConnected || isBusy}
            onChange={(e) => setConfig({ index: parseInt(e.target.value) || 0 })}
          />
        </div>
      )}

      {/* slcan: COM port + serial baud rate */}
      {config.interface === 'slcan' && (
        <>
          <div className="field-group">
            <label className="field-label">COM Port</label>
            <input
              className="field-input"
              type="text"
              placeholder="COM3"
              value={config.channel ?? ''}
              disabled={isConnected || isBusy}
              onChange={(e) => setConfig({ channel: e.target.value })}
            />
          </div>
        </>
      )}

      {/* seeedstudio: COM port only — no serial baud rate, protocol handles init */}
      {config.interface === 'seeedstudio' && (
        <div className="field-group">
          <label className="field-label">COM Port</label>
          <input
            className="field-input"
            type="text"
            placeholder="COM8"
            value={config.channel ?? ''}
            disabled={isConnected || isBusy}
            onChange={(e) => setConfig({ channel: e.target.value })}
          />
        </div>
      )}

      {/* socketcan: channel */}
      {config.interface === 'socketcan' && (
        <div className="field-group">
          <label className="field-label">Channel</label>
          <input
            className="field-input"
            type="text"
            placeholder="can0"
            value={config.channel ?? ''}
            disabled={isConnected || isBusy}
            onChange={(e) => setConfig({ channel: e.target.value })}
          />
        </div>
      )}

      {/* pcan: USB channel selector */}
      {config.interface === 'pcan' && (
        <div className="field-group">
          <label className="field-label">USB Channel</label>
          <select
            className="field-select"
            value={config.channel ?? 'PCAN_USBBUS1'}
            disabled={isConnected || isBusy}
            onChange={(e) => setConfig({ channel: e.target.value })}
          >
            {[1,2,3,4,5,6,7,8].map((n) => (
              <option key={n} value={`PCAN_USBBUS${n}`}>PCAN_USBBUS{n}</option>
            ))}
          </select>
        </div>
      )}

      {/* kvaser: device index */}
      {config.interface === 'kvaser' && (
        <div className="field-group">
          <label className="field-label">Device Index</label>
          <input
            className="field-input"
            type="number"
            min={0}
            max={9}
            value={config.index ?? 0}
            disabled={isConnected || isBusy}
            onChange={(e) => setConfig({ index: parseInt(e.target.value) || 0 })}
          />
        </div>
      )}

      {/* Bitrate - not shown for virtual */}
      {config.interface !== 'virtual' && (
        <div className="field-group">
          <label className="field-label">Bitrate</label>
          <select
            className="field-select"
            value={config.bitrate}
            disabled={isConnected || isBusy}
            onChange={(e) => setConfig({ bitrate: parseInt(e.target.value) })}
          >
            {BITRATES.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Error */}
      {error && <div className="error-banner">{error}</div>}

      {/* Connect / Disconnect */}
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button
          className="btn btn-primary flex-1"
          disabled={!canConnect}
          onClick={connect}
        >
          {status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
        <button
          className="btn btn-danger"
          disabled={!canDisconnect}
          onClick={disconnect}
        >
          {status === 'disconnecting' ? '…' : 'Disconnect'}
        </button>
      </div>

      {/* Clear buffer - only useful when connected or after a session */}
      {totalFrames > 0 && (
        <>
          <div className="divider" style={{ marginTop: 10 }} />
          <div style={styles.clearRow}>
            <span className="text-xs text-muted mono">
              {totalFrames.toLocaleString()} frames in buffer
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={clearFrames}
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  hint: {
    fontSize: 10,
    color: 'var(--text-muted)',
    lineHeight: 1.4,
    marginTop: 2,
  },
  clearRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
};
