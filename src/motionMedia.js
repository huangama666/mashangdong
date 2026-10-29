/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
import { Vector3, Spherical } from 'three';

export function normalizeCaptureFrame(raw) {
  const valid = (n) => Number.isInteger(n) && n >= 64 && n <= 4096 && n % 2 === 0;
  if (!raw || !valid(raw.width) || !valid(raw.height) || raw.width / raw.height < 0.25 || raw.width / raw.height > 4) return { width: 1280, height: 720 };
  return { width: raw.width, height: raw.height };
}

export function fitMediaRect(sourceWidth, sourceHeight, width, height) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const fittedWidth = sourceWidth * scale;
  const fittedHeight = sourceHeight * scale;
  return { x: (width - fittedWidth) / 2, y: (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight };
}
export function normalizeMotionView(raw) {
  const vector = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n) && Math.abs(n) < 1000);
  if (!raw || !vector(raw.position) || !vector(raw.target) || !Number.isFinite(raw.fov) || raw.fov < 1 || raw.fov > 150) return undefined;
  if (Math.hypot(...raw.position.map((n, i) => n - raw.target[i])) < 0.01) return undefined;
  const view = { position: [...raw.position], target: [...raw.target], fov: raw.fov };
  if (raw.frame !== undefined) view.frame = normalizeCaptureFrame(raw.frame);
  if (Number.isFinite(raw.zoom) && raw.zoom >= 0.1 && raw.zoom <= 10) view.zoom = raw.zoom;
  if (Number.isFinite(raw.filmGauge) && raw.filmGauge >= 10 && raw.filmGauge <= 100) view.filmGauge = raw.filmGauge;
  if (Number.isFinite(raw.focalLength) && raw.focalLength >= 10 && raw.focalLength <= 300) {
    view.focalLength = raw.focalLength;
    view.filmGauge ??= 36;
    const frame = normalizeCaptureFrame(view.frame);
    const filmHeight = view.filmGauge / Math.max(frame.width / frame.height, 1);
    view.fov = 2 * Math.atan(filmHeight / (2 * view.focalLength)) * 180 / Math.PI;
  }
  return view;
}

export function captureCameraView(camera, target, frame) {
  const capturedFrame = normalizeCaptureFrame(frame);
  // The editor projection follows the window, while the shot keeps its original
  // fixed capture frame. Derive the lens from that frame without changing FOV.
  const filmHeight = camera.filmGauge / Math.max(capturedFrame.width / capturedFrame.height, 1);
  const focalLength = 0.5 * filmHeight / Math.tan(camera.fov * Math.PI / 360);
  return normalizeMotionView({ position: camera.position.toArray(), target: target.toArray(), fov: camera.fov, focalLength, filmGauge: camera.filmGauge, zoom: camera.zoom, frame: capturedFrame });
}

export function restoreCameraView(camera, target, raw) {
  const view = normalizeMotionView(raw);
  if (!view) return undefined;
  const frame = normalizeCaptureFrame(view.frame);
  camera.clearViewOffset();
  camera.aspect = frame.width / frame.height;
  camera.filmGauge = view.filmGauge ?? 36;
  camera.zoom = view.zoom ?? 1;
  camera.position.fromArray(view.position);
  target.fromArray(view.target);
  camera.fov = view.fov;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return view;
}

export function interpolateMotionView(from, to, t) {
  const a = normalizeMotionView(from);
  const b = normalizeMotionView(to);
  if (!a || !b) return a || b;
  if (t <= 0) return a;
  if (t >= 1) return b;
  const target = a.target.map((n, i) => n + (b.target[i] - n) * t);
  const direction = (view) => new Spherical().setFromVector3(new Vector3().fromArray(view.position).sub(new Vector3().fromArray(view.target)));
  const start = direction(a);
  const end = direction(b);
  const turn = Math.atan2(Math.sin(end.theta - start.theta), Math.cos(end.theta - start.theta));
  const offset = new Vector3().setFromSpherical(new Spherical(start.radius + (end.radius - start.radius) * t, start.phi + (end.phi - start.phi) * t, start.theta + turn * t));
  const view = { position: offset.add(new Vector3().fromArray(target)).toArray(), target, fov: a.fov + (b.fov - a.fov) * t };
  if (a.frame || b.frame) view.frame = normalizeCaptureFrame(a.frame || b.frame);
  for (const key of ['focalLength', 'filmGauge', 'zoom']) {
    if (Number.isFinite(a[key]) && Number.isFinite(b[key])) view[key] = a[key] + (b[key] - a[key]) * t;
  }
  return normalizeMotionView(view);
}

export function withCaptureProjection(camera, aspect, draw) {
  const view = camera.view ? { ...camera.view } : null;
  const previousAspect = camera.aspect;
  try {
    camera.clearViewOffset();
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return draw();
  } finally {
    camera.view = view;
    camera.aspect = previousAspect;
    camera.updateProjectionMatrix();
  }
}

// Durably store and publish the segment before attempting browser decoding.
// A slow/unsupported preview must never discard an otherwise saved recording.
export async function commitRecordedClip({ store, id, blob, elapsed, thumbnail, commit }) {
  await store.save(id, blob);
  const frame = { id, kind: 'video', clipId: id, duration: Math.min(180, Math.max(0.1, elapsed)), thumbnail };
  commit(frame);
  try {
    const asset = await store.load(id);
    if (Number.isFinite(asset.video.duration) && asset.video.duration > 0) frame.duration = Math.min(180, Math.max(0.1, asset.video.duration));
    return { frame, asset, previewError: null };
  } catch (previewError) {
    return { frame, asset: null, previewError };
  }
}
