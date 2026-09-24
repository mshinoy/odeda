import { EChart } from "@/charts/EChart";
import type { ChartOption } from "@/charts/echarts";

interface StreamChartProps {
  /** The metric's 1-2 word label, shown above the plot instead of a legend. */
  label: string;
  option: ChartOption;
  xValues: readonly number[];
  hoverIndex: number | null;
  onHoverIndex: (index: number | null) => void;
  height?: number;
}

const DEFAULT_HEIGHT = 150;

export function StreamChart({
  label,
  option,
  xValues,
  hoverIndex,
  onHoverIndex,
  height = DEFAULT_HEIGHT,
}: StreamChartProps) {
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
      <EChart
        option={option}
        height={height}
        xValues={xValues}
        hoverIndex={hoverIndex}
        onHoverIndex={onHoverIndex}
      />
    </figure>
  );
}
