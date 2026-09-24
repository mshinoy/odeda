// The one ECharts instance the app uses, built from `echarts/core` with only the parts
// the charts need, so the bundle carries a line chart and not the whole library.
import { LineChart, type LineSeriesOption } from "echarts/charts";
import {
  AxisPointerComponent,
  GridComponent,
  TooltipComponent,
  type AxisPointerComponentOption,
  type GridComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import * as echarts from "echarts/core";
import type { ComposeOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, GridComponent, TooltipComponent, AxisPointerComponent, CanvasRenderer]);

/** An option object limited to what is registered above (grid brings xAxis/yAxis). */
export type ChartOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption | AxisPointerComponentOption
>;

export type ChartInstance = echarts.EChartsType;

export { echarts };
