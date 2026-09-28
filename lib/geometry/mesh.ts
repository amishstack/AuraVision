import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { BoundingBox, Landmark } from "@/types/vision";

export interface Connection {
  start: number;
  end: number;
}

/**
 * MediaPipe ships canonical connection lists as statics on FaceLandmarker.
 * We layer them into visual tiers so the renderer can stay minimal rather
 * than plotting all ~2800 tessellation edges.
 */
export const MESH = {
  tesselation: FaceLandmarker.FACE_LANDMARKS_TESSELATION as Connection[],
  contours: FaceLandmarker.FACE_LANDMARKS_CONTOURS as Connection[],
  faceOval: FaceLandmarker.FACE_LANDMARKS_FACE_OVAL as Connection[],
  leftEye: FaceLandmarker.FACE_LANDMARKS_LEFT_EYE as Connection[],
  rightEye: FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE as Connection[],
  leftBrow: FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW as Connection[],
  rightBrow: FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW as Connection[],
  lips: FaceLandmarker.FACE_LANDMARKS_LIPS as Connection[],
  leftIris: FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS as Connection[],
  rightIris: FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS as Connection[],
};

/**
 * Sparse scaffold built by striding the tessellation — gives the mesh
 * structure without the noise of the full triangulation.
 */
export function sparseScaffold(stride = 6): Connection[] {
  const out: Connection[] = [];
  for (let i = 0; i < MESH.tesselation.length; i += stride) {
    out.push(MESH.tesselation[i]);
  }
  return out;
}

export type Triangle = readonly [number, number, number];

/**
 * Triangle list reconstructed once from the tessellation edge list.
 * The edge constant lists each triangle's perimeter; we recover faces by
 * finding closed 3-cliques in the undirected adjacency graph.
 * Result: ~930 triangles covering the canonical face surface.
 */
let triCache: Triangle[] | null = null;
export function faceTriangles(): Triangle[] {
  if (triCache) return triCache;
  const adj = new Map<number, Set<number>>();
  const link = (u: number, v: number) => {
    let s = adj.get(u);
    if (!s) adj.set(u, (s = new Set()));
    s.add(v);
  };
  for (const e of MESH.tesselation) {
    link(e.start, e.end);
    link(e.end, e.start);
  }
  const tris: Triangle[] = [];
  for (const [a, sa] of adj) {
    for (const b of sa) {
      if (b <= a) continue;
      const sb = adj.get(b)!;
      for (const c of sa) {
        if (c > b && sb.has(c)) tris.push([a, b, c]);
      }
    }
  }
  triCache = tris;
  return tris;
}

export function boundingBoxOf(lm: Landmark[]): BoundingBox | null {
  if (lm.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Normalized face area — used to pick the most prominent face. */
export function faceArea(lm: Landmark[]): number {
  const bb = boundingBoxOf(lm);
  return bb ? bb.w * bb.h : 0;
}
