/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export const FIGURE_HEIGHT = 1.75;

// App joint -> bone in the CC0 base rig (Blender naming, dots stripped by glTF).
const BASE_JOINT_BONES = {
  hips: 'spine',
  spine: 'spine001',
  chest: 'spine003',
  neck: 'spine004',
  head: 'spine005',

  upperArmL: 'upper_armL',
  upperArmR: 'upper_armR',
  foreArmL: 'forearmL',
  foreArmR: 'forearmR',
  handL: 'handL',
  handR: 'handR',

  indexL1: 'f_index01L',
  indexL2: 'f_index02L',
  indexL3: 'f_index03L',
  indexR1: 'f_index01R',
  indexR2: 'f_index02R',
  indexR3: 'f_index03R',
  middleL1: 'f_middle01L',
  middleL2: 'f_middle02L',
  middleL3: 'f_middle03L',
  middleR1: 'f_middle01R',
  middleR2: 'f_middle02R',
  middleR3: 'f_middle03R',
  ringL1: 'f_ring01L',
  ringL2: 'f_ring02L',
  ringL3: 'f_ring03L',
  ringR1: 'f_ring01R',
  ringR2: 'f_ring02R',
  ringR3: 'f_ring03R',
  pinkyL1: 'f_pinky01L',
  pinkyL2: 'f_pinky02L',
  pinkyL3: 'f_pinky03L',
  pinkyR1: 'f_pinky01R',
  pinkyR2: 'f_pinky02R',
  pinkyR3: 'f_pinky03R',
  thumbL1: 'thumb01L',
  thumbL2: 'thumb02L',
  thumbL3: 'thumb03L',
  thumbR1: 'thumb01R',
  thumbR2: 'thumb02R',
  thumbR3: 'thumb03R',

  thighL: 'thighL',
  thighR: 'thighR',
  shinL: 'shinL',
  shinR: 'shinR',
  footL: 'footL',
  footR: 'footR',
  toeL: 'toeL',
  toeR: 'toeR',
};

// The user-supplied mannequin family ships a Mixamo-style skeleton (no finger
// bones) with its own baked PBR textures, so it keeps its material and rig.
const GUGE_JOINT_BONES = {
  hips: 'Hips',
  spine: 'Spine',
  chest: 'Spine2',
  neck: 'Neck',
  head: 'Head',

  upperArmL: 'LeftArm',
  upperArmR: 'RightArm',
  foreArmL: 'LeftForeArm',
  foreArmR: 'RightForeArm',
  handL: 'LeftHand',
  handR: 'RightHand',

  thighL: 'LeftUpLeg',
  thighR: 'RightUpLeg',
  shinL: 'LeftLeg',
  shinR: 'RightLeg',
  footL: 'LeftFoot',
  footR: 'RightFoot',
  toeL: 'LeftToeBase',
  toeR: 'RightToeBase',
};

const RIGS = {
  base: {
    jointBones: BASE_JOINT_BONES,
    extraBoneJoints: {
      spine: 'hips',
      spine001: 'spine',
      // The mid-torso surface is weighted mostly to spine002; treating it as chest
      // keeps clicks on the pecs from selecting the waist joint.
      spine002: 'chest',
      spine003: 'chest',
      spine004: 'neck',
      spine005: 'head',
      pelvisL: 'hips',
      pelvisR: 'hips',
      shoulderL: 'upperArmL',
      shoulderR: 'upperArmR',
      heel02L: 'footL',
      heel02R: 'footR',
    },
    bakedMaterials: false,
  },
  guge: {
    jointBones: GUGE_JOINT_BONES,
    extraBoneJoints: {
      Spine1: 'chest',
      LeftShoulder: 'upperArmL',
      RightShoulder: 'upperArmR',
    },
    bakedMaterials: true,
  },
};

function buildBoneToJoint(rig) {
  const map = { ...rig.extraBoneJoints };
  for (const [joint, bone] of Object.entries(rig.jointBones)) {
    if (!map[bone]) map[bone] = joint;
  }
  return map;
}

const FINGER_LABELS = {
  index: '食指',
  middle: '中指',
  ring: '无名指',
  pinky: '小指',
  thumb: '拇指',
};

function fingerLabels(side) {
  const out = {};
  for (const [key, label] of Object.entries(FINGER_LABELS)) {
    for (let i = 1; i <= 3; i++) out[`${key}${side}${i}`] = `${sideName(side)}${label}${i}`;
  }
  return out;
}

function fingerJoints(prefix, side) {
  const out = {};
  for (const key of Object.keys(FINGER_LABELS)) {
    const bone = key[0].toUpperCase() + key.slice(1);
    for (let i = 1; i <= 3; i++) out[`${key}${side}${i}`] = `${prefix}Hand${bone}${i}`;
  }
  return out;
}

