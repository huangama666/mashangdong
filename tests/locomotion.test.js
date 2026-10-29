import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { createAnimalFigure } from '../src/animalModel.js';
import { interpolateScenes, sampleTimeline, restoreTimeline } from '../src/timeline.js';

const file = new URL('../src/locomotion.js', import.meta.url);
const gait = existsSync(file) ? await import(file) : {};
const figure = (id, type, x) => ({ trackId: id, type, pos: [x, 0, 0], rotY: 0, size: 1, hipsOffset: 0, joints: { hips: [0, 0, 0, 1] } });
const scene = (...figures) => ({ version: 2, selectedIndex: 0, figures });
const timing = { hold: 0.5, transition: 2, mode: 'smooth' };
const from = scene(figure('human', 'male', 0), figure('reptile', 'lizard', 0), figure('box', 'cube', 0));
const to = scene(figure('reptile', 'lizard', 2), figure('human', 'male', 3), figure('box', 'cube', 3));

test('衔接只列出发生平面位移的人或动物，不把物品和原地转身作为走跑', () => {
  assert.equal(typeof gait.travelCandidates, 'function', '缺少走跑衔接角色识别');
  assert.deepEqual(gait.travelCandidates(from, to).map((item) => item.trackId), ['human', 'reptile']);
  assert.deepEqual(gait.travelCandidates(from, from), []);
  const turn = structuredClone(from);
  turn.figures[0].rotY = Math.PI;
  assert.deepEqual(gait.travelCandidates(from, turn), []);
});

test('同一段衔接可分别走、跑；默认完全保留原有补间', () => {
  const frames = [{ id: 'a', scene: from, travel: { human: 'walk', reptile: 'run', box: 'walk' } }, { id: 'b', scene: to }];
  const sample = sampleTimeline(frames, 1.5, timing).scene;
  assert.equal(sample.figures[0].travel?.mode, 'walk', '缺少人物走动');
  assert.equal(sample.figures[1].travel?.mode, 'run');
  assert.equal(sample.figures[2].travel, undefined);
  const plain = [{ id: 'a', scene: from }, { id: 'b', scene: to }];
  assert.deepEqual(sampleTimeline(plain, 1.5, timing).scene, interpolateScenes(from, to, 0.5));
  assert.deepEqual(sampleTimeline(frames, 0.2, timing).scene, from);
  assert.deepEqual(sampleTimeline(frames, 2.6, timing).scene, to);
  assert.equal(from.figures[0].travel, undefined, '播放不能改写原帧');
});

test('走跑设置随定格存档恢复，未知值回退到按定格', () => {
  const restored = restoreTimeline({ frames: [{ id: 'a', scene: from, travel: { human: 'walk', reptile: 'run', box: 'fly', bad: 'invalid' } }, { id: 'b', scene: to }] });
  assert.deepEqual(restored.frames[0].travel, { human: 'walk', reptile: 'run' });
  assert.deepEqual(restoreTimeline({ frames: [{ id: 'old', scene: from }] }).frames[0].travel, {});
});

test('蜥蜴和鸟有不同步态，跑动幅度更大，衔接两端精确接回定格姿势', () => {
  assert.equal(typeof gait.captureLocomotionRig, 'function', '缺少中立步态骨架');
  for (const type of ['lizard', 'bird']) {
    const built = createAnimalFigure(type);
    const root = new THREE.Group();
    root.add(built.body);
    const fig = { ...built, root, size: 1 };
    fig.locomotionRig = gait.captureLocomotionRig(fig);
    const initial = Object.fromEntries(Object.entries(fig.joints).map(([name, bone]) => [name, bone.quaternion.toArray()]));
    for (const progress of [0, 1]) {
      gait.applyTravelPose(fig, { mode: 'walk', progress, distance: 2, direction: Math.PI / 2, duration: 2 });
      for (const [name, values] of Object.entries(initial)) assert.ok(fig.joints[name].quaternion.angleTo(new THREE.Quaternion().fromArray(values)) < 1e-6);
    }
    const bone = fig.joints[type === 'lizard' ? 'frontUpperL' : 'birdLegL'];
    const neutral = bone.quaternion.clone();
    gait.applyTravelPose(fig, { mode: 'walk', progress: 0.33, distance: 2, direction: Math.PI / 2, duration: 2 });
    assert.ok(bone.quaternion.angleTo(neutral) > 0.01, `${type} 应该迈步`);
    for (const joint of Object.values(fig.joints)) {
      assert.ok(joint.quaternion.toArray().every(Number.isFinite));
      assert.ok(Math.abs(joint.quaternion.length() - 1) < 1e-6);
    }
    assert.ok(Math.abs(fig.root.rotation.y) > 0.1, '行进中应朝向目的地方向');
    const runFigure = createAnimalFigure(type);
    const runRoot = new THREE.Group(); runRoot.add(runFigure.body);
    const runFig = { ...runFigure, root: runRoot, size: 1 };
    runFig.locomotionRig = gait.captureLocomotionRig(runFig);
    gait.applyTravelPose(runFig, { mode: 'run', progress: 0.33, distance: 2, direction: Math.PI / 2, duration: 2 });
    assert.ok(bone.quaternion.angleTo(runFig.joints[bone.name].quaternion) > 0.01, '跑动应与走动不同');
  }
});

test('未启用步态或零距离时不改变定格', () => {
  assert.equal(typeof gait.applyTravelPose, 'function', '缺少走跑步态');
  const built = createAnimalFigure('lizard');
  const root = new THREE.Group(); root.add(built.body);
  const fig = { ...built, root, size: 1 };
  fig.locomotionRig = gait.captureLocomotionRig(fig);
  const before = fig.joints.frontUpperL.quaternion.clone();
  gait.applyTravelPose(fig, { mode: 'none', progress: 0.5, distance: 2, direction: 1, duration: 2 });
  assert.ok(fig.joints.frontUpperL.quaternion.equals(before));
  gait.applyTravelPose(fig, { mode: 'walk', progress: 0.5, distance: 0, direction: 1, duration: 2 });
  assert.ok(fig.joints.frontUpperL.quaternion.equals(before));
});

test('缺少部分关节的旧帧在走跑后也能准确回到终点和重复定位', () => {
  assert.equal(typeof gait.restoreSampleJoints, 'function');
  const built = createAnimalFigure('lizard');
  const root = new THREE.Group(); root.add(built.body);
  const fig = { ...built, root, size: 1 };
  fig.locomotionRig = gait.captureLocomotionRig(fig);
  const saved = { hips: fig.joints.hips.quaternion.toArray() };
  const travel = { mode: 'walk', progress: 0.33, distance: 2, direction: 1, duration: 2 };
  gait.restoreSampleJoints(fig, saved);
  gait.applyTravelPose(fig, travel);
  const first = fig.joints.frontUpperL.quaternion.clone();
  assert.ok(first.angleTo(new THREE.Quaternion().fromArray(fig.locomotionRig.joints.frontUpperL.quaternion)) > 0.01);
  gait.restoreSampleJoints(fig, saved);
  assert.ok(fig.joints.frontUpperL.quaternion.angleTo(new THREE.Quaternion().fromArray(fig.locomotionRig.joints.frontUpperL.quaternion)) < 1e-6);
  gait.applyTravelPose(fig, { ...travel, progress: 0.67 });
  gait.restoreSampleJoints(fig, saved);
  gait.applyTravelPose(fig, travel);
  assert.ok(fig.joints.frontUpperL.quaternion.angleTo(first) < 1e-6);
});
