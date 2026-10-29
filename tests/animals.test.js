import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { relativeEuler, setRelativeEuler } from '../src/humanModel.js';

const path = new URL('../src/animalModel.js', import.meta.url);
const animals = existsSync(path) ? await import(path) : {};

test('爬行动物和飞行动物可以创建为独立的可编辑角色', () => {
  assert.equal(typeof animals.createAnimalFigure, 'function', '缺少动物角色构建器');
  for (const type of ['lizard', 'bird']) {
    const fig = animals.createAnimalFigure(type);
    assert.equal(fig.type, type);
    assert.equal(fig.config.rig, 'animal');
    assert.ok(fig.parts.length > 20);
    const box = new THREE.Box3().setFromObject(fig.body);
    assert.ok(box.min.y >= -0.005, `${type} 初始姿势不能穿过地面`);
    assert.ok(box.getSize(new THREE.Vector3()).length() > 1);
    for (const part of fig.parts) assert.ok(fig.joints[part.userData.jointName], '点击模型应能定位对应关节');
    const listed = fig.config.jointGroups.flatMap((group) => group.joints);
    assert.deepEqual(new Set(listed), new Set(Object.keys(fig.joints)), '所有关节都应能从菜单选中');
  }
});

test('旋转蜥蜴尾根会带动尾尖，并且可以重置与保存恢复', () => {
  assert.equal(typeof animals.createAnimalFigure, 'function', '缺少动物角色构建器');
  const fig = animals.createAnimalFigure('lizard');
  const before = fig.joints.tailTip.getWorldPosition(new THREE.Vector3());
  setRelativeEuler(fig.joints.tailBase, [0, 40, 0]);
  fig.body.updateMatrixWorld(true);
  assert.ok(before.distanceTo(fig.joints.tailTip.getWorldPosition(new THREE.Vector3())) > 0.1);
  const saved = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(fig.joints).map(([name, joint]) => [name, joint.quaternion.toArray()]))));
  const restored = animals.createAnimalFigure('lizard');
  for (const [name, q] of Object.entries(saved)) restored.joints[name].quaternion.fromArray(q);
  restored.body.updateMatrixWorld(true);
  assert.ok(fig.joints.tailTip.getWorldPosition(new THREE.Vector3()).distanceTo(restored.joints.tailTip.getWorldPosition(new THREE.Vector3())) < 1e-6);
  fig.joints.tailBase.quaternion.copy(fig.joints.tailBase.userData.rest);
  fig.body.updateMatrixWorld(true);
  assert.ok(before.distanceTo(fig.joints.tailTip.getWorldPosition(new THREE.Vector3())) < 1e-6);
});

test('鸟的翅膀可以展开，关节和预设与人体动作隔离', () => {
  assert.equal(typeof animals.posesForType, 'function', '缺少按角色选择的姿势库');
  for (const type of ['lizard', 'bird']) {
    const fig = animals.createAnimalFigure(type);
    const presets = animals.posesForType(type);
    assert.ok(presets.length >= 4);
    assert.equal(new Set(presets.map((pose) => pose.id)).size, presets.length);
    for (const pose of presets) {
      for (const [name, angles] of Object.entries(pose.joints || {})) {
        assert.ok(fig.joints[name], `${pose.id} 引用了不存在的关节 ${name}`);
        assert.equal(angles.length, 3);
        assert.ok(angles.every(Number.isFinite));
      }
    }
  }
  const bird = animals.createAnimalFigure('bird');
  const before = bird.joints.wingTipL.getWorldPosition(new THREE.Vector3());
  setRelativeEuler(bird.joints.wingL, [0, 0, 45]);
  bird.body.updateMatrixWorld(true);
  assert.ok(before.distanceTo(bird.joints.wingTipL.getWorldPosition(new THREE.Vector3())) > 0.1);
  assert.ok(Math.abs(relativeEuler(bird.joints.wingL)[2] - 45) < 0.001);
  assert.equal(animals.poseTypesCompatible('bird', 'lizard'), false);
  assert.equal(animals.poseTypesCompatible('male', 'bird'), false);
  assert.equal(animals.poseTypesCompatible('bird', 'bird'), true);
  assert.equal(animals.poseTypesCompatible('male', 'female'), true);
  assert.equal(animals.poseTypesCompatible('unknown', 'male'), false);
});

test('复制或删除一个动物不会改变另一个动物的姿势和资源', () => {
  assert.equal(typeof animals.createAnimalFigure, 'function', '缺少动物角色构建器');
  const a = animals.createAnimalFigure('bird');
  const b = animals.createAnimalFigure('bird');
  setRelativeEuler(a.joints.neck, [25, 0, 0]);
  assert.ok(relativeEuler(b.joints.neck).every((angle) => Math.abs(angle) < 1e-6));
  assert.notEqual(a.parts[0].geometry, b.parts[0].geometry);
  assert.notEqual(a.parts[0].material, b.parts[0].material);
  assert.throws(() => animals.createAnimalFigure('male'), /Unsupported animal/);
});

test('展翅滑翔时双翼真正平展，翼尖与翅根等高', () => {
  const fig = animals.createAnimalFigure('bird');
  const glide = animals.posesForType('bird').find((pose) => pose.id === 'bird-glide');
  for (const [name, angles] of Object.entries(glide.joints)) setRelativeEuler(fig.joints[name], angles);
  fig.body.updateMatrixWorld(true);
  for (const side of ['L', 'R']) {
    const wing = fig.joints[`wing${side}`];
    const tip = fig.joints[`wingTip${side}`];
    assert.ok(wing.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion()) < 1e-6, '平展预设不应残留翅膀扭转');
    assert.ok(Math.abs(wing.getWorldPosition(new THREE.Vector3()).y - tip.getWorldPosition(new THREE.Vector3()).y) < 1e-6);
  }
});
