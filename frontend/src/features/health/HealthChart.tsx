import type { ReactNode } from "react";
import { EChart } from "@/charts/EChart";
import type { ChartOption } from "@/charts/echarts";

interface HealthChartProps {
  /** 1-2 words above the chart. */
  label: string;
  option: ChartOption;
  height?: number;
  /** Anything that has to sit beside the label, such as a stacked chart's legend. */
  legend?: ReactNode;
}

export const HEALTH_CHART_HEIGHT = 180;

/** One metric, under its own label. Every chart on the Health page is one of these. */
export function HealthChart({
  label,
  option,
  height = HEALTH_CHART_HEIGHT,
  legend,
}: HealthChartProps) {
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-muted-foreground flex items-center gap-3 text-xs">
        {label}
        {legend}
      </figcaption>
      <EChart option={option} height={height} />
    </figure>
  );
}
