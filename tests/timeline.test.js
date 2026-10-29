import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';

const path = new URL('../src/timeline.js', import.meta.url);
const motion = existsSync(path) ? await import(path) : {};
const q = (degrees) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), degrees * Math.PI / 180).toArray();
const figure = (id, x, angle = 0, type = 'bird') => ({ trackId: id, type, pos: [x, 0, 0], rotY: angle, size: 1, hipsOffset: 0, joints: { hips: q(0), head: q(angle * 180 / Math.PI) } });
const scene = (...figures) => ({ version: 2, nextId: 8, selectedIndex: 0, figures });
const frames = [{ id: 'a', scene: scene(figure('one', 0)) }, { id: 'b', scene: scene(figure('one', 10, Math.PI / 2)) }];

test('定格按停留和过渡时间播放，终点完整保留', () => {
  assert.equal(typeof motion.sampleTimeline, 'function', '缺少定格动画采样器');
  const settings = { hold: 0.5, transition: 1, mode: 'smooth' };
  assert.equal(motion.timelineDuration(frames, settings), 2);
  assert.equal(motion.sampleTimeline(frames, 0.25, settings).scene.figures[0].pos[0], 0);
  const middle = motion.sampleTimeline(frames, 1, settings).scene.figures[0];
  assert.ok(Math.abs(middle.pos[0] - 5) < 1e-6);
  assert.ok(Math.abs(middle.rotY - Math.PI / 4) < 1e-6);
  assert.ok(new THREE.Quaternion().fromArray(middle.joints.head).angleTo(new THREE.Quaternion().fromArray(q(45))) < 1e-6);
  assert.equal(motion.sampleTimeline(frames, 2, settings).scene.figures[0].pos[0], 10);
  assert.equal(motion.sampleTimeline(frames, 20, settings).scene.figures[0].pos[0], 10);
  assert.equal(motion.sampleTimeline(frames, -10, settings).scene.figures[0].pos[0], 0);
});

test('逐帧定格不补间，单帧也可以形成静态片段', () => {
  assert.equal(typeof motion.sampleTimeline, 'function', '缺少定格动画采样器');
  const settings = { hold: 0.4, transition: 1, mode: 'step' };
  assert.equal(motion.timelineDuration(frames, settings), 0.8);
  assert.equal(motion.sampleTimeline(frames, 0.39, settings).scene.figures[0].pos[0], 0);
  assert.equal(motion.sampleTimeline(frames, 0.4, settings).scene.figures[0].pos[0], 10);
  assert.equal(motion.timelineDuration(frames.slice(0, 1), settings), 0.4);
  assert.equal(motion.sampleTimeline([], 0, settings), null);
});

test('角色按稳定标识匹配，不因排序、增删角色而串错动作', () => {
  assert.equal(typeof motion.interpolateScenes, 'function', '缺少场景补间');
  const a = scene(figure('bird', 0), figure('lizard', 10, 0, 'lizard'));
  const b = scene(figure('lizard', 20, 0, 'lizard'), figure('bird', 4), figure('new', 30));
  const middle = motion.interpolateScenes(a, b, 0.5);
  assert.equal(middle.figures[0].pos[0], 2);
  assert.equal(middle.figures[1].pos[0], 15);
  assert.equal(middle.figures.length, 2);
  assert.equal(motion.interpolateScenes(a, b, 1).figures.length, 3);
  const before = JSON.stringify(a);
  middle.figures[0].joints.head[0] = 20;
  assert.equal(JSON.stringify(a), before, '播放不能改写保存的定格');
});

test('朝向跨过360度时沿短路径旋转，缩放与身体高度可插值', () => {
  assert.equal(typeof motion.interpolateScenes, 'function', '缺少场景补间');
  const a = scene(figure('one', 0, 350 * Math.PI / 180));
  const b = scene(figure('one', 4, 10 * Math.PI / 180));
  b.figures[0].size = 2;
  b.figures[0].hipsOffset = 0.8;
  const middle = motion.interpolateScenes(a, b, 0.5).figures[0];
  assert.ok(Math.abs(Math.sin(middle.rotY)) < 1e-6);
  assert.equal(middle.size, 1.5);
  assert.equal(middle.hipsOffset, 0.4);
});

