// Per-surface three.js meshes.
// Every surface is a mesh whose geometry is deformed on the CPU: each
// vertex's (u, v) content coordinate is run through the homography from the
// unit square to the surface's corner quad, so the texture is truly
// projectively warped (not the v1 horizontal-slice approximation).
// Stage space: normalized 0..1, y down. World space for the ortho camera is
// x = nx, y = 1 - ny (y up), z = curve displacement.
import * as THREE from 'three';
import type { Surface } from '../schema';
import { computeHomography, applyHomography, UNIT_QUAD } from '../homography';
import { defaultBlobPoints, defaultSilhouettePoints } from '../warp';
import {
  blendModeToThree,
  createMaskTexture,
  createMaskedMaterial,
  getMaskSpec,
  maskSignature,
  updateMaskedMaterial,
  type MaskSpec,
} from './masks';

export function surfaceCurve(surface: Surface): number {
  const c = (surface as unknown as { curve?: unknown }).curve;
  return typeof c === 'number' && Number.isFinite(c) ? Math.max(-1, Math.min(1, c)) : 0;
}

/** Deform a geometry in place: uv (u, v; v=1 at top) -> warped world pos. */
function deformGeometry(geom: THREE.BufferGeometry, surface: Surface): void {
  const h = computeHomography(UNIT_QUAD, surface.corners);
  if (!h) return; // degenerate quad: leave geometry as-is
  const pos = geom.attributes.position;
  const uv = geom.attributes.uv;
  if (!pos || !uv) return;
  const curve = surface.shape === 'curved' ? surfaceCurve(surface) : 0;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i);
    const sy = 1 - uv.getY(i); // top-down content coordinate
    const p = applyHomography(h, u, sy);
    let z = 0;
    if (curve !== 0) {
      z = curve * 0.08 * Math.sin(Math.PI * u) * Math.sin(Math.PI * sy);
    }
    pos.setXYZ(i, p.x, 1 - p.y, z);
  }
  pos.needsUpdate = true;
}

function roundedRectShape(): THREE.Shape {
  const s = new THREE.Shape();
  const r = 0.18;
  s.moveTo(r, 0);
  s.lineTo(1 - r, 0);
  s.absarc(1 - r, r, r, -Math.PI / 2, 0, false);
  s.lineTo(1, 1 - r);
  s.absarc(1 - r, 1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(r, 1);
  s.absarc(r, 1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(0, r);
  s.absarc(r, r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  return s;
}

function polygonShape(surface: Surface, fallback: () => { x: number; y: number }[]): THREE.Shape {
  const pts = surface.vertices && surface.vertices.length >= 3 ? surface.vertices : fallback();
  // Shape coords are y-up: local top-down (x, y) -> (x, 1 - y).
  const shape = new THREE.Shape();
  pts.forEach((p, i) => {
    const x = p.x;
    const y = 1 - p.y;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

/** Build the front-face geometry for a surface shape (before deformation). */
function buildFrontGeometry(surface: Surface): THREE.BufferGeometry {
  switch (surface.shape) {
    case 'circle':
    case 'ellipse':
      return new THREE.CircleGeometry(0.5, 48);
    case 'rounded-rect':
      return new THREE.ShapeGeometry(roundedRectShape(), 8);
    case 'polygon':
      return new THREE.ShapeGeometry(polygonShape(surface, defaultBlobPoints), 4);
    case 'freeform':
    case 'freehand':
      return new THREE.ShapeGeometry(polygonShape(surface, defaultBlobPoints), 4);
    case 'silhouette':
      return new THREE.ShapeGeometry(polygonShape(surface, defaultSilhouettePoints), 4);
    default:
      // rect, square, text, cube, box, curved
      return new THREE.PlaneGeometry(1, 1, 32, 32);
  }
}

/** A quad (two triangles) in world space, for cube/box side faces. */
function quadGeometry(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const verts = new Float32Array([
    a.x, a.y, 0, b.x, b.y, 0, c.x, c.y, 0,
    a.x, a.y, 0, c.x, c.y, 0, d.x, d.y, 0,
  ]);
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geom;
}

/** World-space point of a normalized corner (y flipped for the ortho camera). */
function worldPt(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x, y: 1 - p.y };
}

export interface SurfaceMesh {
  group: THREE.Group;
  front: THREE.Mesh;
  material: THREE.ShaderMaterial;
  maskTexture: THREE.CanvasTexture | null;
  maskSpec: MaskSpec | null;
  maskKey: string;
  key: string;
}

export function surfaceGeometryKey(surface: Surface): string {
  const c = surface.corners.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(';');
  const v = surface.vertices ? surface.vertices.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';') : '';
  return `${surface.shape}|${c}|${v}|${surfaceCurve(surface).toFixed(3)}`;
}

/** Build a surface's mesh group (front face + cube/box side faces). */
export function buildSurfaceMesh(surface: Surface, texture: THREE.Texture): SurfaceMesh {
  const group = new THREE.Group();
  const maskSpec = getMaskSpec(surface);
  const maskTexture = createMaskTexture(surface);
  const material = createMaskedMaterial(texture, maskTexture, maskSpec, {
    opacity: surface.opacity,
    blendMode: surface.blendMode ?? 'normal',
  });
  const geom = buildFrontGeometry(surface);
  deformGeometry(geom, surface);
  const front = new THREE.Mesh(geom, material);
  front.renderOrder = (surface.z ?? 1) * 10;
  group.add(front);

  if (surface.shape === 'cube' || surface.shape === 'box') {
    const depth = surface.shape === 'box' ? 0.05 : 0.03;
    const [tl, tr, br] = surface.corners.map(worldPt);
    const off = { x: depth, y: depth }; // up-right in world space
    const add = (p: { x: number; y: number }) => ({ x: p.x + off.x, y: p.y + off.y });
    const topMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: surface.opacity * 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: blendModeToThree(surface.blendMode ?? 'normal'),
    });
    const sideMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: surface.opacity * 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: blendModeToThree(surface.blendMode ?? 'normal'),
    });
    const top = new THREE.Mesh(quadGeometry(tl, add(tl), add(tr), tr), topMat);
    const side = new THREE.Mesh(quadGeometry(tr, add(tr), add(br), br), sideMat);
    top.renderOrder = (surface.z ?? 1) * 10 + 1;
    side.renderOrder = (surface.z ?? 1) * 10 + 1;
    group.add(top);
    group.add(side);
  }

  group.visible = surface.visible;
  return { group, front, material, maskTexture, maskSpec, maskKey: maskSignature(surface), key: surfaceGeometryKey(surface) };
}

