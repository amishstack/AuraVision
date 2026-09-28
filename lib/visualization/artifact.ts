import { projectTurntable, drawSignatureMesh } from "@/lib/visualization/meshRender";
import type { AnalysisReport } from "@/types/vision";

/**
 * Share artifact — renders the Visual Signature into a single portrait
 * canvas card (1080×1440) for native sharing. Geometry + text only; no
 * camera imagery is included unless the user explicitly shares it.
 */

const BG = "#0b0d0e";
const FG = "#e2e8f0";
const DIM = "#5b6470";
const FAINT = "#333a42";
const ACCENT = "#8cd2f0";

const W = 1080;
const H = 1440;

export function renderArtifact(report: AnalysisReport): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // subtle frame
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  const cx = W / 2;
  const mono = `"Geist Mono", "SFMono-Regular", Consolas, monospace`;

  ctx.textAlign = "center";

  // header
  ctx.fillStyle = DIM;
  ctx.font = `28px ${mono}`;
  ctx.fillText("A U R A V I S I O N", cx, 130);
  ctx.fillStyle = FG;
  ctx.font = `44px ${mono}`;
  ctx.fillText("VISUAL SIGNATURE", cx, 210);
  ctx.fillStyle = DIM;
  ctx.font = `22px ${mono}`;
  ctx.fillText("MONOCULAR FACIAL RECONSTRUCTION", cx, 252);

  // hero mesh
  if (report.signaturePoints) {
    const proj = projectTurntable(
      report.signaturePoints,
      -0.35,
      0.05,
      cx,
      560,
      300,
    );
    drawSignatureMesh(ctx, proj, 2);
  }

  ctx.fillStyle = DIM;
  ctx.font = `20px ${mono}`;
  ctx.fillText(
    `${report.landmarkCount} LANDMARKS · ${report.viewsCaptured} VIEWS · LOCAL ONLY`,
    cx,
    900,
  );

  // presence descriptors
  ctx.fillStyle = FG;
  ctx.font = `34px ${mono}`;
  ctx.fillText(report.presence.join("  ·  "), cx, 990);
  ctx.fillStyle = DIM;
  ctx.font = `19px ${mono}`;
  ctx.fillText("VISUAL PRESENCE — EXPERIMENTAL INTERPRETATION", cx, 1024);

  // structural signature
  const a = report.aesthetic;
  const rows: [string, number][] = [
    ["SYMMETRY", a.symmetry],
    ["PROPORTION", a.proportion],
    ["BALANCE", a.balance],
    ["FRAMING", a.framing],
    ["LIGHTING", a.lighting],
  ];
  let y = 1100;
  ctx.font = `22px ${mono}`;
  for (const [k, v] of rows) {
    ctx.fillStyle = DIM;
    ctx.textAlign = "left";
    ctx.fillText(k, 300, y);
    ctx.fillStyle = FG;
    ctx.textAlign = "right";
    ctx.fillText(String(v), 780, y);
    ctx.textAlign = "center";
    y += 44;
  }

  // aura + palette
  ctx.fillStyle = ACCENT;
  ctx.font = `26px ${mono}`;
  ctx.fillText(report.aura.join(" / "), cx, y + 30);
  ctx.fillStyle = DIM;
  ctx.font = `18px ${mono}`;
  ctx.fillText("AURA PROFILE — VISUAL INTERPRETATION", cx, y + 60);

  if (report.palette) {
    const n = report.palette.colors.length;
    const sw = 52, gap = 14;
    let px = cx - (n * sw + (n - 1) * gap) / 2;
    for (const col of report.palette.colors) {
      ctx.fillStyle = col;
      ctx.fillRect(px, y + 90, sw, sw);
      px += sw + gap;
    }
  }

  // footer
  ctx.fillStyle = DIM;
  ctx.font = `18px ${mono}`;
  ctx.fillText("LOCAL ONLY · NO FRAME UPLOAD", cx, H - 90);

  return c;
}

export async function artifactBlob(
  report: AnalysisReport,
): Promise<Blob | null> {
  const c = renderArtifact(report);
  return new Promise((res) => c.toBlob(res, "image/png"));
}
