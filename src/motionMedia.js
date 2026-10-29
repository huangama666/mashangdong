/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
import { Vector3, Spherical } from 'three';

export function fitMediaRect(sourceWidth, sourceHeight, width, height) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const fittedWidth = sourceWidth * scale;
  const fittedHeight = sourceHeight * scale;
  return { x: (width - fittedWidth) / 2, y: (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight };
}
export function normalizeMotionView(raw) {
  const vector = (value) => Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n) && Math.abs(n) < 1000);
  if (!raw || !vector(raw.position) || !vector(raw.target) || !Number.isFinite(raw.fov) || raw.fov < 10 || raw.fov > 100) return undefined;
  if (Math.hypot(...raw.position.map((n, i) => n - raw.target[i])) < 0.01) return undefined;
  return { position: [...raw.position], target: [...raw.target], fov: raw.fov };
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
  return { position: offset.add(new Vector3().fromArray(target)).toArray(), target, fov: a.fov + (b.fov - a.fov) * t };
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
