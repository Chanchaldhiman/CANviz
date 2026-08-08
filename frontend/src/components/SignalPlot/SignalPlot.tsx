import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import uPlot from 'uplot';
import { usePlot } from '../../hooks/usePlot';
import { usePlotRenderLoop } from '../../hooks/usePlotRenderLoop';
import { usePlotStore, SIGNAL_COLORS, MAX_SIGNALS, getLatestValue } from '../../store/plotStore';
import { useThemeStore } from '../../store/themeStore';

// ── Theme helper ─────────────────────────────────────────────────────────────
// Reads CSS custom properties at render time so uPlot canvas colours
// always match the active theme. Called inside useMemo so it re-runs
// whenever `theme` changes (triggering an opts rebuild → plot rebuild).
function getPlotTheme() {
  const s = getComputedStyle(document.documentElement);
  const get = (v: string, fallback: string) =>
    s.getPropertyValue(v).trim() || fallback;
  return {
    axis:   get('--plot-axis',   '#7a8494'),
    grid:   get('--plot-grid',   '#1c2028'),
    bg:     get('--plot-bg',     '#13161a'),
    panel:  get('--bg-elevated', '#13161a'),
    border: get('--border-subtle', '#1c2028'),
    pill:   get('--bg-elevated', '#13161a'),
    text:   get('--text-primary',   '#dce3eb'),
    muted:  get('--text-secondary', '#7a8494'),
    inputBorder: get('--border-default', '#252b35'),
    emptyBorder: get('--border-subtle',  '#1c2028'),
    emptyText:   get('--text-muted',     '#3d4554'),
  };
}

