// Colour-vision simulation and difference, so a palette can be checked rather than
// assumed. Used by the palette test; nothing in the app renders through this.
//
// The simulation matrices are Machado, Oliveira and Fernandes (2009) at full severity,
// applied to linear-light RGB. The difference is CIE76 (Euclidean distance in CIE Lab)
// — coarser than CIEDE2000, but this asks "are these two obviously different colours",
// not "can a trained eye tell them apart", and CIE76 answers that without 60 lines of
// special cases.

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

export type Vision = "normal" | "protanopia" | "deuteranopia" | "tritanopia";

export const VISIONS: readonly Vision[] = ["normal", "protanopia", "deuteranopia", "tritanopia"];

type Matrix = readonly [Rgb, Rgb, Rgb];

const IDENTITY: Matrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const MATRICES: Record<Vision, Matrix> = {
  normal: IDENTITY,
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** "#rrggbb" to 0..1 sRGB components. */
export function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function apply(matrix: Matrix, [r, g, b]: Rgb): Rgb {
  return matrix.map(([mr, mg, mb]) => mr * r + mg * g + mb * b) as Rgb;
}

/** CIE Lab of an sRGB hex as that vision type sees it (D65, the sRGB white point). */
export function toLab(hex: string, vision: Vision = "normal"): Lab {
  const linear = parseHex(hex).map(toLinear) as Rgb;
  const [r, g, b] = apply(MATRICES[vision], linear);

  // Linear sRGB to XYZ, then XYZ to Lab, both textbook.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference between two hexes, as that vision type sees them. */
export function difference(a: string, b: string, vision: Vision = "normal"): number {
  const [l1, a1, b1] = toLab(a, vision);
  const [l2, a2, b2] = toLab(b, vision);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** The smallest difference between any two of these colours under that vision type. */
export function closestPair(
  colors: readonly string[],
  vision: Vision,
): { a: string; b: string; difference: number } {
  let worst = { a: "", b: "", difference: Infinity };
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = colors[i];
      const b = colors[j];
      if (a === undefined || b === undefined) continue;
      const gap = difference(a, b, vision);
      if (gap < worst.difference) worst = { a, b, difference: gap };
    }
  }
  return worst;
}