test('定格项目存档可恢复，并拒绝损坏的姿势和超限内容', () => {
  assert.equal(typeof motion.restoreTimeline, 'function', '缺少定格存档校验');
  const raw = { version: 1, frames, settings: { hold: 0.5, transition: 1, mode: 'smooth' } };
  const restored = motion.restoreTimeline(JSON.parse(JSON.stringify(raw)));
  assert.equal(restored.frames.length, 2);
  assert.equal(restored.frames[0].scene.figures[0].trackId, 'one');
  assert.equal(motion.restoreTimeline(null).frames.length, 0);
  const broken = structuredClone(raw);
  broken.frames[0].scene.figures[0].joints.head = [NaN, 0, 0, 1];
  assert.equal(motion.restoreTimeline(broken).frames.length, 1);
  const badSettings = motion.restoreTimeline({ frames: [], settings: { hold: -1, transition: Infinity, mode: 'oops' } }).settings;
  assert.ok(badSettings.hold >= 0.1 && Number.isFinite(badSettings.transition));
  const huge = motion.restoreTimeline({ frames: Array.from({ length: 90 }, (_, i) => ({ ...frames[0], id: `f${i}` })) });
  assert.equal(huge.frames.length, motion.MAX_KEYFRAMES);
});

test('保存入口与恢复器使用相同角色上限，不允许刷新后静默丢帧', () => {
  assert.equal(typeof motion.isRecordableScene, 'function', '缺少共享的定格保存校验');
  const atLimit = scene(...Array.from({ length: motion.MAX_FRAME_FIGURES }, (_, i) => figure(`f${i}`, i)));
  const overLimit = scene(...atLimit.figures, figure('overflow', 41));
  assert.equal(motion.isRecordableScene(atLimit), true);
  assert.equal(motion.restoreTimeline({ frames: [{ id: 'ok', scene: atLimit }] }).frames.length, 1);
  assert.equal(motion.isRecordableScene(overLimit), false);
  assert.equal(motion.restoreTimeline({ frames: [{ id: 'bad', scene: overLimit }] }).frames.length, 0);
});

test('录制视频和定格处于同一条轨道，按顺序采样和计算时长', () => {
  const clip = { id: 'clip', kind: 'video', clipId: 'asset1', duration: 2.5 };
  const mixed = [frames[0], clip, frames[1]];
  const settings = { hold: 0.5, transition: 1, mode: 'smooth' };
  assert.equal(motion.timelineDuration(mixed, settings), 3.5, '视频段两侧直接剪接，不能按定格时长吞掉视频');
  const video = motion.sampleTimeline(mixed, 1.5, settings);
  assert.equal(video.kind, 'video');
  assert.equal(video.clipId, 'asset1');
  assert.equal(video.time, 1);
  assert.equal(video.index, 1);
  assert.equal(motion.sampleTimeline(mixed, 3.25, settings).scene.figures[0].pos[0], 10);
  assert.equal(motion.frameStartTime(mixed, 2, settings), 3);
});

test('视频轨道片段元数据可刷新恢复，损坏或超长视频不会进入轨道', () => {
  const clip = { id: 'clip', kind: 'video', clipId: 'asset1', duration: 2.5, thumbnail: '' };
  const restored = motion.restoreTimeline({ frames: [frames[0], clip, frames[1]] });
  assert.equal(restored.frames.length, 3);
  assert.equal(restored.frames[1].clipId, 'asset1');
  assert.equal(restored.frames[1].duration, 2.5);
  assert.equal(motion.restoreTimeline({ frames: [{ ...clip, duration: -1 }] }).frames.length, 0);
});

