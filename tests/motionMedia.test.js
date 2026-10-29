import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';

const file = new URL('../src/motionMedia.js', import.meta.url);
const media = existsSync(file) ? await import(file) : {};

test('视频解码失败仍保留已经保存入轨的片段，且先入轨再解码', async () => {
  assert.equal(typeof media.commitRecordedClip, 'function');
  const events = [];
  const frames = [];
  const store = {
    async save() { events.push('saved'); },
    async load() { events.push('decode'); throw new Error('视频读取超时'); },
  };
  const result = await media.commitRecordedClip({ store, id: 'clip', blob: new Blob(['recording']), elapsed: 2.4, thumbnail: 'thumb', commit(frame) { events.push('track'); frames.push(frame); } });
  assert.deepEqual(events, ['saved', 'track', 'decode']);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].duration, 2.4);
  assert.equal(result.previewError.message, '视频读取超时');
});

test('存储失败不插入空片段，成功时用解码时长校准片段', async () => {
  assert.equal(typeof media.commitRecordedClip, 'function');
  const frames = [];
  const options = { id: 'clip', blob: new Blob(['recording']), elapsed: 2, thumbnail: '', commit: frame => frames.push(frame) };
  await assert.rejects(media.commitRecordedClip({ ...options, store: { save: async () => { throw new Error('quota'); } } }), /quota/);
  assert.equal(frames.length, 0);
  const result = await media.commitRecordedClip({ ...options, store: { save: async () => {}, load: async () => ({ video: { duration: 1.96 } }) } });
  assert.equal(result.frame.duration, 1.96);
  assert.equal(frames[0].duration, 1.96);
});

test('定格与视频共用16比9取景，捕获后完整恢复编辑投影，即使绘制失败', () => {
  assert.equal(typeof media.withCaptureProjection, 'function');
  const camera = new PerspectiveCamera(34, 1900 / 820, 0.05, 120);
  camera.setViewOffset(1900, 820, 150, 180, 1900, 820);
  const before = camera.projectionMatrix.toArray();
  media.withCaptureProjection(camera, 1280 / 720, () => {
    assert.equal(camera.aspect, 16 / 9);
    assert.equal(camera.view.enabled, false);
  });
  assert.deepEqual(camera.projectionMatrix.toArray(), before);
  assert.throws(() => media.withCaptureProjection(camera, 16 / 9, () => { throw new Error('draw'); }), /draw/);
  assert.deepEqual(camera.projectionMatrix.toArray(), before);
});

test('任意预览区域都以相同的等比矩形呈现定格和视频', () => {
  assert.equal(typeof media.fitMediaRect, 'function');
  assert.deepEqual(media.fitMediaRect(1280, 720, 1600, 450), { x: 400, y: 0, width: 800, height: 450 });
  assert.deepEqual(media.fitMediaRect(1280, 720, 800, 800), { x: 0, y: 175, width: 800, height: 450 });
});

test('定格取景可保存恢复并平滑衔接，损坏镜头数据不会进入相机', () => {
  assert.equal(typeof media.normalizeMotionView, 'function');
  const a = { position: [0, 1, 4], target: [0, 1, 0], fov: 34 };
  const b = { position: [2, 2, 4], target: [2, 2, 0], fov: 40 };
  assert.deepEqual(media.normalizeMotionView(JSON.parse(JSON.stringify(a))), a);
  assert.equal(media.normalizeMotionView({ ...a, position: [NaN, 1, 4] }), undefined);
  const middle = media.interpolateMotionView(a, b, 0.5);
  assert.deepEqual(middle.target, [1, 1.5, 0]);
  assert.equal(middle.fov, 37);
  assert.ok(Math.abs(middle.position[0] - 1) < 1e-8 && Math.abs(middle.position[1] - 1.5) < 1e-8 && Math.abs(middle.position[2] - 4) < 1e-8);
});

test('正反面镜头衔接围绕目标点移动，不穿过人物或依赖上次取景', () => {
  const a = { position: [0, 1, 4], target: [0, 1, 0], fov: 34 };
  const b = { position: [0, 1, -4], target: [0, 1, 0], fov: 34 };
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const view = media.interpolateMotionView(a, b, t);
    assert.ok(media.normalizeMotionView(view));
    assert.ok(Math.abs(Math.hypot(...view.position.map((n, i) => n - view.target[i])) - 4) < 1e-8);
  }
});

