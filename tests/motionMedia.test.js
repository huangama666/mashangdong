import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PerspectiveCamera } from 'three';

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