/** Update material/visibility/z for an existing mesh; rebuild geometry if the key changed. */
export function updateSurfaceMesh(rec: SurfaceMesh, surface: Surface, texture: THREE.Texture): void {
  const key = surfaceGeometryKey(surface);
  if (key !== rec.key) {
    const oldGeom = rec.front.geometry;
    const geom = buildFrontGeometry(surface);
    deformGeometry(geom, surface);
    rec.front.geometry = geom;
    oldGeom.dispose();
    // Cube/box side faces depend on corners too — rebuild them.
    const extras = rec.group.children.filter((c) => c !== rec.front);
    extras.forEach((c) => {
      rec.group.remove(c);
      const mesh = c as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    if (surface.shape === 'cube' || surface.shape === 'box') {
      const fresh = buildSurfaceMesh(surface, texture);
      fresh.group.children
        .filter((c) => c !== fresh.front)
        .forEach((c) => rec.group.add(c));
      fresh.front.geometry.dispose();
      fresh.material.dispose();
      fresh.maskTexture?.dispose();
    }
    // Mask shape may have changed with the geometry (polygon vertices).
    const newSpec = getMaskSpec(surface);
    const newMask = createMaskTexture(surface);
    rec.maskTexture?.dispose();
    rec.maskTexture = newMask;
    rec.maskSpec = newSpec;
    rec.maskKey = maskSignature(surface);
    rec.key = key;
  }
  // Mask may also have changed without a geometry change (feather / invert
  // / opacity / mask kind / an image mask finishing its async load).
  const currentMaskKey = maskSignature(surface);
  if (currentMaskKey !== rec.maskKey) {
    const newSpec = getMaskSpec(surface);
    const newMask = createMaskTexture(surface);
    rec.maskTexture?.dispose();
    rec.maskTexture = newMask;
    rec.maskSpec = newSpec;
    rec.maskKey = currentMaskKey;
  }
  updateMaskedMaterial(rec.material, texture, rec.maskTexture, rec.maskSpec, {
    opacity: surface.opacity,
    blendMode: surface.blendMode ?? 'normal',
  });
  rec.front.renderOrder = (surface.z ?? 1) * 10;
  rec.group.visible = surface.visible;
}

export function disposeSurfaceMesh(rec: SurfaceMesh): void {
  rec.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
  rec.maskTexture?.dispose();
}
