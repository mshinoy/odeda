// Font sizes in px for text drawn on canvas (ECharts axes, tooltips), where CSS classes
// don't reach. Keep in step with the `--text-*` scale in src/index.css.
export const fontSize = {
  caption: 13, // text-xs: axis labels, captions
  body: 15, // text-sm: tooltips, controls
} as const;

export const fontFamily = "'Geist Variable', system-ui, sans-serif";