export function SignalPlot() {
  const selectedSignals  = usePlotStore((s) => s.selectedSignals);
  const availableSignals = usePlotStore((s) => s.availableSignals);
  const toggleSignal     = usePlotStore((s) => s.toggleSignal);
  const windowSec        = usePlotStore((s) => s.windowSec);
  const setWindowSec     = usePlotStore((s) => s.setWindowSec);

  // Subscribe to theme so opts rebuild on switch
  const theme = useThemeStore((s) => s.theme);

  // ── Pause / drag state ──────────────────────────────────────────────────
  const isPausedRef   = useRef(false);
  const dragStartXRef = useRef<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const onPausedChange = useCallback((paused: boolean) => setIsPaused(paused), []);

  // ── Threshold state ─────────────────────────────────────────────────────
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const thresholdsRef = useRef<Record<string, number>>({});
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
    const next = { ...thresholdsRef.current };
    delete next[key];
    thresholdsRef.current = next;
    setThresholds(next);
  };

  // Breach detection - 10 Hz
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

  // ── uPlot opts (rebuilt when signals or theme changes) ──────────────────
  const unselected = availableSignals.filter((k) => !selectedSignals.includes(k));

  const emptyData: uPlot.AlignedData = useMemo(
    () => [[], ...selectedSignals.map(() => [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSignals.length],
  );

  const opts: uPlot.Options = useMemo(() => {
    // Read CSS vars fresh each time - captures both initial and switched theme
    const pt = getPlotTheme();
    return {
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
        { stroke: pt.axis, ticks: { stroke: pt.grid }, grid: { stroke: pt.grid } },
        { stroke: pt.axis, ticks: { stroke: pt.grid }, grid: { stroke: pt.grid } },
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

            const yPos       = Math.round(u.valToPos(threshold, 'y', true));
            const isBreached = breachedRef.current.has(key);
            const baseColor  = SIGNAL_COLORS[si % SIGNAL_COLORS.length];
            const lineColor  = isBreached ? 'var(--accent-red, #ef4444)' : baseColor;

            ctx.save();
            ctx.strokeStyle = isBreached ? '#ef4444' : baseColor;
            ctx.globalAlpha = isBreached ? 1 : 0.7;
            ctx.lineWidth   = 1.5;
            ctx.setLineDash([6, 3]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, yPos);
            ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
            ctx.stroke();

            ctx.globalAlpha = 1;
            ctx.fillStyle   = isBreached ? '#ef4444' : baseColor;
            ctx.font        = '10px monospace';
            ctx.textAlign   = 'right';
            ctx.fillText(
              String(threshold),
              u.bbox.left + u.bbox.width - 4,
              yPos - 4,
            );
            ctx.restore();

            void lineColor; // suppress unused warning
          }
        }],
      },
    };
  // theme is the key dep - forces opts rebuild when switching modes
  // thresholdsRef and breachedRef are stable refs, intentionally excluded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSignals, theme]);

  const { containerRef, plotRef } = usePlot(opts, emptyData, [selectedSignals.join(','), theme]);
  usePlotRenderLoop(plotRef, selectedSignals, windowSec, isPausedRef, onPausedChange);

  // ── Drag / zoom handlers ────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => { dragStartXRef.current = e.clientX; };
  const handleMouseUp   = (e: React.MouseEvent) => {
    if (dragStartXRef.current !== null && Math.abs(e.clientX - dragStartXRef.current) > 5) {
      isPausedRef.current = true;
      setIsPaused(true);
    }
    dragStartXRef.current = null;
  };
  const handleDoubleClick = () => { isPausedRef.current = false; setIsPaused(false); };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--bg-elevated)',
      borderRadius: '8px',
      border: '1px solid var(--border-subtle)',
    }}>

      {/* Header - signal pills + controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>

        {selectedSignals.map((key, i) => {
          const isBreached = breached.has(key);
          const color      = SIGNAL_COLORS[i % SIGNAL_COLORS.length];
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: 'var(--bg-panel)',
              border: `1px solid ${isBreached ? 'var(--accent-red)' : color + '40'}`,
              borderRadius: '4px',
              padding: '2px 4px 2px 7px',
              transition: 'border-color 0.2s',
            }}>
              {/* Colour dot */}
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />

              {/* Signal name */}
              <span style={{
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'var(--text-primary)',
              }}>{key}</span>

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
                  borderLeft: `1px solid ${isBreached ? 'var(--accent-red)' : 'var(--border-default)'}`,
                  color: isBreached ? 'var(--accent-red)' : 'var(--text-secondary)',
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  padding: '0 4px',
                  outline: 'none',
                  marginLeft: '2px',
                }}
              />

              {/* Breach indicator */}
              {isBreached && (
                <span style={{ fontSize: '10px', color: 'var(--accent-red)' }} title="Threshold exceeded">⚠</span>
              )}

              {/* Remove button */}
              <button
                onClick={() => handleRemoveSignal(key)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  lineHeight: 1,
                  padding: '0 2px',
                }}
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
              background: 'var(--bg-panel)',
              color: 'var(--text-secondary)',
              border: '1px dashed var(--border-strong)',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              cursor: 'pointer',
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

        {/* PNG Export */}
        {selectedSignals.length > 0 && (
          <button
            onClick={() => {
              const canvas = containerRef.current?.querySelector('canvas');
              if (!canvas) return;

              const legendH   = 20 + Math.ceil(selectedSignals.length / 3) * 20;
              const offscreen = document.createElement('canvas');
              offscreen.width  = canvas.width;
              offscreen.height = canvas.height + legendH;

              const ctx = offscreen.getContext('2d');
              if (!ctx) return;

              // Use the current plot background token for the export canvas
              const pt = getPlotTheme();
              ctx.fillStyle = pt.bg;
              ctx.fillRect(0, 0, offscreen.width, offscreen.height);
              ctx.drawImage(canvas, 0, 0);

              ctx.font         = '11px monospace';
              ctx.textBaseline = 'middle';
              const colW = Math.floor(offscreen.width / Math.min(selectedSignals.length, 3));
              selectedSignals.forEach((key, i) => {
                const col = i % 3;
                const row = Math.floor(i / 3);
                const x   = col * colW + 12;
                const y   = canvas.height + 10 + row * 20;

                ctx.fillStyle = SIGNAL_COLORS[i % SIGNAL_COLORS.length];
                ctx.beginPath();
                ctx.arc(x + 4, y, 4, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = pt.text;
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
              border: '1px solid var(--border-default)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
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
            color: isPaused ? 'var(--accent-amber)' : 'var(--accent-green)',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: isPaused ? 'var(--accent-amber)' : 'var(--accent-green)',
              boxShadow: isPaused ? 'none' : '0 0 6px var(--accent-green-glow)',
            }} />
            {isPaused ? 'PAUSED · double-click to resume' : 'LIVE'}
          </div>
        )}

        {/* Window selector */}
        <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace' }}>
          WINDOW
        </span>
        <select
          value={windowSec}
          onChange={(e) => setWindowSec(Number(e.target.value))}
          style={{
            background: 'var(--bg-panel)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          <option value={10}>10s</option>
          <option value={30}>30s</option>
          <option value={60}>1m</option>
          <option value={300}>5m</option>
          <option value={1800}>30m</option>
        </select>
      </div>

      {/* Plot canvas or empty state */}
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
          height: '280px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '12px',
          fontFamily: 'monospace',
          border: '1px dashed var(--border-subtle)',
          borderRadius: '4px',
        }}>
          {availableSignals.length === 0
            ? 'No decoded signals - load a DBC file then connect'
            : 'Add a signal above to begin plotting'}
        </div>
      )}
    </div>
  );
}
