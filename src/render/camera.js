/**
 * Camera: pan, zoom and 90-degree rotation on top of a projection.
 *
 * Zoom is a scale on the SVG root group rather than a change to CELL, so
 * polygon geometry never has to be recomputed while zooming.
 */

import { getProjection, rotatePoint, unrotatePoint } from '../geom/iso.js';
import { clamp, round2, round3 } from '../util/num.js';

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

export function createCamera() {
  return { tx: 0, ty: 0, zoom: 1, rot: 0, mode: 'iso' };
}

export function projectionOf(cam) {
  return getProjection(cam.mode);
}

export function cameraTransform(cam) {
  return `translate(${round2(cam.tx)} ${round2(cam.ty)}) scale(${round3(cam.zoom)})`;
}

/** Viewport pixels -> unzoomed scene pixels. */
export function screenToScene(cam, px, py) {
  return { x: (px - cam.tx) / cam.zoom, y: (py - cam.ty) / cam.zoom };
}

/** Unzoomed scene pixels -> viewport pixels. */
export function sceneToScreen(cam, x, y) {
  return { x: x * cam.zoom + cam.tx, y: y * cam.zoom + cam.ty };
}

/**
 * Viewport pixels -> document grid coordinates, on the horizontal plane at
 * height `z`. Returns fractional coordinates; callers snap as needed.
 */
export function screenToGrid(cam, px, py, z = 0) {
  const scene = screenToScene(cam, px, py);
  const p = projectionOf(cam).unproject(scene.x, scene.y, z);
  return unrotatePoint(p.x, p.y, cam.rot);
}

/** Document grid coordinates -> viewport pixels. */
export function gridToScreen(cam, x, y, z = 0) {
  const p = rotatePoint(x, y, cam.rot);
  const s = projectionOf(cam).project(p.x, p.y, z);
  return sceneToScreen(cam, s.x, s.y);
}

/** Zoom by `factor`, keeping the point under (px, py) stationary. */
export function zoomAt(cam, px, py, factor) {
  const zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const k = zoom / cam.zoom;
  return {
    ...cam,
    zoom,
    tx: px - (px - cam.tx) * k,
    ty: py - (py - cam.ty) * k,
  };
}

export function pan(cam, dx, dy) {
  return { ...cam, tx: cam.tx + dx, ty: cam.ty + dy };
}

export function rotate(cam, turns) {
  return { ...cam, rot: (((cam.rot + turns) % 4) + 4) % 4 };
}

/**
 * Margin to leave around a fitted diagram.
 *
 * A fixed 60px is a comfortable frame on a laptop and a third of the width of
 * a phone held upright, where the diagram then has to shrink to pay for a
 * border nobody asked for. Above a certain size the number stops mattering, so
 * it is capped rather than scaled all the way up.
 */
function breathingRoom(viewport, most) {
  return Math.min(most, viewport.width * 0.06, viewport.height * 0.06);
}

/**
 * Centre the camera on a box already expressed in scene pixels.
 *
 * Preferred over `fitToBox` whenever the scene has been rendered: the grid
 * bounding rectangle projects to a diamond whose bounding box is far larger
 * than the content inside it, so fitting to it leaves the diagram visibly
 * off-centre.
 *
 * @param {{x:number,y:number,width:number,height:number}} box
 */
export function fitToSceneBox(cam, box, viewport, padding = breathingRoom(viewport, 60)) {
  const w = Math.max(box.width, 1);
  const h = Math.max(box.height, 1);
  const zoom = clamp(
    Math.min((viewport.width - padding * 2) / w, (viewport.height - padding * 2) / h),
    MIN_ZOOM,
    MAX_ZOOM
  );
  return {
    ...cam,
    zoom,
    tx: viewport.width / 2 - (box.x + w / 2) * zoom,
    ty: viewport.height / 2 - (box.y + h / 2) * zoom,
  };
}

/**
 * Centre the camera on a grid-space bounding box. Used before the first
 * render, when there is nothing on screen to measure.
 *
 * @param {{x0:number,y0:number,x1:number,y1:number,zmax:number}} box
 * @param {{width:number,height:number}} viewport
 * @param {number} maxZoom
 *   How close this is allowed to get. Fitting the *diagram* wants the full
 *   range, so it is the range by default. Fitting one block does not: a 2x2
 *   cube alone on a wide screen fits at 4x, which is a wall of one colour with
 *   the caption off the bottom, and "show me that block" is not a request to
 *   see nothing else at all.
 */
export function fitToBox(
  cam,
  box,
  viewport,
  padding = breathingRoom(viewport, 80),
  maxZoom = MAX_ZOOM
) {
  const proj = projectionOf(cam);
  const corners = [];
  for (const [gx, gy] of [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]]) {
    const p = rotatePoint(gx, gy, cam.rot);
    corners.push(proj.project(p.x, p.y, 0));
    corners.push(proj.project(p.x, p.y, box.zmax || 0));
  }
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const zoom = clamp(
    Math.min((viewport.width - padding * 2) / w, (viewport.height - padding * 2) / h),
    MIN_ZOOM,
    Math.min(maxZoom, MAX_ZOOM)
  );
  return {
    ...cam,
    zoom,
    tx: viewport.width / 2 - ((minX + maxX) / 2) * zoom,
    ty: viewport.height / 2 - ((minY + maxY) / 2) * zoom,
  };
}

/**
 * A camera part of the way between two others.
 *
 * What is interpolated is *what is in the middle of the screen* and how far
 * away it is, rather than `tx`, `ty` and `zoom` one number at a time. The
 * difference is the whole of whether the motion reads: interpolating the
 * translations linearly while the zoom changes swings the subject out of frame
 * and back, because the translation that centres a point depends on the zoom
 * it is centred at. Following the centre point instead keeps the destination
 * pinned for the entire flight.
 *
 * Zoom moves geometrically — each frame multiplies by the same factor — so
 * 0.3 to 1.2 and 1.2 to 4.8 take the same time and feel like the same gesture.
 *
 * `to` decides everything else, so a rotation or a projection change committed
 * mid-flight arrives with it rather than being blended into something that is
 * neither.
 */
export function lerpCamera(from, to, t, viewport) {
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, t);
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const a = screenToScene(from, cx, cy);
  const b = screenToScene(to, cx, cy);
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  return { ...to, zoom, tx: cx - x * zoom, ty: cy - y * zoom };
}

