// The one wrapper around ECharts. It wires hover both ways and nothing else:
//   chart -> app: the data index under the pointer (null when the pointer leaves);
//   app -> chart: a crosshair and tooltip at `hoverIndex`, drawn silently so it never
//   echoes back as a hover event.
import ReactEChartsCore from "echarts-for-react/esm/core";
import { useEffect, useMemo, useRef } from "react";
import { echarts, type ChartInstance, type ChartOption } from "@/charts/echarts";

interface EChartProps {
  option: ChartOption;
  height: number;
  /**
   * The x value of each data index. The crosshair is placed by x, not by index, because
   * sampling ("lttb") drops most indices from what is drawn.
   */
  xValues?: readonly number[];
  /** Where to show the crosshair; null hides it. Leave out for a chart with no shared hover. */
  hoverIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
}

const NO_X_VALUES: readonly number[] = [];

/** What `updateAxisPointer` carries when the pointer is over a data point. */
interface AxisPointerEvent {
  dataIndex?: number;
}

const RENDER_OPTS = { renderer: "canvas" } as const;

export function EChart({
  option,
  height,
  xValues = NO_X_VALUES,
  hoverIndex = null,
  onHoverIndex,
}: EChartProps) {
  const chartRef = useRef<ChartInstance | null>(null);
  // The index this chart last reported from the user's own pointer. When the app echoes it
  // back as `hoverIndex`, the chart already shows it and must not be moved again.
  const reportedIndexRef = useRef<number | null>(null);
  const onHoverIndexRef = useRef(onHoverIndex);

  useEffect(() => {
    onHoverIndexRef.current = onHoverIndex;
  }, [onHoverIndex]);

  // Stable across renders, so echarts-for-react does not rebind events on every hover.
  const onEvents = useMemo(() => {
    const report = (index: number | null) => {
      if (index === reportedIndexRef.current) return;
      reportedIndexRef.current = index;
      onHoverIndexRef.current?.(index);
    };
    return {
      updateAxisPointer: (event: AxisPointerEvent) => report(event.dataIndex ?? null),
      globalout: () => report(null),
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null || chart.isDisposed()) return;
    const isOwnReport = hoverIndex !== null && hoverIndex === reportedIndexRef.current;
    if (isOwnReport) return;

    const x = hoverIndex === null ? undefined : xValues[hoverIndex];
    if (x === undefined) {
      hideCrosshair(chart);
    } else {
      showCrosshairAt(chart, x);
    }
  }, [hoverIndex, xValues]);

  const style = useMemo(() => ({ height, width: "100%" }), [height]);

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      opts={RENDER_OPTS}
      style={style}
      onEvents={onEvents}
      onChartReady={(chart: ChartInstance) => {
        chartRef.current = chart;
      }}
    />
  );
}

// `silent` keeps these from firing `updateAxisPointer`, which would report the index back.
function showCrosshairAt(chart: ChartInstance, x: number): void {
  const pixelX = chart.convertToPixel({ xAxisIndex: 0 }, x);
  // Any y inside the plot works for an axis-triggered tooltip; the middle always is.
  const pixelY = chart.getHeight() / 2;
  chart.dispatchAction({ type: "showTip", x: pixelX, y: pixelY }, { silent: true });
}

function hideCrosshair(chart: ChartInstance): void {
  chart.dispatchAction({ type: "hideTip" }, { silent: true });
  chart.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" }, { silent: true });
}
