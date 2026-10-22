// The one ECharts instance the app uses, built from `echarts/core` with only the parts
// the charts need, so the bundle carries line and bar charts and not the whole library.
import {
  BarChart,
  LineChart,
  ScatterChart,
  type BarSeriesOption,
  type LineSeriesOption,
  type ScatterSeriesOption,
} from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  type AxisPointerComponentOption,
  type DataZoomComponentOption,
  type GridComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import * as echarts from "echarts/core";
import type { ComposeOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  // One point per session, where a connecting line would imply a continuity that is
  // not there: aerobic decoupling and efficiency factor.
  ScatterChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  // A series' `markLine`, for a fixed reference such as the 5 % decoupling limit.
  MarkLineComponent,
  // Drag-to-zoom on the Health charts, whose window can now be twelve years. Without
  // registering it ECharts drops a `dataZoom` option in silence — the config was in
  // three builders and did nothing at all.
  DataZoomComponent,
  CanvasRenderer,
]);

/** An option object limited to what is registered above (grid brings xAxis/yAxis). */
export type ChartOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | ScatterSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | AxisPointerComponentOption
  | DataZoomComponentOption
>;

export type ChartInstance = echarts.EChartsType;

export { echarts };