test('每张定格独立决定停留与到下一帧的衔接，进度定位使用各帧时长', () => {
  const individual = [
    { ...structuredClone(frames[0]), timing: { hold: 0.2, transition: 1, mode: 'smooth' } },
    { ...structuredClone(frames[1]), timing: { hold: 1, transition: 4, mode: 'step' } },
    { id: 'c', scene: scene(figure('one', 20)), timing: { hold: 0.7, transition: 2, mode: 'smooth' } },
  ];
  assert.ok(Math.abs(motion.timelineDuration(individual) - 2.9) < 1e-8);
  assert.ok(Math.abs(motion.frameStartTime(individual, 1) - 1.2) < 1e-8);
  assert.ok(Math.abs(motion.frameStartTime(individual, 2) - 2.2) < 1e-8);
  assert.ok(Math.abs(motion.sampleTimeline(individual, 0.7).scene.figures[0].pos[0] - 5) < 1e-8);
  assert.equal(motion.sampleTimeline(individual, 2.19).scene.figures[0].pos[0], 10);
  assert.equal(motion.sampleTimeline(individual, 2.21).scene.figures[0].pos[0], 20);
  const before = structuredClone(individual[1].timing);
  individual[0].timing.hold = 3;
  assert.deepEqual(individual[1].timing, before);
  assert.ok(Math.abs(motion.frameStartTime(individual, 1) - 4) < 1e-8);
});

test('旧全局时间迁移到每张定格，独立配置保存恢复且不受后续全局值影响', () => {
  const old = { frames, settings: { hold: 2, transition: 1, mode: 'smooth' } };
  const restored = motion.restoreTimeline(old);
  assert.deepEqual(restored.frames[0].timing, old.settings);
  assert.deepEqual(restored.frames[1].timing, old.settings);
  restored.frames[0].timing = { hold: 0.5, transition: 3, mode: 'step' };
  const again = motion.restoreTimeline(JSON.parse(JSON.stringify(restored)));
  assert.deepEqual(again.frames[0].timing, restored.frames[0].timing);
  assert.deepEqual(again.frames[1].timing, old.settings);
  assert.equal(motion.timelineDuration(again.frames, { hold: 5, transition: 5, mode: 'smooth' }), 2.5);
  assert.deepEqual(old.frames[0].timing, undefined, '迁移不修改原始存档');
});

test('独立时间不改变视频长度，走跑使用源帧自己的过渡时间', () => {
  const individual = structuredClone(frames);
  individual[0].timing = { hold: 1, transition: 3, mode: 'smooth' };
  individual[0].travel = { one: 'run' };
  individual[1].timing = { hold: 2, transition: 0.1, mode: 'step' };
  const middle = motion.sampleTimeline(individual, 2.5).scene.figures[0];
  assert.equal(middle.travel.duration, 3);
  assert.equal(middle.travel.progress, 0.5);
  const clip = { id: 'v', kind: 'video', clipId: 'asset', duration: 2.5 };
  assert.equal(motion.timelineDuration([individual[0], clip, individual[1]]), 5.5);
  assert.equal(motion.frameStartTime([individual[0], clip, individual[1]], 2), 3.5);
});

test('定格保留捕获时的镜头，刷新和预览不能改为当前编辑镜头', () => {
  const captured = structuredClone(frames);
  captured[0].view = { position: [0, 1, 4], target: [0, 1, 0], fov: 34 };
  captured[1].view = { position: [2, 1, 4], target: [2, 1, 0], fov: 34 };
  const restored = motion.restoreTimeline({ frames: captured, settings: { hold: 0.5, transition: 1, mode: 'smooth' } });
  assert.deepEqual(restored.frames[0].view, captured[0].view);
  assert.deepEqual(motion.sampleTimeline(restored.frames, 0.2).view, captured[0].view);
  motion.sampleTimeline(restored.frames, 1).view.position.forEach((value, i) => assert.ok(Math.abs(value - [1, 1, 4][i]) < 1e-8));
});

test('定格项目刷新及整轨采样保留各帧独立的焦距与画幅', () => {
  const captured = structuredClone(frames);
  captured[0].view = { position: [0, 1, 4], target: [0, 1, 0], fov: 34, focalLength: 50, filmGauge: 36, zoom: 1, frame: { width: 720, height: 1280 } };
  const restored = motion.restoreTimeline(JSON.parse(JSON.stringify({ frames: captured })));
  const view = restored.frames[0].view;
  assert.equal(view.focalLength, 50);
  assert.deepEqual(view.frame, { width: 720, height: 1280 });
  assert.deepEqual(motion.sampleTimeline(restored.frames, 0.1).view, view);
});
