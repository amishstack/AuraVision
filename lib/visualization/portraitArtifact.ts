import type { DirectorResult } from "@/types/vision";

/**
 * Portrait share artifact — renders the Director result into a portrait
 * card (1080×1620 story ratio). The captured frame IS included because
 * the user explicitly pressed SHARE for this artifact.
 */

const BG = "#0b0d0e";
const FG = "#e2e8f0";
const DIM = "#5b6470";
const FAINT = "#333a42";
const ACCENT = "#8cd2f0";

const W = 1080;
const H = 1620;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export async function renderPortraitArtifact(
  result: DirectorResult,
): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const mono = `"Geist Mono", "SFMono-Regular", Consolas, monospace`;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  const cx = W / 2;
  ctx.textAlign = "center";

  // header
  ctx.fillStyle = DIM;
  ctx.font = `28px ${mono}`;
  ctx.fillText("A U R A V I S I O N", cx, 140);
  ctx.fillStyle = FG;
  ctx.font = `48px ${mono}`;
  ctx.fillText("PORTRAIT READY", cx, 230);
  ctx.fillStyle = DIM;
  ctx.font = `20px ${mono}`;
  ctx.fillText("OPTIMIZED CAMERA COMPOSITION", cx, 272);

  // captured portrait — centered, cover-cropped
  let y = 320;
  if (result.frame) {
    const img = await loadImage(result.frame.image);
    const pw = 720;
    const ph = 720;
    const ix = cx - pw / 2;
    const srcAspect = img.width / img.height;
    const dstAspect = pw / ph;
    let sw = img.width, sh = img.height, sx = 0, sy = 0;
    if (srcAspect > dstAspect) {
      sw = sh * dstAspect;
      sx = (img.width - sw) / 2;
    } else {
      sh = sw / dstAspect;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, ix, y, pw, ph);
    ctx.strokeStyle = FAINT;
    ctx.strokeRect(ix, y, pw, ph);
    y += ph;
  }

  // portrait composition
  y += 80;
  ctx.fillStyle = DIM;
  ctx.font = `20px ${mono}`;
  ctx.fillText("PORTRAIT COMPOSITION", cx, y);
  y += 50;
  const rows: [string, string][] = [
    ["FRAMING", result.readiness.framing],
    ["LIGHTING", result.readiness.lighting],
    ["ANGLE", result.achievedView],
    ["STABILITY", result.readiness.stability],
    ["VISIBILITY", result.readiness.visibility],
  ];
  ctx.font = `24px ${mono}`;
  for (const [k, v] of rows) {
    ctx.fillStyle = DIM;
    ctx.textAlign = "left";
    ctx.fillText(k, 280, y);
    ctx.fillStyle = FG;
    ctx.textAlign = "right";
    ctx.fillText(v, 800, y);
    ctx.textAlign = "center";
    y += 46;
  }

  // aura
  y += 30;
  ctx.fillStyle = ACCENT;
  ctx.font = `26px ${mono}`;
  ctx.fillText(result.aura.join("  ·  "), cx, y);
  ctx.fillStyle = DIM;
  ctx.font = `18px ${mono}`;
  ctx.fillText("VISUAL INTERPRETATION", cx, y + 34);

  // footer
  ctx.fillStyle = DIM;
  ctx.font = `18px ${mono}`;
  ctx.fillText("MONOCULAR RGB — BROWSER-SIDE ANALYSIS", cx, H - 130);
  ctx.fillText("LOCAL ONLY · NO UPLOAD", cx, H - 96);

  return c;
}

export async function portraitArtifactBlob(
  result: DirectorResult,
): Promise<Blob | null> {
  const c = await renderPortraitArtifact(result);
  return new Promise((res) => c.toBlob(res, "image/png"));
}