// The guge figures carry three phalanx bones per digit on each hand; the
// procedural rig does not, and buildBoneToJoint simply skips what is missing.
Object.assign(RIGS.guge.jointBones, fingerJoints('Left', 'L'), fingerJoints('Right', 'R'));

for (const rig of Object.values(RIGS)) rig.boneToJoint = buildBoneToJoint(rig);

const sideName = (side) => (side === 'L' ? '左' : '右');

const JOINT_LABELS = {
  hips: '骨盆',
  spine: '腰部',
  chest: '胸部',
  neck: '颈部',
  head: '头部',
  upperArmL: '左上臂',
  upperArmR: '右上臂',
  foreArmL: '左前臂',
  foreArmR: '右前臂',
  handL: '左手',
  handR: '右手',
  thighL: '左大腿',
  thighR: '右大腿',
  shinL: '左小腿',
  shinR: '右小腿',
  footL: '左脚',
  footR: '右脚',
  toeL: '左脚趾',
  toeR: '右脚趾',
  ...fingerLabels('L'),
  ...fingerLabels('R'),
};

// Bone length of a joint = distance to the next joint in its chain. Resolved
// per rig, and skipped when the rig has no such joint (e.g. no finger bones).
const LENGTH_PAIRS = [
  ['upperArmL', 'foreArmL'],
  ['upperArmR', 'foreArmR'],
  ['foreArmL', 'handL'],
  ['foreArmR', 'handR'],
  ['handL', 'indexL1'],
  ['handR', 'indexR1'],
  ['thighL', 'shinL'],
  ['thighR', 'shinR'],
  ['shinL', 'footL'],
  ['shinR', 'footR'],
  ['footL', 'toeL'],
  ['footR', 'toeR'],
];

function findSkinnedMeshes(root) {
  const found = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh) found.push(o);
  });
  return found;
}

function findBodyMesh(meshes) {
  return meshes.find((m) => m.name === 'mesh' || m.name === 'mesh_female') || meshes[0];
}

