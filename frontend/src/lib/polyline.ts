// Google's encoded polyline format (precision 5), which the activity list sends each
// card's route in. Decoded only where there is no Mapbox to draw it (see staticMap.ts).

/** What separates the recorded pieces of one route in the previews payload. */
export const PIECE_SEPARATOR = ";";

/**
 * A route that crossed a recording gap arrives as its recorded pieces joined by `;`.
 * Each piece is decoded on its own, so nothing is drawn across the gap.
 */
export function decodePolylinePieces(encoded: string): [number, number][][] {
  return encoded
    .split(PIECE_SEPARATOR)
    .filter((piece) => piece !== "")
    .map(decodePolyline);
}

/** `[lat, lon]` pairs, in order. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    const dLat = readValue();
    const dLon = readValue();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points;

  /** One zig-zag varint, or null when the string ends inside it. */
  function readValue(): number | null {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length) return null;
      const byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}
