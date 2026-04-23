import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import uPlot from 'uplot';
import { usePlot } from '../../hooks/usePlot';
import { usePlotRenderLoop } from '../../hooks/usePlotRenderLoop';
import { usePlotStore, SIGNAL_COLORS, MAX_SIGNALS, getLatestValue } from '../../store/plotStore';

export function SignalPlot() {
  const selectedSignals  = usePlotStore((s) => s.selectedSignals);
  const availableSignals = usePlotStore((s) => s.availableSignals);
  const toggleSignal     = usePlotStore((s) => s.toggleSignal);
  const windowSec        = usePlotStore((s) => s.windowSec);
  const setWindowSec     = usePlotStore((s) => s.setWindowSec);

  // ── Pause / drag state ────────────────────────────────────────────────────
  const isPausedRef   = useRef(false);
  const dragStartXRef = useRef<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const onPausedChange = useCallback((paused: boolean) => setIsPaused(paused), []);

  // ── Threshold state ───────────────────────────────────────────────────────
  // Plain object - keyed by signal key, value is the numeric threshold
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const thresholdsRef = useRef<Record<string, number>>({});   // ref so hooks.draw always reads latest
  const [breached, setBreached]     = useState<Set<string>>(new Set());
  const breachedRef   = useRef<Set<string>>(new Set());

  const handleThresholdChange = (key: string, raw: string) => {
    const num  = parseFloat(raw);
    const next = { ...thresholdsRef.current };
    if (raw === '' || isNaN(num)) delete next[key];
    else next[key] = num;
    thresholdsRef.current = next;
    setThresholds(next);
  };

  const handleRemoveSignal = (key: string) => {
    toggleSignal(key);
    // Clean up threshold for removed signal
    const next = { ...thresholdsRef.current };
    delete next[key];
    thresholdsRef.current = next;
    setThresholds(next);
  };

  // Breach detection - runs at 10 Hz, same cadence as render loop
  useEffect(() => {
    if (selectedSignals.length === 0) return;
    const id = setInterval(() => {
      const newBreached = new Set<string>();
      for (const key of Object.keys(thresholdsRef.current)) {
        const threshold = thresholdsRef.current[key];
        const val = getLatestValue(key);
        if (val !== null && val > threshold) newBreached.add(key);
      }
      const prev    = breachedRef.current;
      const changed =
        newBreached.size !== prev.size ||
        [...newBreached].some((k) => !prev.has(k)) ||
        [...prev].some((k) => !newBreached.has(k));
      if (changed) {
        breachedRef.current = newBreached;
        setBreached(new Set(newBreached));
      }
    }, 100);
    return () => clearInterval(id);
  }, [selectedSignals]);

  // ── uPlot opts ────────────────────────────────────────────────────────────
  const unselected = availableSignals.filter((k) => !selectedSignals.includes(k));

  const emptyData: uPlot.AlignedData = useMemo(
    () => [[], ...selectedSignals.map(() => [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSignals.length],
  );

  const opts: uPlot.Options = useMemo(() => ({
    width:  860,
    height: 280,
    series: [
      {},
      ...selectedSignals.map((key, i) => ({
        label:    key,
        stroke:   SIGNAL_COLORS[i % SIGNAL_COLORS.length],
        width:    2,
        fill:     SIGNAL_COLORS[i % SIGNAL_COLORS.length] + '10',
        spanGaps: true,
      })),
    ],
    axes: [
      { stroke: '#94a3b8', ticks: { stroke: '#1e293b' }, grid: { stroke: '#1e293b' } },
      { stroke: '#94a3b8', ticks: { stroke: '#1e293b' }, grid: { stroke: '#1e293b' } },
    ],
    scales: { x: { time: true } },
    cursor: { drag: { x: true, y: false } },
    select: { show: true, left: 0, top: 0, width: 0, height: 0 },
    legend: { show: true },
    hooks: {
      draw: [(u: uPlot) => {
        const ctx = u.ctx;
        const entries = Object.entries(thresholdsRef.current);
        if (entries.length === 0) return;

        for (const [key, threshold] of entries) {
          const si = selectedSignals.indexOf(key);
          if (si === -1) continue;

          const yPos      = Math.round(u.valToPos(threshold, 'y', true));
          const isBreached = breachedRef.current.has(key);
          const baseColor  = SIGNAL_COLORS[si % SIGNAL_COLORS.length];
          const lineColor  = isBreached ? '#ef4444' : baseColor;

          ctx.save();
          ctx.strokeStyle = lineColor;
          ctx.globalAlpha = isBreached ? 1 : 0.7;
          ctx.lineWidth   = 1.5;
          ctx.setLineDash([6, 3]);
          ctx.beginPath();
          ctx.moveTo(u.bbox.left, yPos);
          ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
          ctx.stroke();

          // Value label on the right edge
          ctx.globalAlpha = 1;
          ctx.fillStyle   = lineColor;
          ctx.font        = '10px monospace';
          ctx.textAlign   = 'right';
          ctx.fillText(
            String(threshold),
            u.bbox.left + u.bbox.width - 4,
            yPos - 4,
          );
          ctx.restore();
        }
      }],
    },
  // thresholdsRef and breachedRef are stable refs - intentionally not in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selectedSignals]);

  const { containerRef, plotRef } = usePlot(opts, emptyData, [selectedSignals.join(',')]);
  usePlotRenderLoop(plotRef, selectedSignals, windowSec, isPausedRef, onPausedChange);

  // ── Drag / zoom handlers ──────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => { dragStartXRef.current = e.clientX; };
  const handleMouseUp   = (e: React.MouseEvent) => {
    if (dragStartXRef.current !== null && Math.abs(e.clientX - dragStartXRef.current) > 5) {
      isPausedRef.current = true;
      setIsPaused(true);
    }
    dragStartXRef.current = null;
  };
  const handleDoubleClick = () => { isPausedRef.current = false; setIsPaused(false); };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '12px 16px', background: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b' }}>

      {/* Header - signal pills + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>

        {selectedSignals.map((key, i) => {
          const isBreached = breached.has(key);
          const color      = SIGNAL_COLORS[i % SIGNAL_COLORS.length];
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: '#1e293b',
              border: `1px solid ${isBreached ? '#ef4444' : color + '40'}`,
              borderRadius: '4px', padding: '2px 4px 2px 7px',
              transition: 'border-color 0.2s',
            }}>
              {/* Colour dot */}
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />

              {/* Signal name */}
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#e2e8f0' }}>{key}</span>

              {/* Threshold input */}
              <input
                type="text"
                inputMode="numeric"
                placeholder="limit"
                value={thresholds[key] !== undefined ? String(thresholds[key]) : ''}
                onChange={(e) => handleThresholdChange(key, e.target.value)}
                title="Threshold - line turns red when signal exceeds this value"
                style={{
                  width: 46,
                  background: 'transparent',
                  border: 'none',
                  borderLeft: `1px solid ${isBreached ? '#ef444460' : '#334155'}`,
                  color: isBreached ? '#ef4444' : '#94a3b8',
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  padding: '0 4px',
                  outline: 'none',
                  marginLeft: '2px',
                }}
              />

              {/* Breach indicator */}
              {isBreached && (
                <span style={{ fontSize: '10px', color: '#ef4444' }} title="Threshold exceeded">⚠</span>
              )}

              {/* Remove button */}
              <button
                onClick={() => handleRemoveSignal(key)}
                style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}
                title={`Remove ${key}`}
              >×</button>
            </div>
          );
        })}

        {/* Add signal */}
        {selectedSignals.length < MAX_SIGNALS && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) toggleSignal(e.target.value); }}
            style={{
              background: '#1e293b', color: '#64748b',
              border: '1px dashed #334155', borderRadius: '4px',
              padding: '3px 8px', fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer',
            }}
          >
            <option value="">
              {availableSignals.length === 0 ? '- load DBC & connect -' : '+ add signal'}
            </option>
            {unselected.map((key) => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
        )}

        <div style={{ flex: 1 }} />
        
        {/* PNG Export - add this block */}
        {selectedSignals.length > 0 && (
        <button
            onClick={() => {
                const canvas = containerRef.current?.querySelector('canvas');
                if (!canvas) return;

                // Create offscreen canvas with extra height for the legend strip
                const legendH  = 20 + Math.ceil(selectedSignals.length / 3) * 20;
                const offscreen = document.createElement('canvas');
                offscreen.width  = canvas.width;
                offscreen.height = canvas.height + legendH;

                const ctx = offscreen.getContext('2d');
                if (!ctx) return;

                // Background
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, 0, offscreen.width, offscreen.height);

                // Draw the original plot
                ctx.drawImage(canvas, 0, 0);

                // Draw legend strip
                ctx.font      = '11px monospace';
                ctx.textBaseline = 'middle';
                const colW    = Math.floor(offscreen.width / Math.min(selectedSignals.length, 3));
                selectedSignals.forEach((key, i) => {
                    const col = i % 3;
                    const row = Math.floor(i / 3);
                    const x   = col * colW + 12;
                    const y   = canvas.height + 10 + row * 20;

                    // Colour dot
                    ctx.fillStyle = SIGNAL_COLORS[i % SIGNAL_COLORS.length];
                    ctx.beginPath();
                    ctx.arc(x + 4, y, 4, 0, Math.PI * 2);
                    ctx.fill();

                    // Signal name
                    ctx.fillStyle = '#e2e8f0';
                    ctx.fillText(key, x + 14, y);
                });

                offscreen.toBlob((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const a   = document.createElement('a');
                    a.href     = url;
                    a.download = `canviz_${selectedSignals[0]?.split('.')[0] ?? 'plot'}_${Date.now()}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                });
            }}
            title="Export plot as PNG"
            style={{
            background: 'none',
            border: '1px solid #334155',
            borderRadius: '4px',
            color: '#64748b',
            fontSize: '11px',
            fontFamily: 'monospace',
            padding: '3px 8px',
            cursor: 'pointer',
            }}
        >
            ↓ PNG
        </button>
        )}
        
        {/* Live / Paused indicator */}
        {selectedSignals.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            fontSize: '11px', fontFamily: 'monospace',
            color: isPaused ? '#f59e0b' : '#22c55e',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: isPaused ? '#f59e0b' : '#22c55e',
              boxShadow: isPaused ? 'none' : '0 0 6px #22c55e',
            }} />
            {isPaused ? 'PAUSED · double-click to resume' : 'LIVE'}
          </div>
        )}

        {/* Window selector */}
        <span style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>WINDOW</span>
        <select
          value={windowSec}
          onChange={(e) => setWindowSec(Number(e.target.value))}
          style={{
            background: '#1e293b', color: '#e2e8f0',
            border: '1px solid #334155', borderRadius: '4px',
            padding: '3px 8px', fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer',
          }}
        >
          <option value={10}>10s</option>
          <option value={30}>30s</option>
          <option value={60}>1m</option>
          <option value={300}>5m</option>
          <option value={1800}>30m</option>
        </select>
      </div>

      {/* Plot or empty state */}
      {selectedSignals.length > 0 ? (
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          style={{ cursor: isPaused ? 'zoom-out' : 'crosshair' }}
        />
      ) : (
        <div style={{
          height: '280px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#334155',
          fontSize: '12px', fontFamily: 'monospace',
          border: '1px dashed #1e293b', borderRadius: '4px',
        }}>
          {availableSignals.length === 0
            ? 'No decoded signals - load a DBC file then connect'
            : 'Add a signal above to begin plotting'}
        </div>
      )}
    </div>
  );
}