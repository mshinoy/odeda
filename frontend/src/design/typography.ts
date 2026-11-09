// Font sizes in px for text drawn on canvas (ECharts axes, tooltips), where CSS classes
// don't reach. Keep in step with the `--text-*` scale in src/index.css.
//
// The page's root font size follows the window (see `html` in index.css), so these are
// the scale's rem values times whatever the root is now. A chart drawn on a 27-inch
// screen then labels itself in proportion to the text beside it.
const CAPTION_REM = 0.9375; // text-xs: axis labels, captions
const BODY_REM = 1; // text-sm: tooltips, controls

const FALLBACK_ROOT_PX = 16;

function rootPx(): number {
  if (typeof document === "undefined") return FALLBACK_ROOT_PX;
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px : FALLBACK_ROOT_PX;
}

export const fontSize = {
  get caption(): number {
    return Math.round(CAPTION_REM * rootPx());
  },
  get body(): number {
    return Math.round(BODY_REM * rootPx());
  },
};

export const fontFamily = "'Geist Variable', system-ui, sans-serif";
