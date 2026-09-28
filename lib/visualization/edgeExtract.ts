/**
 * Lightweight client-side edge extraction for the captured optimal frame.
 *
 *   captured frame → downsample (~200px) → grayscale → 1px box blur
 *     → Sobel magnitude → soft threshold → tinted edge canvas
 *
 * Runs ONCE per capture (the result is cached by the caller — never per
 * frame). Pure canvas 2D: no dependencies, no upload, no inference. The
 * returned canvas is in the SAME coordinate space as the source image, so
 * any src-rect registration that applies to the photo applies to the
 * edges identically.
 */

const EDGE_W = 200;
// soft threshold on Sobel magnitude — keeps strong structure (glasses
// rims, brows, jaw, hairline) without noise
const EDGE_LO = 26;
const EDGE_HI = 95;

export function extractEdges(
  img: CanvasImageSource & { width: number; height: number },
): HTMLCanvasElement | null {
  if (!img.width || !img.height) return null;
  const w = EDGE_W;
  const h = Math.max(1, Math.round((img.height / img.width) * w));

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const wctx = work.getContext("2d", { willReadFrequently: true });
  if (!wctx) return null;
  wctx.drawImage(img, 0, 0, w, h);

  let srcData: Uint8ClampedArray;
  try {
    srcData = wctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  // grayscale + 1px box blur (suppress pixel noise before gradients)
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    g[i] = srcData[o] * 0.299 + srcData[o + 1] * 0.587 + srcData[o + 2] * 0.114;
  }
  const gb = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gb[i] =
        (g[i - 1] + g[i] + g[i + 1] +
          g[i - w] + g[i] + g[i + w] +
          g[i - w - 1] + g[i - w + 1] + g[i + w - 1] + g[i + w + 1]) / 9;
    }
  }

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!octx) return null;
  const imgData = octx.createImageData(w, h);
  const od = imgData.data;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gb[i - w - 1] - 2 * gb[i - 1] - gb[i + w - 1] +
        gb[i - w + 1] + 2 * gb[i + 1] + gb[i + w + 1];
      const gy =
        -gb[i - w - 1] - 2 * gb[i - w] - gb[i - w + 1] +
        gb[i + w - 1] + 2 * gb[i + w] + gb[i + w + 1];
      const m = Math.hypot(gx, gy);
      const a =
        m <= EDGE_LO ? 0 : m >= EDGE_HI ? 255 : ((m - EDGE_LO) / (EDGE_HI - EDGE_LO)) * 255;
      const o = i * 4;
      // cool white-cyan edge tint matching the signature palette
      od[o] = 185;
      od[o + 1] = 225;
      od[o + 2] = 242;
      od[o + 3] = a;
    }
  }
  octx.putImageData(imgData, 0, 0);
  return out;
}
