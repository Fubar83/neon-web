// Neon line art: thick glowing lines (Line2 family) drawn in screen pixels, made to bloom.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

export type Pts = THREE.Vector3[];

const materials: LineMaterial[] = [];
let pixelScale = 1;

/** Keep every line material's resolution in step with the canvas (thickness is in pixels at 720p). */
export function setLineResolution(w: number, h: number) {
  pixelScale = h / 720;
  for (const m of materials) {
    m.resolution.set(w, h);
    m.linewidth = (m.userData.baseWidth as number) * pixelScale;
  }
}

export function lineMaterial(color: THREE.ColorRepresentation, width: number, intensity = 1, opacity = 1): LineMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const m = new LineMaterial({ color: c, linewidth: width * pixelScale, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  m.userData.baseWidth = width;
  m.resolution.set(window.innerWidth, window.innerHeight);
  materials.push(m);
  return m;
}

export function disposeMaterial(m: LineMaterial) {
  const i = materials.indexOf(m);
  if (i >= 0) materials.splice(i, 1);
  m.dispose();
}

/** A set of line segments (pairs of points). */
export function segments(pairs: number[], mat: LineMaterial): LineSegments2 {
  const g = new LineSegmentsGeometry();
  g.setPositions(pairs);
  const l = new LineSegments2(g, mat);
  l.computeLineDistances();
  return l;
}

/** Closed or open polylines turned into segments. */
export function polylines(paths: Pts[], closed: boolean[] | boolean, mat: LineMaterial): LineSegments2 {
  const pairs: number[] = [];
  paths.forEach((p, i) => {
    const c = Array.isArray(closed) ? closed[i] : closed;
    const n = p.length;
    for (let k = 0; k + 1 < n + (c ? 1 : 0); k++) {
      const a = p[k], b = p[(k + 1) % n];
      pairs.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });
  return segments(pairs, mat);
}

/** Wireframe of any solid (its hard edges). */
export function wire(geo: THREE.BufferGeometry, mat: LineMaterial, angle = 1): LineSegments2 {
  const e = new THREE.EdgesGeometry(geo, angle);
  const g = new LineSegmentsGeometry().fromEdgesGeometry(e);
  e.dispose();
  geo.dispose();
  return new LineSegments2(g, mat);
}

// --- 2D outlines (in the XY plane, centred) ---
export function polygon(n: number, r: number, phase = Math.PI / 2, z = 0): Pts {
  return Array.from({ length: n }, (_, i) => new THREE.Vector3(Math.cos(phase + (i / n) * Math.PI * 2) * r, Math.sin(phase + (i / n) * Math.PI * 2) * r, z));
}
export function star(n: number, r: number, inner: number, z = 0): Pts {
  const out: Pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * inner : r;
    out.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, z));
  }
  return out;
}
export function cog(teeth: number, r: number, inner = 0.84, z = 0): Pts {
  const out: Pts = [];
  const ri = r * inner;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, w = (Math.PI * 2) / teeth;
    for (const [f, rr] of [[0, ri], [0.15, r], [0.5, r], [0.65, ri]] as const) {
      const a = a0 + w * f;
      out.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, z));
    }
  }
  return out;
}
export function circle(r: number, n = 48, z = 0): Pts {
  return polygon(n, r, 0, z);
}
export function cross(r: number, arm: number, z = 0): Pts {
  const a = arm;
  const p = [[a, r], [a, a], [r, a], [r, -a], [a, -a], [a, -r], [-a, -r], [-a, -a], [-r, -a], [-r, a], [-a, a], [-a, r]];
  return p.map(([x, y]) => new THREE.Vector3(x, y, z));
}
