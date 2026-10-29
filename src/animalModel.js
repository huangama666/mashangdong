/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
import * as THREE from 'three';
import { POSES } from './poses.js';

export const ANIMAL_TYPES = {
  lizard: { label: '爬行动物（蜥蜴）', category: '爬行动物', model: '蜥蜴', short: '爬', body: '蜥蜴代表模型 · 四足长尾', icon: 'lizard', sub: '四肢 / 颈部 / 分段尾巴', size: 1 },
  bird: { label: '飞行动物（鸟）', category: '飞行动物', model: '鸟', short: '飞', body: '鸟类代表模型 · 翅膀与尾羽', icon: 'bird', sub: '翅根 / 翼尖 / 尾羽', size: 1 },
};

const wingRest = (side) => [0, -side * 50, -side * 60];
const rotation = (degrees) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...degrees.map(THREE.MathUtils.degToRad)));

// Presets specify the intended wing orientation. The editor applies rest × delta,
// so derive delta with quaternion inversion; negating Euler components twists it.
function wingOffset(side, lift, fold = 0) {
  const delta = rotation(wingRest(side)).invert().multiply(rotation([0, -side * fold, side * lift]));
  const e = new THREE.Euler().setFromQuaternion(delta, 'XYZ');
  return [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg);
}

const ANIMAL_POSES = {
  lizard: [
    { id: 'lizard-rest', name: '伏地休息', hint: '四足着地，尾巴放松', joints: {} },
    { id: 'lizard-look', name: '抬头观察', hint: '颈部抬起，头转向侧面', joints: { neck: [-25, 0, 0], head: [-10, 25, 0], tailBase: [0, 12, 0], tailMid: [0, 12, 0] } },
    { id: 'lizard-crawl', name: '交替爬行', hint: '对角迈步的动作切片', joints: { spine: [0, 7, 0], frontUpperL: [0, -25, 12], frontLowerL: [0, 15, 0], frontUpperR: [0, 22, -5], hindUpperL: [0, -18, 0], hindUpperR: [0, 28, -12], hindLowerR: [0, -12, 0], tailBase: [0, -20, 0], tailMid: [0, 15, 0] } },
    { id: 'lizard-turn', name: '回头弯尾', hint: '颈部与长尾形成弧线', joints: { neck: [-10, 35, 0], head: [0, 25, 0], tailBase: [0, -35, 0], tailMid: [0, -30, 0], tailTip: [0, -25, 0] } },
  ],
  bird: [
    { id: 'bird-perch', name: '收翼站立', hint: '双翼折叠，自然站姿', joints: {} },
    { id: 'bird-glide', name: '展翅滑翔', hint: '双翼平展，抬高身体', hipsY: 0.55, joints: { wingL: wingOffset(1, 0), wingR: wingOffset(-1, 0), wingTipL: [0, 30, 0], wingTipR: [0, -30, 0], neck: [15, 0, 0], tail: [-10, 0, 0], birdLegL: [-30, 0, 0], birdLegR: [-30, 0, 0] } },
    { id: 'bird-upstroke', name: '振翅上扬', hint: '翅膀抬起，准备下拍', hipsY: 0.45, joints: { wingL: wingOffset(1, 48), wingR: wingOffset(-1, 48), wingTipL: [0, 25, 0], wingTipR: [0, -25, 0], birdLegL: [-25, 0, 0], birdLegR: [-25, 0, 0], tail: [-15, 0, 0] } },
    { id: 'bird-land', name: '展翼降落', hint: '伸腿接地，翅膀向上减速', hipsY: 0.08, joints: { wingL: wingOffset(1, 35, 15), wingR: wingOffset(-1, 35, 15), wingTipL: [0, 15, 0], wingTipR: [0, -15, 0], neck: [-10, 0, 0], birdLegL: [20, 0, 0], birdLegR: [20, 0, 0], tail: [-25, 0, 0] } },
    { id: 'bird-look', name: '侧头观察', hint: '收起双翼，转头看向一侧', joints: { neck: [-8, 20, 0], head: [10, 30, -15], tail: [0, -12, 0] } },
  ],
};

export function posesForType(type) {
  return ANIMAL_POSES[type] || POSES;
}

export function poseTypesCompatible(from, to) {
  const humans = ['male', 'female', 'boy'];
  return (humans.includes(from) && humans.includes(to)) || (Boolean(ANIMAL_TYPES[from]) && from === to);
}