// The head decal is a spherical shell hugging the face; this paints the crosshair
// and the M/F badge that identifies each figure.
function makeBadgeTexture(accent, letter) {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  const mid = S / 2;
  g.clearRect(0, 0, S, S);

  g.strokeStyle = accent;
  g.lineWidth = S * 0.011;
  g.beginPath();
  g.moveTo(mid, 0);
  g.lineTo(mid, S);
  g.moveTo(0, mid);
  g.lineTo(S, mid);
  g.stroke();

  g.lineWidth = S * 0.008;
  g.beginPath();
  g.arc(mid, mid, S * 0.305, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = '#0a0b0d';
  g.beginPath();
  g.arc(mid, mid, S * 0.215, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = '#ffffff';
  g.font = `700 ${Math.round(S * 0.29)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, mid, mid + S * 0.012);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export async function loadHumanTemplate(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  const meshes = findSkinnedMeshes(scene);
  if (!meshes.length) throw new Error('human model: no skinned mesh found');
  const body = findBodyMesh(meshes);
  const metarig = scene.getObjectByName('metarig');
  // The source rig is authored facing -X; zeroing the metarig yaw makes it face +Z.
  if (metarig) metarig.rotation.y = 0;
  scene.updateMatrixWorld(true);
  body.geometry.computeBoundingBox();
  const bb = body.geometry.boundingBox;
  const height = bb.max.y - bb.min.y;
  const rig = scene.getObjectByName('Hips') && scene.getObjectByName('LeftArm') ? 'guge' : 'base';
  if (RIGS[rig].bakedMaterials) {
    for (const mesh of meshes) {
      for (const mat of [mesh.material].flat()) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
          if (mat[key]) mat[key].anisotropy = 4;
        }
      }
    }
  }
  return {
    scene,
    rig,
    height,
    scale: FIGURE_HEIGHT / height,
    minY: bb.min.y,
  };
}

export function createHumanFigure(template, type = 'male') {
  const scene = cloneSkeleton(template.scene);
  const metarig = scene.getObjectByName('metarig');
  if (metarig) metarig.rotation.y = 0;
  const meshes = findSkinnedMeshes(scene);
  if (!meshes.length) throw new Error('human model: clone lost the skinned mesh');
  const mesh = findBodyMesh(meshes);
  const rig = RIGS[template.rig] || RIGS.base;

  let material;
  if (rig.bakedMaterials) {
    // The mannequin family carries its own baked PBR material; keep it untouched
    // and only clone it so deleting one figure never disposes a shared material.
    material = mesh.material;
    for (const part of meshes) {
      part.geometry = part.geometry.clone();
      part.material = part.material.clone();
      part.castShadow = true;
      part.receiveShadow = true;
      part.frustumCulled = false;
      part.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 2.5);
      part.userData.boneJoints = part.skeleton.bones.map((bone) => {
        let cur = bone;
        while (cur) {
          const joint = rig.boneToJoint[cur.name];
          if (joint) return joint;
          cur = cur.parent;
        }
        return null;
      });
    }
  } else {
    const isFemale = type === 'female';
    const accent = isFemale ? '#ff5a48' : '#4a83ff';
    const clothColor = isFemale ? 0xd2382b : 0x1f45c4;

    material = new THREE.MeshPhysicalMaterial({
      color: 0xbabec5,
      roughness: 0.5,
      metalness: 0.03,
      clearcoat: 0.08,
      clearcoatRoughness: 0.7,
      sheen: 0.28,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(0xffffff),
    });
    const cloth = () =>
      new THREE.MeshPhysicalMaterial({
        color: clothColor,
        roughness: 0.66,
        metalness: 0.0,
        clearcoat: 0.05,
        clearcoatRoughness: 0.5,
        sheen: 0.6,
        sheenRoughness: 0.45,
        sheenColor: new THREE.Color(0xffffff),
      });
    const jointMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x101216,
      roughness: 0.32,
      metalness: 0.55,
      clearcoat: 0.4,
      clearcoatRoughness: 0.25,
    });
    const decalMaterial = new THREE.MeshStandardMaterial({
      map: makeBadgeTexture(accent, isFemale ? 'F' : 'M'),
      transparent: true,
      alphaTest: 0.4,
      roughness: 0.62,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const partMaterials = {
      mesh: material,
      top: cloth(),
      shorts: cloth(),
      joints: jointMaterial,
      decal: decalMaterial,
    };

    for (const part of meshes) {
      part.geometry = part.geometry.clone();
      part.material = partMaterials[part.name] || material;
      part.castShadow = part.name !== 'decal';
      part.receiveShadow = part.name !== 'decal';
      part.frustumCulled = false;
      // Skinned bounds move with the pose; keep a generous sphere so picking never misses.
      part.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 2.5);
      part.userData.boneJoints = part.skeleton.bones.map((bone) => {
        let cur = bone;
        while (cur) {
          const joint = rig.boneToJoint[cur.name];
          if (joint) return joint;
          cur = cur.parent;
        }
        return null;
      });
    }
  }

  const viz = new THREE.Group();
  viz.scale.setScalar(template.scale);
  viz.position.y = -template.minY * template.scale;
  viz.add(scene);

  const body = new THREE.Group();
  body.add(viz);
  body.updateMatrixWorld(true);

  const joints = {};
  const labels = {};
  for (const [jointName, boneName] of Object.entries(rig.jointBones)) {
    const bone = scene.getObjectByName(boneName);
    if (!bone) continue;
    bone.userData.rest = bone.quaternion.clone();
    joints[jointName] = bone;
    labels[jointName] = JOINT_LABELS[jointName] || jointName;
  }
  if (!joints.hips) throw new Error('human model: hips bone missing');
  joints.hips.userData.baseY = joints.hips.position.y;
  joints.hips.userData.isRoot = true;

  const s = template.scale;
  for (const [jointName, childJoint] of LENGTH_PAIRS) {
    const bone = joints[jointName];
    const child = scene.getObjectByName(rig.jointBones[childJoint]);
    if (!bone || !child) continue;
    bone.userData.len = child.position.length() * s;
  }
  for (const side of ['L', 'R']) {
    const foot = joints[`foot${side}`];
    if (foot) {
      // Orientation of the flat-on-floor rest foot, relative to the figure root.
      foot.userData.restWorldRel = foot.getWorldQuaternion(new THREE.Quaternion());
    }
  }

  return {
    body,
    joints,
    parts: meshes,
    mesh,
    material,
    labels,
    type,
    modelScale: s,
    config: { female: type === 'female', height: FIGURE_HEIGHT, scale: s },
  };
}

export function relativeEuler(bone, order = 'XYZ') {
  const q = bone.userData.rest.clone().invert().multiply(bone.quaternion);
  const e = new THREE.Euler().setFromQuaternion(q, order);
  return [e.x, e.y, e.z].map((v) => THREE.MathUtils.radToDeg(v));
}

export function setRelativeEuler(bone, deg) {
  const e = new THREE.Euler(
    THREE.MathUtils.degToRad(deg[0]),
    THREE.MathUtils.degToRad(deg[1]),
    THREE.MathUtils.degToRad(deg[2]),
    'XYZ',
  );
  const q = new THREE.Quaternion().setFromEuler(e);
  bone.quaternion.copy(bone.userData.rest).multiply(q);
}
