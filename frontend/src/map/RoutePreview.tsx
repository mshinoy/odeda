// A route's shape as a picture: Mapbox's static image where there is a token, the bare
// trace drawn as SVG where there is not. Used by the activity cards and the route list,
// which is why it lives here rather than under either of them.
import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/design/theme";
import { decodePolyline } from "@/lib/polyline";
import { cn } from "@/lib/utils";
import { traceSvgPath } from "@/map/routeTrace";
import { staticMapUrl } from "@/map/staticMap";

const TRACE_PADDING = 16;

interface RoutePreviewProps {
  /** Google encoded polyline, precision 5. */
  polyline: string;
  /** `#rrggbb` from the design tokens — the sport's colour, usually. */
  color: string;
  /** CSS pixels. The image is requested at twice this for sharp screens. */
  width: number;
  height: number;
}

/**
 * The route on a Mapbox static map, fading in over a placeholder once it has loaded;
 * the bare trace without a token, or if the image fails.
 */
export function RoutePreview({ polyline, color, width, height }: RoutePreviewProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  // Keyed by URL, so a theme switch shows the placeholder again until the new image is in.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const src = staticMapUrl({ polyline, theme, color, width, height });

  if (!src || failed) {
    return <RouteTrace polyline={polyline} color={color} width={width} height={height} />;
  }

  const loaded = loadedSrc === src;
  return (
    <div className="relative h-full w-full">
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        width={width}
        height={height}
        className={cn(
          "relative h-full w-full object-cover transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setLoadedSrc(src)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function RouteTrace({ polyline, color, width, height }: RoutePreviewProps) {
  const d = useMemo(
    () => traceSvgPath(decodePolyline(polyline), width, height, TRACE_PADDING),
    [polyline, width, height],
  );
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
