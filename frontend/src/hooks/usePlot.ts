import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

export function usePlot(
  opts: uPlot.Options,
  data: uPlot.AlignedData,
  optsDeps: React.DependencyList = [],
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef      = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    plotRef.current?.destroy();
    plotRef.current = new uPlot(opts, data, containerRef.current);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, optsDeps);

  // Update data without rebuilding - cheap redraw
  useEffect(() => {
    if (plotRef.current && data[0].length > 0) {
      plotRef.current.setData(data);
    }
  }, [data]);

  return { containerRef, plotRef };
}