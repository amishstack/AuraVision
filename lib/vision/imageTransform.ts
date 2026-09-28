/**
 * Canonical coordinate-space transform — the single place where normalized
 * MediaPipe landmark coordinates are mapped onto displayed/captured pixels.
 *
 * Pipeline:
 *   source video space (videoWidth × videoHeight)
 *     → normalized landmark space (x,y ∈ [0,1], unmirrored, y-down)
 *       → displayed viewport space (object-fit: cover + CSS mirror)
 *       → captured sub-rect space (best-frame thumbnails, blend crops)
 *       → canvas pixels
 *
 * MIRRORING CONVENTION: `mirrored` always means "the rendered IMAGE is
 * horizontally flipped relative to the normalized coordinates". There is
 * exactly one rule — the flip applies within the rect actually drawn:
 *   - full-frame draw (object-cover video): x' = 1 − x
 *   - sub-rect draw (flipped thumbnail):    x' = rect.x + rect.w − x
 * Mirroring in full-frame space and THEN subtracting a crop origin is
 * wrong (off by 1 − 2·cropCenterX) — that was the registration bug.
 */

export interface CoverFit {
  scale: number;
  dispW: number;
  dispH: number;
  offX: number;
  offY: number;
}

/** Normalized source-space rectangle. */
export interface SourceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NormPoint {
  x: number;
  y: number;
}

/** object-fit: cover with centered object-position (the CSS default). */
export function coverFit(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): CoverFit {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const dispW = srcW * scale;
  const dispH = srcH * scale;
  return {
    scale,
    dispW,
    dispH,
    offX: (dstW - dispW) / 2,
    offY: (dstH - dispH) / 2,
  };
}

/**
 * Map a normalized video point through cover-fit into destination pixels.
 * `mirrored` = the element/image is flipped in displayed space (CSS
 * scaleX(-1) on the full video, or an already-flipped image).
 */
export function throughCover(
  p: NormPoint,
  fit: CoverFit,
  mirrored: boolean,
): readonly [number, number] {
  return [
    fit.offX + (mirrored ? 1 - p.x : p.x) * fit.dispW,
    fit.offY + p.y * fit.dispH,
  ] as const;
}

/**
 * Build a mapper for a normalized source sub-rect shown on a destination
 * of dstW×dstH pixels.
 *
 * `mirrored` means the sub-rect was flipped horizontally at draw time
 * (e.g. BestFrameEngine draws thumbnails under ctx.scale(-1,1)), so a
 * source x lands at rect.x + rect.w − x — NOT 1 − x.
 */
export function regionMapper(
  rect: SourceRect,
  dstW: number,
  dstH: number,
  mirrored: boolean,
): (p: NormPoint) => readonly [number, number] {
  const rxw = rect.x + rect.w;
  return (p) => [
    ((mirrored ? rxw - p.x : p.x - rect.x) / rect.w) * dstW,
    ((p.y - rect.y) / rect.h) * dstH,
  ] as const;
}

/**
 * Source-pixel rect for a center-cropped object-fit: cover draw into a
 * destination of dstW×dstH (share artifacts, portrait cards).
 */
export function coverSourceRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { x: number; y: number; w: number; h: number } {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  let w = srcW;
  let h = srcH;
  if (srcAspect > dstAspect) w = h * dstAspect;
  else h = w / dstAspect;
  return { x: (srcW - w) / 2, y: (srcH - h) / 2, w, h };
}

/** Normalized bounding box of a point set, mapped through `rect`+mirror. */
export function regionBounds(
  points: readonly NormPoint[],
  rect: SourceRect,
  mirrored: boolean,
): SourceRect | null {
  if (!points.length) return null;
  const map = regionMapper(rect, 1, 1, mirrored);
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const p of points) {
    const [x, y] = map(p);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
