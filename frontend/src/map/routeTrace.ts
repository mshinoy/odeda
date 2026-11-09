// A route as an SVG path, for a card when there is no Mapbox to draw it on a map.

/**
 * The `d` of a path fitting `[lat, lon]` points into a `width` x `height` box, centred
 * and keeping their shape. Longitude is narrowed by the cosine of the latitude, which is
 * exact enough over the few kilometres of one activity. Empty for fewer than 2 points.
 */
export function traceSvgPath(
  points: readonly [number, number][],
  width: number,
  height: number,
  padding: number,
): string {
  return traceSvgPaths([points], width, height, padding);
}

/**
 * `traceSvgPath` for a route recorded in pieces: all of them fit one box together, and each
 * starts its own subpath, so no line joins the end of one piece to the start of the next.
 */
export function traceSvgPaths(
  pieces: readonly (readonly [number, number][])[],
  width: number,
  height: number,
  padding: number,
): string {
  const usable = pieces.filter((piece) => piece.length >= 2);
  const points = usable.flat();
  if (points.length < 2) return "";
  const midLat = points.reduce((sum, [lat]) => sum + lat, 0) / points.length;
  const scaleX = Math.cos((midLat * Math.PI) / 180);
  const xs = points.map(([, lon]) => lon * scaleX);
  const ys = points.map(([lat]) => lat);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = maxY - Math.min(...ys);
  const span = Math.max(spanX, spanY);
  if (span === 0) return "";
  const scale = Math.min(
    (width - 2 * padding) / (spanX || span),
    (height - 2 * padding) / (spanY || span),
  );
  // Centre the drawing in the box; north is up, so y grows as latitude falls.
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const project = ([lat, lon]: readonly [number, number]) => {
    const px = offsetX + (lon * scaleX - minX) * scale;
    const py = offsetY + (maxY - lat) * scale;
    return `${px.toFixed(1)} ${py.toFixed(1)}`;
  };
  return usable
    .map((piece) => piece.map((point, i) => `${i === 0 ? "M" : "L"}${project(point)}`).join(" "))
    .join(" ");
}