// Original procedural maquettes: every visible part belongs to a rigid joint.
// Their FK chains share the editor's quaternion/selection/save format, without
// trying to apply the human IK solver to wings, quadrupeds, or tails.
export function createAnimalFigure(type) {
  if (!ANIMAL_TYPES[type]) throw new Error(`Unsupported animal: ${type}`);
  const body = new THREE.Group();
  const joints = {};
  const labels = {};
  const parts = [];
  const bird = type === 'bird';
  const material = (color, roughness = 0.52, metalness = 0.02) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const skin = material(bird ? 0x65889e : 0x778969);
  const light = material(bird ? 0xdad8cc : 0xb8bf8a);
  const dark = material(bird ? 0x344b5f : 0x435c43);
  const jointMat = material(0x545951, 0.35, 0.3);
  const eye = material(0x171c1c, 0.16);
  const ivory = material(0xe5e1cd);
  const beak = material(0xc99855);

  function joint(name, label, parent, position, rotation = [0, 0, 0]) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.fromArray(position);
    pivot.rotation.set(...rotation.map(THREE.MathUtils.degToRad));
    pivot.userData.rest = pivot.quaternion.clone();
    pivot.userData.baseY = pivot.position.y;
    parent.add(pivot);
    joints[name] = pivot;
    labels[name] = label;
    return pivot;
  }

  function part(parent, geometry, mat, position = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.fromArray(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.jointName = parent.name;
    parent.add(mesh);
    parts.push(mesh);
    return mesh;
  }

  function ellipsoid(parent, position, size, mat = skin) {
    const mesh = part(parent, new THREE.SphereGeometry(1, 24, 16), mat, position);
    mesh.scale.fromArray(size);
    return mesh;
  }

  function segment(parent, start, end, r1, r2, mat = skin) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const axis = b.clone().sub(a);
    const mesh = part(parent, new THREE.CylinderGeometry(r2, r1, axis.length(), 16), mat, a.clone().add(b).multiplyScalar(0.5).toArray());
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    return mesh;
  }

  function knob(parent, radius = 0.035) {
    return ellipsoid(parent, [0, 0, 0], [radius, radius, radius], jointMat);
  }

  const hips = joint('hips', '身体中心', body, [0, bird ? 0.6 : 0.32, 0]);
  hips.userData.isRoot = true;
  let groups;

  if (!bird) {
    ellipsoid(hips, [0, 0, -0.08], [0.2, 0.145, 0.42]);
    ellipsoid(hips, [0, -0.085, -0.05], [0.165, 0.065, 0.35], light);
    const spine = joint('spine', '背部', hips, [0, 0, 0.18]);
    ellipsoid(spine, [0, 0.01, 0.07], [0.17, 0.13, 0.25]);
    const neck = joint('neck', '颈部', spine, [0, 0.03, 0.27]);
    ellipsoid(neck, [0, 0, 0.08], [0.105, 0.095, 0.14]);
    const head = joint('head', '头部', neck, [0, 0.02, 0.17]);
    ellipsoid(head, [0, 0.015, 0.07], [0.135, 0.09, 0.19]);
    ellipsoid(head, [0, -0.035, 0.12], [0.12, 0.035, 0.17], light);
    // Dark mouth seam and nostrils keep the long snout readable from the side.
    for (const s of [-1, 1]) {
      ellipsoid(head, [s * 0.1, -0.01, 0.15], [0.012, 0.006, 0.1], dark);
      ellipsoid(head, [s * 0.113, 0.055, 0.015], [0.037, 0.039, 0.035], light);
      ellipsoid(head, [s * 0.139, 0.06, 0.025], [0.012, 0.024, 0.025], eye);
      ellipsoid(head, [s * 0.148, 0.069, 0.035], [0.004, 0.007, 0.007], ivory);
      ellipsoid(head, [s * 0.065, 0.04, 0.215], [0.009, 0.009, 0.012], dark);
    }
    for (let i = 0; i < 8; i++) {
      const parent = i < 4 ? hips : spine;
      ellipsoid(parent, [0, 0.142, i < 4 ? -0.36 + i * 0.1 : -0.11 + (i - 4) * 0.09], [0.024, 0.023, 0.04], dark);
    }
    const tailBase = joint('tailBase', '尾根', hips, [0, -0.015, -0.45]);
    segment(tailBase, [0, 0, 0], [0, -0.015, -0.33], 0.105, 0.065);
    const tailMid = joint('tailMid', '尾巴中段', tailBase, [0, -0.015, -0.33]);
    segment(tailMid, [0, 0, 0], [0, -0.025, -0.29], 0.065, 0.032);
    const tailTip = joint('tailTip', '尾尖', tailMid, [0, -0.025, -0.29]);
    segment(tailTip, [0, 0, 0], [0, -0.02, -0.3], 0.032, 0.003);
    groups = [{ label: '身体与尾巴', joints: ['hips', 'spine', 'neck', 'head', 'tailBase', 'tailMid', 'tailTip'] }];
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;
      const label = side === 'L' ? '左' : '右';
      for (const limb of ['front', 'hind']) {
        const front = limb === 'front';
        const name = `${label}${front ? '前' : '后'}肢`;
        const upper = joint(`${limb}Upper${side}`, `${name}根部`, front ? spine : hips, [s * 0.13, 0, front ? 0.09 : -0.28]);
        knob(upper, 0.044);
        const knee = [s * 0.21, -0.09, front ? -0.02 : -0.1];
        segment(upper, [0, 0, 0], knee, 0.058, 0.042);
        const lower = joint(`${limb}Lower${side}`, `${name}肘膝`, upper, knee);
        knob(lower, 0.038);
        const ankle = [s * 0.08, -0.18, 0.12];
        segment(lower, [0, 0, 0], ankle, 0.035, 0.022);
        const paw = joint(`${limb}Paw${side}`, `${name}脚掌`, lower, ankle);
        ellipsoid(paw, [0, -0.006, 0.025], [0.044, 0.02, 0.065], light);
        for (let t = -2; t <= 2; t++) {
          segment(paw, [t * 0.013, -0.01, 0.035], [t * 0.034, -0.015, 0.11 - Math.abs(t) * 0.01], 0.009, 0.003, light);
        }
        groups.push({ label: name, joints: [`${limb}Upper${side}`, `${limb}Lower${side}`, `${limb}Paw${side}`] });
      }
    }
  } else {
    ellipsoid(hips, [0, 0.09, -0.015], [0.18, 0.27, 0.24]);
    ellipsoid(hips, [0, 0.08, 0.145], [0.145, 0.21, 0.12], light);
    const neck = joint('neck', '颈部', hips, [0, 0.27, 0.1]);
    ellipsoid(neck, [0, 0.065, 0.03], [0.09, 0.14, 0.09]);
    const head = joint('head', '头部', neck, [0, 0.18, 0.035]);
    ellipsoid(head, [0, 0.025, 0.025], [0.13, 0.135, 0.145]);
    ellipsoid(head, [0, -0.04, 0.1], [0.075, 0.075, 0.08], light);
    segment(head, [0, -0.005, 0.13], [0, -0.025, 0.29], 0.059, 0.002, beak);
    for (const s of [-1, 1]) {
      ellipsoid(head, [s * 0.109, 0.035, 0.078], [0.027, 0.038, 0.038], ivory);
      ellipsoid(head, [s * 0.129, 0.038, 0.087], [0.012, 0.025, 0.025], eye);
      ellipsoid(head, [s * 0.137, 0.046, 0.096], [0.004, 0.007, 0.007], ivory);
    }
    const tail = joint('tail', '尾羽', hips, [0, -0.015, -0.19]);
    for (let f = -2; f <= 2; f++) {
      const feather = ellipsoid(tail, [f * 0.039, -0.015, -0.16], [0.035, 0.022, 0.22 - Math.abs(f) * 0.025], f % 2 ? skin : dark);
      feather.rotation.y = -f * 0.13;
    }
    groups = [{ label: '身体', joints: ['hips', 'neck', 'head', 'tail'] }];
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;
      const label = side === 'L' ? '左' : '右';
      const wing = joint(`wing${side}`, `${label}翅根`, hips, [s * 0.15, 0.19, 0], wingRest(s));
      knob(wing, 0.046);
      ellipsoid(wing, [s * 0.18, 0, -0.025], [0.21, 0.055, 0.14]);
      for (let f = 0; f < 5; f++) {
        const feather = ellipsoid(wing, [s * (0.07 + f * 0.06), -0.012, -0.15], [0.042, 0.022, 0.19], f % 2 ? skin : dark);
        feather.rotation.y = -s * 0.15;
      }
      const tip = joint(`wingTip${side}`, `${label}翼尖`, wing, [s * 0.35, 0, -0.03], [0, -s * 30, 0]);
      knob(tip, 0.03);
      ellipsoid(tip, [s * 0.13, 0, -0.025], [0.17, 0.043, 0.09]);
      for (let f = 0; f < 7; f++) {
        const feather = ellipsoid(tip, [s * (0.06 + f * 0.037), -0.008, -0.12 + f * 0.007], [0.037, 0.018, 0.22 - f * 0.012], f % 2 ? skin : dark);
        feather.rotation.y = -s * (0.1 + f * 0.085);
      }
      const leg = joint(`birdLeg${side}`, `${label}腿`, hips, [s * 0.085, -0.16, 0.015]);
      ellipsoid(leg, [0, -0.055, -0.025], [0.055, 0.1, 0.07], light);
      segment(leg, [0, -0.045, 0], [0, -0.21, -0.065], 0.022, 0.014, beak);
      const ankle = joint(`birdAnkle${side}`, `${label}脚踝`, leg, [0, -0.21, -0.065]);
      knob(ankle, 0.021);
      segment(ankle, [0, 0, 0], [0, -0.2, 0.07], 0.014, 0.011, beak);
      const paw = joint(`birdPaw${side}`, `${label}脚爪`, ankle, [0, -0.2, 0.07]);
      for (let t = -1; t <= 1; t++) segment(paw, [0, 0, 0], [t * 0.045, -0.01, 0.12 - Math.abs(t) * 0.015], 0.009, 0.003, beak);
      segment(paw, [0, 0, 0], [0, -0.01, -0.055], 0.009, 0.003, beak);
      groups.push({ label: `${label}翅膀`, joints: [`wing${side}`, `wingTip${side}`] });
      groups.push({ label: `${label}腿与脚爪`, joints: [`birdLeg${side}`, `birdAnkle${side}`, `birdPaw${side}`] });
    }
  }
  body.updateMatrixWorld(true);
  return {
    body, joints, labels, parts, material: skin, type, modelScale: 1,
    config: { rig: 'animal', jointGroups: groups, height: bird ? 1.2 : 0.55 },
  };
}