test('镜头快照同时保存机位、观察点、物理焦距与画幅，JSON 往返不丢参数', () => {
  assert.equal(typeof media.captureCameraView, 'function');
  const camera = new PerspectiveCamera(34, 9 / 16, 0.05, 120);
  camera.filmGauge = 36;
  camera.setFocalLength(50);
  camera.zoom = 1.25;
  camera.position.set(2, 1.6, 4);
  const view = media.captureCameraView(camera, new Vector3(0, 0.9, 0), { width: 720, height: 1280 });
  assert.deepEqual(view.position, [2, 1.6, 4]);
  assert.deepEqual(view.target, [0, 0.9, 0]);
  assert.ok(Math.abs(view.focalLength - 50) < 1e-10);
  assert.equal(view.filmGauge, 36);
  assert.equal(view.zoom, 1.25);
  assert.deepEqual(view.frame, { width: 720, height: 1280 });
  assert.deepEqual(media.normalizeMotionView(JSON.parse(JSON.stringify(view))), view);
});

test('重新载入镜头后透视投影一致，旧定格仍按原 FOV 恢复为 16:9', () => {
  assert.equal(typeof media.restoreCameraView, 'function');
  const original = new PerspectiveCamera(34, 9 / 16, 0.05, 120);
  original.filmGauge = 36;
  original.setFocalLength(85);
  original.position.set(2, 1.6, 4);
  const target = new Vector3(0, 0.9, 0);
  original.lookAt(target);
  original.updateMatrixWorld();
  const view = media.captureCameraView(original, target, { width: 720, height: 1280 });
  const restored = new PerspectiveCamera(90, 2.4, 0.05, 120);
  restored.setViewOffset(1900, 800, 100, 50, 1900, 800);
  const restoredTarget = new Vector3();
  media.restoreCameraView(restored, restoredTarget, JSON.parse(JSON.stringify(view)));
  restored.updateMatrixWorld();
  const point = new Vector3(0.3, 1.1, 0.2);
  assert.ok(point.clone().project(original).distanceTo(point.clone().project(restored)) < 1e-10);
  assert.deepEqual(restoredTarget.toArray(), target.toArray());
  media.restoreCameraView(restored, restoredTarget, { position: [0, 1, 4], target: [0, 1, 0], fov: 34 });
  assert.equal(restored.fov, 34);
  assert.equal(restored.aspect, 16 / 9);
  assert.equal(restored.zoom, 1);
});

test('自动记录原有固定画幅，编辑窗口的比例不会改变保存的视角与焦距', () => {
  const camera = new PerspectiveCamera(34, 1900 / 800, 0.05, 120);
  camera.filmGauge = 36;
  camera.position.set(0, 1, 4);
  const target = new Vector3(0, 1, 0);
  const a = media.captureCameraView(camera, target);
  camera.aspect = 800 / 900;
  const b = media.captureCameraView(camera, target);
  assert.deepEqual(a.frame, { width: 1280, height: 720 });
  assert.deepEqual(b.frame, a.frame);
  assert.ok(Math.abs(a.fov - 34) < 1e-10);
  assert.ok(Math.abs(b.fov - 34) < 1e-10);
  assert.ok(Math.abs(a.focalLength - b.focalLength) < 1e-10);
});

test('损坏的画幅和镜头扩展参数安全降级，合法的长焦仍能保存', () => {
  assert.equal(typeof media.normalizeCaptureFrame, 'function');
  assert.deepEqual(media.normalizeCaptureFrame({ width: NaN, height: 0 }), { width: 1280, height: 720 });
  assert.deepEqual(media.normalizeCaptureFrame({ width: 1e9, height: 720 }), { width: 1280, height: 720 });
  const camera = new PerspectiveCamera(34, 16 / 9, 0.05, 120);
  camera.filmGauge = 36;
  camera.setFocalLength(200);
  camera.position.set(0, 1, 4);
  const view = media.captureCameraView(camera, new Vector3(), { width: 1280, height: 720 });
  view.position = [0, 1, 4];
  assert.ok(media.normalizeMotionView(view));
  assert.ok(view.fov < 10);
  const bad = media.normalizeMotionView({ ...view, focalLength: Infinity, zoom: -1, filmGauge: NaN });
  assert.ok(bad && Number.isFinite(bad.fov));
  assert.notEqual(bad.zoom, -1);
  assert.notEqual(bad.focalLength, Infinity);
});

test('镜头过渡保留物理参数，画幅在下一定格切换且不修改存档', () => {
  const a = { position: [0, 1, 4], target: [0, 1, 0], fov: 34, focalLength: 35, filmGauge: 36, zoom: 1, frame: { width: 1280, height: 720 } };
  const b = { ...a, focalLength: 85, frame: { width: 720, height: 1280 } };
  const before = JSON.stringify([a, b]);
  const middle = media.interpolateMotionView(a, b, 0.5);
  assert.equal(middle.focalLength, 60);
  assert.deepEqual(middle.frame, a.frame);
  assert.deepEqual(media.interpolateMotionView(a, b, 1).frame, b.frame);
  assert.equal(JSON.stringify([a, b]), before);
});
