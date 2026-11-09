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
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  type AxisPointerComponentOption,
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
  // The band a taper should land in, behind the form forecast.
  MarkAreaComponent,
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
>;

export type ChartInstance = echarts.EChartsType;

export { echarts };
