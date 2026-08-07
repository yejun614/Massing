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
 * Centre the camera on a box already expressed in scene pixels.
 *
 * Preferred over `fitToBox` whenever the scene has been rendered: the grid
 * bounding rectangle projects to a diamond whose bounding box is far larger
 * than the content inside it, so fitting to it leaves the diagram visibly
 * off-centre.
 *
 * @param {{x:number,y:number,width:number,height:number}} box
 */
export function fitToSceneBox(cam, box, viewport, padding = 60) {
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
 */
export function fitToBox(cam, box, viewport, padding = 80) {
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
    MAX_ZOOM
  );
  return {
    ...cam,
    zoom,
    tx: viewport.width / 2 - ((minX + maxX) / 2) * zoom,
    ty: viewport.height / 2 - ((minY + maxY) / 2) * zoom,
  };
}

