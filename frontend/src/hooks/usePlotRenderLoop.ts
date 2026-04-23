import { useEffect, type MutableRefObject } from 'react';
import type uPlot from 'uplot';
import { getSignalBuffer, readBuffer, DISPLAY_POINTS, getLatestTimestamp } from '../store/plotStore';
import { lttb } from '../utils/lttb';

const TARGET_HZ          = 10;
const FRAME_BUDGET       = 1000 / TARGET_HZ;
const RESUME_THRESHOLD_SEC = 2;

function clipToWindow(
  ts: Float64Array,
  vs: Float32Array,
  windowSec: number,
): [Float64Array, Float32Array] {
  if (ts.length === 0) return [ts, vs];
  const cutoff = ts[ts.length - 1] - windowSec;
  let lo = 0, hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < cutoff) lo = mid + 1; else hi = mid;
  }
  return lo === 0 ? [ts, vs] : [ts.subarray(lo), vs.subarray(lo)];
}

function buildAlignedData(
  keys: string[],
  windowSec: number,
): uPlot.AlignedData | null {
  if (keys.length === 0) return null;

  const perSignal: Array<{ ts: number[]; vs: number[] }> = [];
  for (const key of keys) {
    const buf = getSignalBuffer(key);
    if (!buf || buf.count === 0) { perSignal.push({ ts: [], vs: [] }); continue; }
    const [rawTs, rawVs] = readBuffer(buf);
    const [winTs, winVs] = clipToWindow(rawTs, rawVs, windowSec);
    if (winTs.length === 0) { perSignal.push({ ts: [], vs: [] }); continue; }
    const [dTs, dVs] = lttb(winTs, winVs, DISPLAY_POINTS);
    perSignal.push({ ts: dTs, vs: dVs });
  }

  const tsSet = new Set<number>();
  for (const { ts } of perSignal) for (const t of ts) tsSet.add(t);
  if (tsSet.size === 0) return null;

  const mergedTs = Array.from(tsSet).sort((a, b) => a - b);
  const aligned: uPlot.AlignedData = [mergedTs];
  for (const { ts, vs } of perSignal) {
    const map = new Map<number, number>();
    for (let i = 0; i < ts.length; i++) map.set(ts[i], vs[i]);
    aligned.push(mergedTs.map((t) => map.get(t) ?? null) as number[]);
  }

  return aligned;
}

export function usePlotRenderLoop(
  plotRef:         MutableRefObject<uPlot | null>,
  selectedSignals: string[],
  windowSec:       number,
  isPausedRef:     MutableRefObject<boolean>,
  onPausedChange:  (paused: boolean) => void,
) {
  useEffect(() => {
    if (selectedSignals.length === 0) return;

    let rafId: number;
    let cancelled  = false;
    let lastRender = performance.now() - FRAME_BUDGET;

    const loop = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);

      const now = performance.now();
      if (now - lastRender < FRAME_BUDGET) return;
      lastRender = now;

      const plot = plotRef.current;
      if (!plot) return;

      // Auto-resume when user has scrolled back to live edge
      if (isPausedRef.current) {
        const latestTs = getLatestTimestamp(selectedSignals);
        const xMax     = plot.scales.x?.max ?? 0;
        if (latestTs > 0 && xMax > 0 && latestTs - xMax < RESUME_THRESHOLD_SEC) {
          isPausedRef.current = false;
          onPausedChange(false);
        } else {
          return; // stay paused
        }
      }

      const data = buildAlignedData(selectedSignals, windowSec);
      if (!data) return;
      plot.setData(data);
    };

    const fireImmediate = () => {
      const plot = plotRef.current;
      if (!plot) return;
      const data = buildAlignedData(selectedSignals, windowSec);
      if (data) plot.setData(data);
    };

    rafId = requestAnimationFrame(() => { fireImmediate(); loop(); });
    return () => { cancelled = true; cancelAnimationFrame(rafId); };
  }, [selectedSignals, windowSec, plotRef, isPausedRef, onPausedChange]);
}