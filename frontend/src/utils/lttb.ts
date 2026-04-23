/**
 * Largest-Triangle-Three-Buckets downsampling.
 * Reduces n points to `threshold` points while preserving visual shape.
 * Operates on typed arrays for zero-copy performance.
 */
export function lttb(
  ts: Float64Array,
  vs: Float32Array,
  threshold: number,
): [number[], number[]] {
  const n = ts.length;
  if (n <= threshold) {
    return [Array.from(ts), Array.from(vs)];
  }

  const outTs: number[] = [ts[0]];
  const outVs: number[] = [vs[0]];

  const every = (n - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // Average point of the next bucket
    const avgStart = Math.floor((i + 1) * every) + 1;
    const avgEnd   = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0, avgY = 0;
    for (let j = avgStart; j < avgEnd; j++) { avgX += ts[j]; avgY += vs[j]; }
    avgX /= (avgEnd - avgStart);
    avgY /= (avgEnd - avgStart);

    // Find the point in the current bucket with the largest triangle area
    const buckStart = Math.floor(i * every) + 1;
    const buckEnd   = Math.floor((i + 1) * every) + 1;
    const ax = ts[a], ay = vs[a];
    let maxArea = -1, maxIdx = buckStart;

    for (let j = buckStart; j < buckEnd; j++) {
      const area = Math.abs((ax - avgX) * (vs[j] - ay) - (ax - ts[j]) * (avgY - ay));
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }

    outTs.push(ts[maxIdx]);
    outVs.push(vs[maxIdx]);
    a = maxIdx;
  }

  outTs.push(ts[n - 1]);
  outVs.push(vs[n - 1]);
  return [outTs, outVs];
}