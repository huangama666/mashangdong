import test from 'node:test';
import assert from 'node:assert/strict';
import * as props from '../src/propModel.js';
const { PROP_TYPES, normalizeProp, resizeProp } = props;

test('尺寸手柄按轴调整长方体宽高深，正方体与圆球始终等比', () => {
  assert.equal(typeof resizeProp, 'function');
  const raw = { dimensions: [1, 2, 3], label: '箱子', color: '#123456', showLabel: true };
  assert.deepEqual(resizeProp('cuboid', raw, [2, 0.5, 1.5]).dimensions, [2, 1, 4.5]);
  assert.deepEqual(resizeProp('cube', { ...raw, dimensions: [1, 1, 1] }, [1, 2, 1]).dimensions, [2, 2, 2]);
  assert.deepEqual(resizeProp('sphere', { ...raw, dimensions: [1, 1, 1] }, [1, 1, 0.5]).dimensions, [0.5, 0.5, 0.5]);
  assert.equal(resizeProp('cuboid', raw, [2, 1, 1]).label, '箱子');
  assert.deepEqual(raw.dimensions, [1, 2, 3]);
});

test('圆柱尺寸手柄区分直径和高度，缩放不能穿过零或超过上限', () => {
  assert.equal(typeof resizeProp, 'function');
  const raw = { dimensions: [1, 2, 1] };
  assert.deepEqual(resizeProp('cylinder', raw, [1, 1, 2]).dimensions, [2, 2, 2]);
  assert.deepEqual(resizeProp('cylinder', raw, [1, 0.5, 1]).dimensions, [1, 1, 1]);
  assert.deepEqual(resizeProp('cuboid', raw, [-2, 100, 0]).dimensions, [0.05, 6, 0.05]);
});
import { interpolateScenes, isRecordableScene, restoreTimeline, sampleTimeline } from '../src/timeline.js';

test('四种物品分别约束边长、直径和长宽高，非法尺寸使用有效值', () => {
  assert.equal(Object.keys(PROP_TYPES).length, 4);
  assert.deepEqual(normalizeProp('cube', { dimensions: [1, 2, 3] }).dimensions, [1, 1, 1]);
  assert.deepEqual(normalizeProp('sphere', { dimensions: [0.8, 1, 2] }).dimensions, [0.8, 0.8, 0.8]);
  assert.deepEqual(normalizeProp('cylinder', { dimensions: [0.8, 1.2, 3] }).dimensions, [0.8, 1.2, 0.8]);
  assert.deepEqual(normalizeProp('cuboid', { dimensions: [2, 0.5, 1] }).dimensions, [2, 0.5, 1]);
  assert.deepEqual(normalizeProp('cuboid', { dimensions: [-1, 20, NaN] }).dimensions, [0.05, 6, 0.6]);
});

test('数字和名称标记可以清空、隐藏，并限制长度和颜色', () => {
  const named = normalizeProp('cube', { label: '箱子 A', color: '#91A9BA', showLabel: false });
  assert.equal(named.label, '箱子 A');
  assert.equal(named.color, '#91a9ba');
  assert.equal(named.showLabel, false);
  assert.equal(normalizeProp('sphere', { label: '' }).label, '');
  assert.equal(normalizeProp('cylinder', { label: '1\n2' }).label, '12');
  assert.equal(Array.from(normalizeProp('sphere', { label: '球'.repeat(30) }).label).length, 24);
  assert.equal(normalizeProp('cube', { color: 'bad' }).color, PROP_TYPES.cube.color);
});

const scene = (dimensions, label) => ({
  version: 2, selectedIndex: 0, figures: [{
    trackId: 'box1', type: 'cuboid', pos: [0, 0, 0], rotY: 0, size: 1, hipsOffset: 0,
    joints: { hips: [0, 0, 0, 1] }, prop: normalizeProp('cuboid', { dimensions, label, color: '#c4a580' }),
  }],
});

test('标记和尺寸经过定格保存、JSON刷新恢复后完整保留', () => {
  const saved = scene([2, 0.5, 1], '桌面 A');
  assert.equal(isRecordableScene(saved), true);
  const raw = JSON.parse(JSON.stringify({ frames: [{ id: 'pose1', kind: 'pose', scene: saved }] }));
  const restored = restoreTimeline(raw);
  assert.equal(restored.frames.length, 1);
  assert.deepEqual(restored.frames[0].scene.figures[0].prop, saved.figures[0].prop);
  raw.frames[0].scene.figures[0].prop.dimensions[0] = -1;
  assert.equal(restoreTimeline(raw).frames.length, 0);
});

test('物品尺寸平滑补间，文字在下一张定格处切换且不会改写原帧', () => {
  const a = scene([1, 0.5, 1], '1');
  const b = scene([3, 1.5, 2], '桌面');
  const middle = interpolateScenes(a, b, 0.5);
  assert.deepEqual(middle.figures[0].prop.dimensions, [2, 1, 1.5]);
  assert.equal(middle.figures[0].prop.label, '1');
  assert.equal(a.figures[0].prop.dimensions[0], 1);
  const frames = [{ id: 'a', scene: a }, { id: 'b', scene: b }];
  assert.equal(sampleTimeline(frames, 2, { hold: 0.5, transition: 1, mode: 'smooth' }).scene.figures[0].prop.label, '桌面');
});
