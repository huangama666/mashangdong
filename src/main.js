import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  loadHumanTemplate,
  createHumanFigure,
  relativeEuler,
  setRelativeEuler,
} from './humanModel.js';
import { ANIMAL_TYPES, createAnimalFigure, posesForType, poseTypesCompatible } from './animalModel.js';
import { mountIcons } from './icons.js';
import { createMotionStudio } from './motionStudio.js';
import { PROP_TYPES, createPropFigure, normalizeProp, resizeProp } from './propModel.js';
import { captureLocomotionRig, applyTravelPose, restoreSampleJoints } from './locomotion.js';
import { withCaptureProjection, normalizeMotionView } from './motionMedia.js';
import './style.css';
import './workbench.css';

const DEG = Math.PI / 180;
// v4: the figures now use the user-supplied mannequin rigs, so scenes and poses
// saved against older skeletons would restore twisted.
const SCENE_KEY = 'poselab.scene.v4';
const SETTINGS_KEY = 'poselab.settings.v1';
const ONBOARD_KEY = 'poselab.onboarded.v1';
const CUSTOM_POSES_KEY = 'poselab.customPoses.v3';

const FIGURE_TYPES = {
  male: { label: '男性', short: '男', body: '男性体型', icon: 'male', sub: '蓝色运动装', size: 1 },
  female: { label: '女性', short: '女', body: '女性体型', icon: 'female', sub: '红色运动装', size: 1 },
  boy: { label: '小孩', short: '童', body: '小孩体型', icon: 'boy', sub: '绿色运动装', size: 0.5 },
  ...ANIMAL_TYPES,
  ...PROP_TYPES,
};
const typeInfo = (type) => FIGURE_TYPES[type] || FIGURE_TYPES.male;

const canvas = document.getElementById('view');
const panelEl = document.getElementById('panel');
const popRoot = document.getElementById('popover-root');
const modalRoot = document.getElementById('modal-root');
const tooltipEl = document.getElementById('tooltip');
const toastEl = document.getElementById('toast');
const onboarding = document.getElementById('onboarding');

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;
pmrem.dispose();

const THEMES = {
  gray: { bg: 0xdfe2e4, floor: 0xd4d8db, line: 0x9fa7b0, swatch: '#dfe2e4' },
  warm: { bg: 0xe8e1d6, floor: 0xdfd7c9, line: 0xb2a695, swatch: '#e8e1d6' },
  dark: { bg: 0x2a2d31, floor: 0x33373c, line: 0x585e66, swatch: '#2a2d31' },
};
let currentTheme = THEMES.gray;
scene.background = new THREE.Color(currentTheme.bg);
scene.fog = new THREE.Fog(currentTheme.bg, 8.5, 30);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.05, 120);
camera.position.set(2.25, 1.52, 3.35);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.94, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.rotateSpeed = 0.72;
controls.panSpeed = 0.72;
controls.zoomSpeed = 0.75;
controls.minDistance = 1.0;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI / 2 - 0.018;
controls.minPolarAngle = 0.02;
controls.screenSpacePanning = true;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x8e949c, 0.5));

const keyLight = new THREE.DirectionalLight(0xfff7ec, 1.35);
keyLight.position.set(3.2, 5.6, 4.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -5;
keyLight.shadow.camera.right = 5;
keyLight.shadow.camera.top = 6;
keyLight.shadow.camera.bottom = -2;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 20;
keyLight.shadow.bias = -0.00015;
keyLight.shadow.normalBias = 0.015;
scene.add(keyLight);
scene.add(keyLight.target);
keyLight.target.position.set(0, 1, 0);

const fillLight = new THREE.DirectionalLight(0xcfe0ff, 0.26);
fillLight.position.set(-4, 2.6, -2.5);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.24);
rimLight.position.set(-1, 3.2, -5);
scene.add(rimLight);

function makeGridTexture(theme) {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  ctx.fillStyle = hex(theme.floor);
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = hex(theme.line);
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 4;
  const draws = [
    [0.5, 0, 0.5, size],
    [256.5, 0, 256.5, size],
    [0, 0.5, size, 0.5],
    [0, 256.5, size, 256.5],
  ];
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of draws) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 80);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.93,
  metalness: 0.0,
});
let gridTexture = makeGridTexture(currentTheme);
floorMaterial.map = gridTexture;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// A single skinned mesh cannot swap part materials, so the active joint is
// marked with a small gold dot instead.
const selectionMarker = new THREE.Group();
const markerCore = new THREE.Mesh(
  new THREE.SphereGeometry(0.026, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xf2c772, toneMapped: false, depthTest: false }),
);
markerCore.renderOrder = 11;
const markerHalo = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 20, 14),
  new THREE.MeshBasicMaterial({
    color: 0xe2a94a,
    transparent: true,
    opacity: 0.22,
    toneMapped: false,
    depthTest: false,
  }),
);
markerHalo.renderOrder = 10;
selectionMarker.add(markerCore, markerHalo);
selectionMarker.visible = false;
scene.add(selectionMarker);

// X/Y/Z rotation rings for the selected joint. Local space so each ring turns
// the joint around one of its own axes, which is how the sliders are expressed.
const rotateGizmo = new TransformControls(camera, canvas);
rotateGizmo.setMode('rotate');
rotateGizmo.setSpace('local');
rotateGizmo.setSize(0.45);
rotateGizmo.showE = false;
rotateGizmo.showXYZE = false;
const rotateGizmoHelper = rotateGizmo.getHelper();
rotateGizmoHelper.visible = false;
scene.add(rotateGizmoHelper);
let gizmoSnapshot = null;
let gizmoMoved = false;

rotateGizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (e.value) {
    hideHover();
    return;
  }
  if (gizmoMoved && gizmoSnapshot) {
    past.push(gizmoSnapshot);
    if (past.length > 80) past.shift();
    future.length = 0;
    updateHistoryButtons();
  }
  gizmoSnapshot = null;
  gizmoMoved = false;
  syncJointUI();
  scheduleAutosave();
});
rotateGizmo.addEventListener('mouseDown', () => {
  gizmoSnapshot = serializeScene();
  gizmoMoved = false;
});
rotateGizmo.addEventListener('objectChange', () => {
  gizmoMoved = true;
  syncJointUI();
  scheduleAutosave();
});

// XYZ arrows for moving the whole figure. The gizmo is attached to a free
// anchor at the selected joint; dragging it applies the delta to the figure root.
const moveAnchor = new THREE.Object3D();
scene.add(moveAnchor);

const moveGizmo = new TransformControls(camera, canvas);
moveGizmo.setMode('translate');
moveGizmo.setSpace('world');
moveGizmo.setSize(0.55);
const moveGizmoHelper = moveGizmo.getHelper();
moveGizmoHelper.visible = false;
scene.add(moveGizmoHelper);
let moveSnapshot = null;
let moveMoved = false;
const moveStartRoot = new THREE.Vector3();
const moveStartAnchor = new THREE.Vector3();
let moveStartAnkleY = 0;
let scaleStartProp = null;

moveGizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (e.value) {
    hideHover();
    return;
  }
  if (moveMoved && moveSnapshot) {
    past.push(moveSnapshot);
    if (past.length > 80) past.shift();
    future.length = 0;
    updateHistoryButtons();
  }
  moveSnapshot = null;
  scaleStartProp = null;
  moveMoved = false;
  selectedFigure()?.root.updateMatrixWorld(true);
  syncJointUI();
  scheduleAutosave();
});
moveGizmo.addEventListener('mouseDown', () => {
  const fig = selectedFigure();
  const part = state.selectedPart;
  const bone = fig && part ? fig.joints[part.boneName] : null;
  if (!fig || !bone) return;
  moveSnapshot = serializeScene();
  moveMoved = false;
  moveStartRoot.copy(fig.root.position);
  moveStartAnkleY = fig.ankleY;
  scaleStartProp = fig.propState ? structuredClone(fig.propState) : null;
  bone.getWorldPosition(moveStartAnchor);
});
moveGizmo.addEventListener('objectChange', () => {
  const fig = selectedFigure();
  if (!fig || !moveSnapshot) return;
  if (state.gizmoMode === 'scale' && scaleStartProp) {
    fig.propState = fig.updateProp(resizeProp(fig.type, scaleStartProp, moveAnchor.scale.toArray()));
    fig.root.updateMatrixWorld(true);
    moveMoved = true;
    syncJointUI();
    scheduleAutosave();
    return;
  }
  const delta = moveAnchor.position.clone().sub(moveStartAnchor);
  fig.root.position.copy(moveStartRoot).add(delta);
  fig.ankleY = moveStartAnkleY + delta.y;
  fig.root.updateMatrixWorld(true);
  moveMoved = true;
  syncJointUI();
  scheduleAutosave();
});

// ---------------- app state ----------------
const settings = { theme: 'gray', grid: true, light: 1.35, mode: 'ik' };
const state = {
  figures: [],
  selectedId: null,
  selectedPart: null,
  mode: 'ik',
  gizmoMode: 'rotate',
};
let nextId = 1;
let pickables = [];
let humanTemplates = null;
let motionStudio = null;
let drag = null;
let hoverRaf = 0;
let hoverPoint = { x: 0, y: 0 };
let activePopover = null;
let sliderPendingSnapshot = null;
let camTween = null;
let toastTimer = 0;
let saveTimer = 0;
const past = [];
const future = [];
const raycaster = new THREE.Raycaster();

// ---------------- helpers ----------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapDeg = (d) => ((d + 540) % 360) - 180;
const fmtDeg = (d) => {
  const r = Math.round(d * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}°`;
};
const sideName = (side) => (side === 'L' ? '左' : '右');
const selectedFigure = () => state.figures.find((f) => f.id === state.selectedId) || null;
const figById = (id) => state.figures.find((f) => f.id === id) || null;

function toast(msg) {
  toastEl.querySelector('.toast-text').textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is optional */
  }
}

// ---------------- custom poses ----------------
let customPoses = loadCustomPoses();

function loadCustomPoses() {
  const raw = readStore(CUSTOM_POSES_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      if (!p || typeof p.name !== 'string') return null;
      const base = {
        id: String(p.id || makeId()),
        name: p.name.trim().slice(0, 20) || '未命名动作',
        createdAt: Number(p.createdAt) || Date.now(),
      };
      if (Array.isArray(p.figures) && p.figures.length) {
        const figures = p.figures.filter(
          (fd) => fd && typeof fd === 'object' && fd.joints && typeof fd.joints === 'object',
        );
        if (!figures.length) return null;
        return {
          ...base,
          kind: 'group',
          figures,
          selectedIndex: Math.max(0, Math.floor(Number(p.selectedIndex) || 0)),
        };
      }
      if (!p.joints || typeof p.joints !== 'object') return null;
      return {
        ...base,
        kind: 'single',
        type: FIGURE_TYPES[p.type] ? p.type : 'male',
        joints: p.joints,
        hipsOffset: Number(p.hipsOffset) || 0,
      };
    })
    .filter(Boolean)
    .slice(0, 60);
}

function persistCustomPoses() {
  writeStore(CUSTOM_POSES_KEY, customPoses);
}

function addCustomPose(entry) {
  customPoses.unshift(entry);
  if (customPoses.length > 60) customPoses.length = 60;
  persistCustomPoses();
}

function makeId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function poseStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function scheduleAutosave() {
  clearTimeout(saveTimer);
  if (motionStudio?.isPreviewing) return;
  saveTimer = setTimeout(() => {
    writeStore(SCENE_KEY, serializeScene());
  }, 450);
}

function saveSettings() {
  writeStore(SETTINGS_KEY, settings);
}

// ---------------- theme ----------------
function applyTheme() {
  currentTheme = THEMES[settings.theme] || THEMES.gray;
  scene.background.set(currentTheme.bg);
  scene.fog.color.set(currentTheme.bg);

  if (gridTexture) gridTexture.dispose();
  gridTexture = makeGridTexture(currentTheme);
  floorMaterial.map = settings.grid ? gridTexture : null;
  floorMaterial.color.set(settings.grid ? 0xffffff : currentTheme.floor);
  floorMaterial.needsUpdate = true;

  document.body.style.background = '#' + currentTheme.bg.toString(16).padStart(6, '0');
  if (activePopover?.tool === 'settings') {
    activePopover.el.querySelectorAll('[data-theme]').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === settings.theme);
    });
    const sw = activePopover.el.querySelector('[data-grid-toggle]');
    if (sw) sw.classList.toggle('on', settings.grid);
  }
}

// ---------------- figure management ----------------
function rebuildPickables() {
  pickables = [];
  for (const fig of state.figures) {
    for (const mesh of fig.parts) pickables.push(mesh);
  }
}

function addFigure(type = 'male', opts = {}) {
  if (!ANIMAL_TYPES[type] && !PROP_TYPES[type] && !humanTemplates) throw new Error('human templates not loaded');
  const built = PROP_TYPES[type]
    ? createPropFigure(type, opts.data?.prop || { label: String(state.figures.filter((fig) => PROP_TYPES[fig.type]).length + 1) })
    : ANIMAL_TYPES[type] ? createAnimalFigure(type)
      : createHumanFigure(humanTemplates[type] || humanTemplates.male, type);
  const id = nextId++;
  const root = new THREE.Group();
  root.name = `figure-${id}`;
  root.add(built.body);
  scene.add(root);

  const fig = {
    id,
    trackId: opts.data?.trackId || makeId(),
    type,
    root,
    body: built.body,
    joints: built.joints,
    parts: built.parts,
    material: built.material,
    labels: built.labels,
    modelScale: built.modelScale,
    config: built.config,
    propState: built.propState,
    updateProp: built.updateProp,
    dispose: built.dispose,
    ankleY: 0,
    size: 1,
  };

  fig.parts.forEach((mesh) => {
    mesh.userData.figureId = id;
  });

  const data = opts.data;
  if (data) {
    root.position.fromArray(data.pos || [0, 0, 0]);
    root.rotation.y = data.rotY || 0;
  } else if (opts.position) {
    root.position.fromArray(opts.position);
    root.rotation.y = opts.rotationY || 0;
  } else {
    let x = 0;
    if (state.figures.length) {
      x = Math.max(...state.figures.map((f) => f.root.position.x)) + 1.05;
    }
    root.position.set(x, 0, 0);
  }

  state.figures.push(fig);
  root.updateMatrixWorld(true);

  // height of the ankle when standing straight = floor contact height
  fig.ankleY = fig.joints.footL?.getWorldPosition(new THREE.Vector3()).y || 0;

  if (!PROP_TYPES[type]) {
    applyPoseToFigure(fig, posesForType(type).find((pose) => pose.id === 'stand') || posesForType(type)[0], { record: false, transient: true });
    fig.locomotionRig = captureLocomotionRig(fig);
  }

  if (data) {
    for (const [name, q] of Object.entries(data.joints || {})) {
      const bone = fig.joints[name];
      if (bone && Array.isArray(q) && q.length === 4) bone.quaternion.fromArray(q);
    }
    const hipsOffset = typeof data.hipsOffset === 'number' ? data.hipsOffset : 0;
    fig.joints.hips.position.y =
      fig.joints.hips.userData.baseY + hipsOffset / fig.modelScale;
    root.updateMatrixWorld(true);
  }

  fig.ankleRestY = fig.ankleY;
  setFigureSize(fig, data?.size ?? opts.size ?? typeInfo(type).size);

  rebuildPickables();
  return fig;
}

function setFigureSize(fig, size) {
  const k = clamp(Number(size) || 1, 0.25, 2);
  fig.size = k;
  fig.body.scale.setScalar(k);
  fig.root.updateMatrixWorld(true);
  fig.ankleY = fig.ankleRestY * k;
}

function removeFigure(fig) {
  if (state.selectedPart?.figureId === fig.id) clearPartSelection();
  scene.remove(fig.root);
  if (fig.dispose) fig.dispose();
  else for (const mesh of fig.parts) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  state.figures = state.figures.filter((f) => f !== fig);
  rebuildPickables();
}

function clearPartSelection() {
  selectionMarker.visible = false;
  rotateGizmoHelper.visible = false;
  moveGizmoHelper.visible = false;
  if (rotateGizmo.object) rotateGizmo.detach();
  if (moveGizmo.object) moveGizmo.detach();
  state.selectedPart = null;
}

function selectFigureById(id) {
  if (state.selectedId !== id) clearPartSelection();
  state.selectedId = id;
  if (state.gizmoMode === 'scale' && !PROP_TYPES[selectedFigure()?.type]) state.gizmoMode = 'rotate';
  if ((state.gizmoMode === 'move' || state.gizmoMode === 'scale') && !state.selectedPart) {
    const fig = selectedFigure();
    if (fig) selectPart(fig, 'hips');
  }
  renderPanel();
  scheduleAutosave();
}

function selectPart(fig, boneName) {
  if (state.selectedId !== fig.id) clearPartSelection();
  state.selectedId = fig.id;
  state.selectedPart = {
    figureId: fig.id,
    boneName,
    label: fig.labels[boneName] || boneName,
  };
  updateSelectionMarker();
  renderPanel();
  scheduleAutosave();
}

function updateSelectionMarker() {
  const part = state.selectedPart;
  const fig = part ? figById(part.figureId) : null;
  const bone = fig?.joints[part.boneName];
  if (!bone) {
    selectionMarker.visible = false;
    rotateGizmoHelper.visible = false;
    moveGizmoHelper.visible = false;
    if (rotateGizmo.object) rotateGizmo.detach();
    if (moveGizmo.object) moveGizmo.detach();
    return;
  }
  bone.getWorldPosition(selectionMarker.position);
  selectionMarker.visible = true;

  if (state.gizmoMode === 'move' || (state.gizmoMode === 'scale' && PROP_TYPES[fig.type])) {
    if (rotateGizmo.object) rotateGizmo.detach();
    rotateGizmoHelper.visible = false;
    if (moveGizmo.object !== moveAnchor) moveGizmo.attach(moveAnchor);
    if (!moveGizmo.dragging) {
      moveGizmo.setMode(state.gizmoMode === 'scale' ? 'scale' : 'translate');
      moveGizmo.setSpace(state.gizmoMode === 'scale' ? 'local' : 'world');
      moveAnchor.scale.set(1, 1, 1);
      if (state.gizmoMode === 'scale') bone.getWorldQuaternion(moveAnchor.quaternion);
      else moveAnchor.quaternion.identity();
      bone.getWorldPosition(moveAnchor.position);
    }
    moveGizmoHelper.visible = true;
  } else {
    if (moveGizmo.object) moveGizmo.detach();
    moveGizmoHelper.visible = false;
    if (rotateGizmo.object !== bone) rotateGizmo.attach(bone);
    rotateGizmoHelper.visible = true;
  }
}

function nextFigureX() {
  if (!state.figures.length) return 0;
  return Math.max(...state.figures.map((f) => f.root.position.x)) + 1.05;
}

function figureToData(fig) {
  const joints = {};
  for (const [name, bone] of Object.entries(fig.joints)) {
    joints[name] = bone.quaternion.toArray().map((v) => +v.toFixed(5));
  }
  return {
    trackId: fig.trackId,
    type: fig.type,
    ...(fig.propState ? { prop: normalizeProp(fig.type, fig.propState) } : {}),
    pos: [fig.root.position.x, fig.root.position.y, fig.root.position.z],
    rotY: fig.root.rotation.y,
    size: +fig.size.toFixed(3),
    hipsOffset: +(
      (fig.joints.hips.position.y - fig.joints.hips.userData.baseY) *
      fig.modelScale
    ).toFixed(5),
    joints,
  };
}

// ---------------- IK / FK ----------------
function aimBone(bone, dir, fig) {
  if (dir.lengthSq() < 1e-10) return;
  fig.root.updateMatrixWorld(true);
  const curQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(curQ).normalize();
  const target = dir.clone().normalize();
  if (cur.dot(target) > 0.99995) return;
  const delta = new THREE.Quaternion().setFromUnitVectors(cur, target);
  const worldQ = delta.multiply(curQ);
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentQ.multiply(worldQ));
  fig.root.updateMatrixWorld(true);
}

function solveArm(fig, side, targetWorld) {
  const upper = fig.joints[`upperArm${side}`];
  const fore = fig.joints[`foreArm${side}`];
  if (!upper || !fore) return;
  fig.root.updateMatrixWorld(true);

  const S = upper.getWorldPosition(new THREE.Vector3());
  const scale = fig.body.getWorldScale(new THREE.Vector3()).x;
  const L1 = upper.userData.len * scale;
  const L2 = fore.userData.len * scale;

  let dir = targetWorld.clone().sub(S);
  let d = dir.length();
  if (d < 1e-5) return;
  dir.normalize();
  const maxD = (L1 + L2) * 0.998;
  const minD = Math.abs(L1 - L2) + 0.015;
  const dc = clamp(d, minD, maxD);
  const T = S.clone().addScaledVector(dir, dc);

  const a = (L1 * L1 - L2 * L2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const mid = S.clone().addScaledVector(dir, a);

  const rootQ = fig.root.getWorldQuaternion(new THREE.Quaternion());
  const sideSign = side === 'L' ? 1 : -1;
  // Elbows point mostly down/back with only a slight outward flare; a large
  // outward component makes near-body targets bow the arms away from the torso.
  const pole = new THREE.Vector3(sideSign * 0.16, -1, -0.55)
    .normalize()
    .applyQuaternion(rootQ);
  let perp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-7) perp.set(0, 0, -1).applyQuaternion(rootQ);
  perp.normalize();
  const E = mid.clone().addScaledVector(perp, h);

  aimBone(upper, E.clone().sub(S), fig);
  const E2 = fore.getWorldPosition(new THREE.Vector3());
  aimBone(fore, T.clone().sub(E2), fig);
  fig.root.updateMatrixWorld(true);
}

function solveLeg(fig, side, targetWorld) {
  const thigh = fig.joints[`thigh${side}`];
  const shin = fig.joints[`shin${side}`];
  if (!thigh || !shin) return;
  fig.root.updateMatrixWorld(true);

  const S = thigh.getWorldPosition(new THREE.Vector3());
  const scale = fig.body.getWorldScale(new THREE.Vector3()).x;
  const L1 = thigh.userData.len * scale;
  const L2 = shin.userData.len * scale;

  let dir = targetWorld.clone().sub(S);
  let d = dir.length();
  if (d < 1e-5) return;
  dir.normalize();
  const maxD = (L1 + L2) * 0.998;
  const minD = Math.abs(L1 - L2) + 0.015;
  const dc = clamp(d, minD, maxD);
  const T = S.clone().addScaledVector(dir, dc);

  const a = (L1 * L1 - L2 * L2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const mid = S.clone().addScaledVector(dir, a);

  const rootQ = fig.root.getWorldQuaternion(new THREE.Quaternion());
  const sideSign = side === 'L' ? 1 : -1;
  const pole = new THREE.Vector3(sideSign * 0.12, 0.05, 1)
    .normalize()
    .applyQuaternion(rootQ);
  let perp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-7) perp.set(0, 0, 1).applyQuaternion(rootQ);
  perp.normalize();
  const E = mid.clone().addScaledVector(perp, h);

  aimBone(thigh, E.clone().sub(S), fig);
  const E2 = shin.getWorldPosition(new THREE.Vector3());
  aimBone(shin, T.clone().sub(E2), fig);
  fig.root.updateMatrixWorld(true);
}

function levelFoot(fig, side) {
  const foot = fig.joints[`foot${side}`];
  const shin = fig.joints[`shin${side}`];
  const restRel = foot?.userData.restWorldRel;
  if (!foot || !shin || !restRel) return;
  fig.root.updateMatrixWorld(true);
  const rootQ = fig.root.getWorldQuaternion(new THREE.Quaternion());
  const restWorld = rootQ.multiply(restRel);
  const shinQ = shin.getWorldQuaternion(new THREE.Quaternion()).invert();
  foot.quaternion.copy(shinQ.multiply(restWorld));
  fig.root.updateMatrixWorld(true);
}

function aimBoneWithPointer(e) {
  if (!drag) return;
  const pivot = drag.bone.getWorldPosition(new THREE.Vector3());
  const ndc = pointerNdc(e.clientX, e.clientY);
  raycaster.setFromCamera(ndc, camera);
  const closest = raycaster.ray.closestPointToPoint(pivot, new THREE.Vector3());
  const dir = closest.sub(pivot);
  if (dir.lengthSq() < 1e-8) return;

  const startDir = new THREE.Vector3(0, 1, 0).applyQuaternion(drag.startWorldQuat).normalize();
  const targetDir = dir.normalize();
  if (startDir.dot(targetDir) < -0.999) return;

  const delta = new THREE.Quaternion().setFromUnitVectors(startDir, targetDir);
  const worldQ = delta.multiply(drag.startWorldQuat);
  const parentQ = drag.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  drag.bone.quaternion.copy(parentQ.multiply(worldQ));
  drag.fig.root.updateMatrixWorld(true);
}

// ---------------- poses ----------------
function resetPose(fig) {
  for (const bone of Object.values(fig.joints)) {
    bone.quaternion.copy(bone.userData.rest);
  }
  fig.joints.hips.position.y = fig.joints.hips.userData.baseY;
  fig.root.updateMatrixWorld(true);
}

function applyPoseToFigure(fig, pose, opts = {}) {
  if (PROP_TYPES[fig.type]) return;
  if (opts.record !== false) pushHistorySnapshot();
  resetPose(fig);

  const hips = fig.joints.hips;
  hips.position.y = hips.userData.baseY + (pose.hipsY || 0) / fig.modelScale;

  for (const [name, deg] of Object.entries(pose.joints || {})) {
    const bone = fig.joints[name];
    if (bone) setRelativeEuler(bone, deg);
  }
  fig.root.updateMatrixWorld(true);

  const local = new THREE.Vector3();

  if (pose.feet) {
    for (const side of ['L', 'R']) {
      const t = pose.feet[side];
      if (!t) continue;
      const target = fig.body.localToWorld(local.set(t[0], t[1], t[2])).clone();
      if (t[1] <= 0.13) target.y = fig.ankleY;
      solveLeg(fig, side, target);
      if (target.y < fig.ankleY + 0.05) levelFoot(fig, side);
    }
  }

  if (pose.hands) {
    for (const side of ['L', 'R']) {
      const t = pose.hands[side];
      if (!t) continue;
      const target = fig.body.localToWorld(local.set(t[0], t[1], t[2])).clone();
      solveArm(fig, side, target);
    }
  }

  fig.root.updateMatrixWorld(true);
  if (!opts.transient) {
    scheduleAutosave();
    if (selectedFigure() === fig) renderPanel();
  }
}

function currentPoseData(fig) {
  const data = figureToData(fig);
  return { type: fig.type, joints: data.joints, hipsOffset: data.hipsOffset };
}

function applyCustomPose(fig, entry) {
  if (!poseTypesCompatible(entry.type, fig.type)) {
    toast(`该动作适用于${typeInfo(entry.type).label}，请选择同类角色`);
    return false;
  }
  pushHistorySnapshot();
  resetPose(fig);
  for (const [name, q] of Object.entries(entry.joints || {})) {
    const bone = fig.joints[name];
    if (bone && Array.isArray(q) && q.length === 4) bone.quaternion.fromArray(q);
  }
  fig.joints.hips.position.y =
    fig.joints.hips.userData.baseY + (Number(entry.hipsOffset) || 0) / fig.modelScale;
  fig.root.updateMatrixWorld(true);
  scheduleAutosave();
  renderPanel();
  return true;
}

function applyGroupPose(entry) {
  pushHistorySnapshot();
  rebuildScene({
    version: 2,
    nextId: 1,
    selectedIndex: entry.selectedIndex || 0,
    figures: entry.figures,
  });
  frameAll();
}

// ---------------- history ----------------
function serializeScene() {
  return {
    version: 2,
    nextId,
    selectedIndex: Math.max(0, state.figures.findIndex((f) => f.id === state.selectedId)),
    figures: state.figures.map(figureToData),
  };
}

// Reuse meshes during playback. Only changes in character membership require
// rebuilding the scene; stable track IDs survive undo, refresh and reordering.
function applyMotionScene(data) {
  const matches = state.figures.length === data.figures.length && state.figures.every((fig, i) => fig.trackId === data.figures[i].trackId && fig.type === data.figures[i].type);
  if (!matches) {
    rebuildScene(data);
  }
  data.figures.forEach((fd, index) => {
    const fig = state.figures[index];
    if (fig.updateProp) fig.propState = fig.updateProp(fd.prop || {});
    fig.root.position.fromArray(fd.pos);
    fig.root.rotation.y = fd.rotY;
    setFigureSize(fig, fd.size);
    restoreSampleJoints(fig, fd.joints);
    fig.joints.hips.position.y = fig.joints.hips.userData.baseY + fd.hipsOffset / fig.modelScale;
    fig.root.updateMatrixWorld(true);
    if (fd.travel) applyTravelPose(fig, fd.travel);
  });
  const selectedTrack = data.figures[Math.max(0, Math.min(data.figures.length - 1, Number(data.selectedIndex) || 0))]?.trackId;
  state.selectedId = state.figures.find((fig) => fig.trackId === selectedTrack)?.id ?? null;
}

function pushHistorySnapshot(snapshot = serializeScene()) {
  past.push(snapshot);
  if (past.length > 80) past.shift();
  future.length = 0;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  document.getElementById('undo').disabled = past.length === 0;
  document.getElementById('redo').disabled = future.length === 0;
}

function rebuildScene(data) {
  closePopover();
  closeModal();
  clearPartSelection();
  hideHover();
  for (const fig of state.figures.slice()) removeFigure(fig);
  state.figures = [];
  state.selectedId = null;
  nextId = 1;

  for (const fd of data.figures || []) {
    addFigure(FIGURE_TYPES[fd.type] ? fd.type : 'male', { data: fd });
  }

  const idx = clamp(Number(data.selectedIndex) || 0, 0, Math.max(0, state.figures.length - 1));
  state.selectedId = state.figures[idx]?.id ?? null;
  rebuildPickables();
  renderPanel();
  updateHistoryButtons();
  updateModeUI();
  scheduleAutosave();
}

function undo() {
  if (!past.length) return;
  closePopover();
  future.push(serializeScene());
  const snapshot = past.pop();
  rebuildScene(snapshot);
  updateHistoryButtons();
}

function redo() {
  if (!future.length) return;
  closePopover();
  past.push(serializeScene());
  const snapshot = future.pop();
  rebuildScene(snapshot);
  updateHistoryButtons();
}

// ---------------- pointer interaction ----------------
function pointerNdc(x, y) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((x - rect.left) / rect.width) * 2 - 1,
    -((y - rect.top) / rect.height) * 2 + 1,
  );
}

function dominantJoint(mesh, face) {
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  const map = mesh.userData.boneJoints;
  if (!skinIndex || !skinWeight || !face || !map) return null;
  const totals = new Map();
  for (const vi of [face.a, face.b, face.c]) {
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(vi, k);
      if (!w) continue;
      const joint = map[skinIndex.getComponent(vi, k)];
      if (!joint) continue;
      totals.set(joint, (totals.get(joint) || 0) + w);
    }
  }
  let best = null;
  let bestWeight = -1;
  for (const [joint, weight] of totals) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = joint;
    }
  }
  return best;
}

// Clicking the dark elbow/knee/wrist knob should grab the joint that bends
// there (the child bone), not the limb segment above it.
const DISTAL_JOINT = {
  upperArmL: 'foreArmL',
  upperArmR: 'foreArmR',
  foreArmL: 'handL',
  foreArmR: 'handR',
  thighL: 'shinL',
  thighR: 'shinR',
  shinL: 'footL',
  shinR: 'footR',
  footL: 'toeL',
  footR: 'toeR',
};
const pickPointTmp = new THREE.Vector3();

function nearestJointName(fig, boneName, point) {
  const distal = DISTAL_JOINT[boneName];
  const bone = distal ? fig.joints[distal] : null;
  if (!bone) return boneName;
  bone.getWorldPosition(pickPointTmp);
  return point.distanceTo(pickPointTmp) <= 0.075 * fig.size ? distal : boneName;
}

function pickAt(x, y) {
  const ndc = pointerNdc(x, y);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  for (const hit of hits) {
    const mesh = hit.object;
    const fig = figById(mesh.userData.figureId);
    if (!fig) continue;
    const dominant = mesh.userData.jointName || dominantJoint(mesh, hit.face);
    const boneName = dominant ? nearestJointName(fig, dominant, hit.point) : null;
    if (!boneName || !fig.joints[boneName]) continue;
    return {
      fig,
      mesh,
      boneName,
      label: fig.labels[boneName] || boneName,
      point: hit.point,
    };
  }
  return null;
}

function rayToPlane(x, y, plane) {
  const ndc = pointerNdc(x, y);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

function hideHover() {
  tooltipEl.classList.remove('show');
  canvas.style.cursor = '';
}

function scheduleHover(e) {
  hoverPoint = { x: e.clientX, y: e.clientY };
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (drag) return;
    if (
      rotateGizmo.dragging ||
      rotateGizmo.axis !== null ||
      moveGizmo.dragging ||
      moveGizmo.axis !== null
    ) {
      hideHover();
      return;
    }
    const hit = pickAt(hoverPoint.x, hoverPoint.y);
    if (hit) {
      tooltipEl.textContent = hit.label;
      tooltipEl.style.left = `${hoverPoint.x}px`;
      tooltipEl.style.top = `${hoverPoint.y}px`;
      tooltipEl.classList.add('show');
      canvas.style.cursor = 'grab';
    } else {
      hideHover();
    }
  });
}

canvas.addEventListener('pointerleave', hideHover);

canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (motionStudio?.isPreviewing) return;
    camTween = null;
    if (activePopover) {
      closePopover();
      return;
    }
    if (e.button !== 0) return;
    if (e.pointerType === 'touch' && e.isPrimary === false) return;

    // Let the active gizmo take the gesture before it turns into a pose drag.
    // pointerHover also resolves the handle for touch, which has no hover phase.
    const activeGizmo = state.gizmoMode !== 'rotate' ? moveGizmo : rotateGizmo;
    const activeHelper = state.gizmoMode !== 'rotate' ? moveGizmoHelper : rotateGizmoHelper;
    if (activeHelper.visible && activeGizmo.object) {
      const ndc = pointerNdc(e.clientX, e.clientY);
      activeGizmo.pointerHover({ x: ndc.x, y: ndc.y, button: 0 });
      if (activeGizmo.axis !== null) return;
    }

    const hit = pickAt(e.clientX, e.clientY);
    if (!hit) return;
    const { fig, boneName } = hit;

    e.preventDefault();
    selectPart(fig, boneName);
    const bone = fig.joints[boneName];
    if (!bone) return;

    controls.enabled = false;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    let kind = 'fk';
    if (boneName === 'hips') kind = 'move';
    else if (!ANIMAL_TYPES[fig.type] && state.mode === 'ik' && boneName.startsWith('hand')) kind = 'arm';
    else if (!ANIMAL_TYPES[fig.type] && state.mode === 'ik' && boneName.startsWith('foot')) kind = 'leg';

    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    const pivot = bone.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane();
    if (kind !== 'move') plane.setFromNormalAndCoplanarPoint(normal, pivot);

    let moveRight = null;
    let moveFwd = null;
    let unitsPerPixel = 0;
    if (kind === 'move') {
      // Ground-plane raycasting degenerates when the camera is near eye level,
      // so move by screen delta scaled to the figure's depth instead.
      const dist = camera.position.distanceTo(pivot);
      unitsPerPixel = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
      moveRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0);
      if (moveRight.lengthSq() < 1e-6) moveRight.set(1, 0, 0);
      moveRight.normalize();
      moveFwd = camera.getWorldDirection(new THREE.Vector3()).setY(0);
      if (moveFwd.lengthSq() < 1e-6) moveFwd.set(0, 0, -1);
      moveFwd.normalize();
    }

    drag = {
      kind,
      fig,
      bone,
      boneName,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWorldQuat: bone.getWorldQuaternion(new THREE.Quaternion()),
      plane,
      startRoot: fig.root.position.clone(),
      moveRight,
      moveFwd,
      unitsPerPixel,
      moved: false,
      snapshot: null,
    };
    canvas.style.cursor = 'grabbing';
    hideHover();
  },
  { capture: true },
);

canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    scheduleHover(e);
    return;
  }
  if (e.pointerId !== drag.pointerId) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    drag.snapshot = serializeScene();
  }

  if (drag.kind === 'move') {
    const s = drag.unitsPerPixel;
    const x = drag.startRoot.x + drag.moveRight.x * dx * s + drag.moveFwd.x * -dy * s;
    const z = drag.startRoot.z + drag.moveRight.z * dx * s + drag.moveFwd.z * -dy * s;
    drag.fig.root.position.set(clamp(x, -8, 8), drag.startRoot.y, clamp(z, -8, 8));
    drag.fig.root.updateMatrixWorld(true);
  } else if (drag.kind === 'fk') {
    aimBoneWithPointer(e);
  } else if (drag.kind === 'arm' || drag.kind === 'leg') {
    const hit = rayToPlane(e.clientX, e.clientY, drag.plane);
    if (hit) {
      const side = drag.boneName.slice(-1);
      if (drag.kind === 'arm') {
        solveArm(drag.fig, side, hit);
      } else {
        hit.y = Math.max(hit.y, drag.fig.ankleY);
        solveLeg(drag.fig, side, hit);
        if (hit.y < drag.fig.ankleY + 0.05) levelFoot(drag.fig, side);
      }
      drag.fig.root.updateMatrixWorld(true);
    }
  }

  syncJointUI();
  scheduleAutosave();
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  controls.enabled = true;
  try {
    if (canvas.hasPointerCapture(d.pointerId)) canvas.releasePointerCapture(d.pointerId);
  } catch {
    /* ignore */
  }
  if (d.moved && d.snapshot) {
    past.push(d.snapshot);
    if (past.length > 80) past.shift();
    future.length = 0;
    updateHistoryButtons();
  }
  canvas.style.cursor = '';
  syncJointUI();
  scheduleAutosave();
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', () => {
  camTween = null;
}, { passive: true });

// ---------------- panels ----------------
function figureChips() {
  return state.figures
    .map((f, i) => {
      const active = f.id === state.selectedId ? ' active' : '';
      const name = PROP_TYPES[f.type] ? (f.propState?.label.trim() || typeInfo(f.type).label) : `角色 ${i + 1}`;
      return `<button class="chip${active}" data-action="select-figure" data-id="${f.id}" title="${escapeHtml(name)}"><span class="chip-name">${escapeHtml(name)}</span><span class="sex">${typeInfo(f.type).short}</span></button>`;
    })
    .join('');
}

const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const fingerJointsOf = (side) =>
  FINGER_KEYS.flatMap((key) => [1, 2, 3].map((i) => `${key}${side}${i}`));

const JOINT_GROUPS = [
  { label: '躯干', joints: ['hips', 'spine', 'chest', 'neck', 'head'] },
  { label: '左臂', joints: ['upperArmL', 'foreArmL', 'handL'] },
  { label: '左手指', joints: fingerJointsOf('L') },
  { label: '右臂', joints: ['upperArmR', 'foreArmR', 'handR'] },
  { label: '右手指', joints: fingerJointsOf('R') },
  { label: '左腿', joints: ['thighL', 'shinL', 'footL', 'toeL'] },
  { label: '右腿', joints: ['thighR', 'shinR', 'footR', 'toeR'] },
];

function jointPickerHtml(fig) {
  const current = state.selectedPart?.figureId === fig.id ? state.selectedPart.boneName : '';
  const groups = (fig.config.jointGroups || JOINT_GROUPS).map((group) => {
    const options = group.joints
      .filter((joint) => fig.joints[joint])
      .map((joint) => `<option value="${joint}"${joint === current ? ' selected' : ''}>${fig.labels[joint]}</option>`)
      .join('');
    return options ? `<optgroup label="${group.label}">${options}</optgroup>` : '';
  }).join('');
  return `<select class="joint-select" data-joint-select aria-label="选择关节">
    <option value=""${current ? '' : ' selected'}>选择要调整的关节…</option>
    ${groups}
  </select>`;
}

function jointEditorHtml(fig) {
  const part = state.selectedPart;
  if (!part) {
    if (ANIMAL_TYPES[fig.type]) return `<div class="empty-hint">点击身体、翅膀或尾巴选中关节，再用彩色圆环或滑块调整。<br>动物使用 <b>FK 关节</b>；拖动身体中心可移动角色。<br>姿势库会自动切换为${typeInfo(fig.type).label}的专属动作。</div>`;
    const modeHint =
      state.mode === 'ik'
        ? 'IK 模式：拖动手 / 脚自动弯曲，拖动其他部位旋转关节。'
        : 'FK 模式：拖动任意部位旋转对应关节。';
    return `<div class="empty-hint">点击身体任意部位选中关节。<br>${modeHint}<br><b>拖动骨盆</b>可移动整个角色；底部切到「平移」可沿 XYZ 移动。</div>`;
  }
  const bone = fig.joints[part.boneName];
  if (!bone) {
    return `<div class="empty-hint">该关节不可编辑。</div>`;
  }
  if (part.boneName === 'hips') {
    return `<div class="joint-title"><span class="joint-dot"></span>${fig.labels.hips}</div>
      <div class="joint-meta">拖动${fig.labels.hips}可在地面移动；底部「平移」手柄可沿 X / Y / Z 移动整个角色；「朝向」旋转角色。</div>`;
  }

  const rel = relativeEuler(bone).map((v) => wrapDeg(v));
  const axes = ['X', 'Y', 'Z'];
  const sliders = axes
    .map(
      (axis, i) => `<div class="slider-row">
        <span class="axis">${axis}</span>
        <input type="range" min="-180" max="180" step="0.5" value="${rel[i].toFixed(1)}"
          data-joint-axis="${i}" data-bone="${part.boneName}" aria-label="${part.label} ${axis} 轴">
        <output>${fmtDeg(rel[i])}</output>
      </div>`,
    )
    .join('');
  let meta = '拖动关节旋转，滑块可做精确微调。';
  if (state.gizmoMode === 'move') meta = '平移模式：拖动 XYZ 箭头移动整个角色；切回「旋转」调整当前关节。';
  else if (FINGER_KEYS.some((key) => part.boneName.startsWith(key)))
    meta = '拖动或滑动 X 轴弯曲手指；Y / Z 轴可左右摆动。';
  else if (part.boneName.startsWith('hand'))
    meta = 'IK 模式拖动手会调整整条手臂；滑块微调手腕角度，下拉菜单可直接选手指关节。';
  else if (part.boneName.startsWith('foot')) meta = 'IK 模式拖动脚会调整整条腿；滑块微调脚踝角度。';

  return `<div class="joint-title"><span class="joint-dot"></span>${part.label}</div>
    <div class="joint-meta">${meta}</div>
    ${sliders}
    <div class="btn-row" style="margin-top:10px">
      <button class="btn" data-action="reset-joint">恢复此关节</button>
    </div>`;
}

function rotationDegrees(fig) {
  const d = (fig.root.rotation.y / DEG) % 360;
  return (d + 360) % 360;
}

function renderPropPanel(fig) {
  const info = PROP_TYPES[fig.type];
  const value = fig.propState;
  const axes = ['X', 'Y', 'Z'];
  const rotations = relativeEuler(fig.joints.hips).map(wrapDeg);
  const dimensions = fig.type === 'cuboid' ? [['宽 X', 0], ['高 Y', 1], ['深 Z', 2]]
    : fig.type === 'cylinder' ? [['直径', 0], ['高度', 1]]
      : [[fig.type === 'sphere' ? '直径' : '边长', 0]];
  panelEl.innerHTML = `
    <div class="panel-head"><div>
      <div class="panel-title">${escapeHtml(value.label.trim() || info.label)}<span class="dot"></span></div>
      <div class="panel-sub">${info.label} · 可标记、移动和定格</div>
    </div></div>
    <div class="chips">${figureChips()}<button class="chip chip-add" data-action="add-figure" title="添加角色或物品"><span data-icon="plus"></span></button></div>
    <div class="section">
      <label class="section-label" for="prop-label">数字 / 名称标记</label>
      <input class="text-input" id="prop-label" data-prop-label maxlength="24" value="${escapeHtml(value.label)}" placeholder="例如：1、箱子 A、桌面" aria-label="物品数字或名称" autocomplete="off">
      <div class="prop-label-options">
        <label><input type="checkbox" data-prop-show-label${value.showLabel ? ' checked' : ''}>显示标记</label>
        <label>物品颜色<input type="color" data-prop-color value="${value.color}" aria-label="物品颜色"></label>
      </div>
      <div class="joint-meta">输入后按回车或点击其他位置应用；清空文字可移除标记。</div>
    </div>
    <div class="section">
      <div class="section-label">尺寸 <span class="aside">米 · 0.05–6</span></div>
      <div class="prop-fields">${dimensions.map(([name, axis]) => `<label>${name}<input type="number" min="0.05" max="6" step="0.05" value="${Number(value.dimensions[axis].toFixed(3))}" data-prop-dimension="${axis}" aria-label="${info.label}${name}"></label>`).join('')}</div>
      <button class="btn" style="margin-top:9px" data-action="prop-gizmo" data-gizmo-mode="scale">尺寸手柄</button>
      <div class="joint-meta">拖动彩色轴调整尺寸；中心方块等比缩放。${fig.type === 'cube' || fig.type === 'sphere' ? '此物品保持等比。' : fig.type === 'cylinder' ? 'X / Z 调直径，Y 调高度。' : 'X 调宽，Y 调高，Z 调深。'}</div>
    </div>
    <div class="section">
      <div class="section-label">位置 <span class="aside">米 · Y 为离地高度</span></div>
      <div class="prop-fields">${axes.map((axis, i) => `<label>${axis}<input type="number" min="-20" max="20" step="0.05" value="${fig.root.position.getComponent(i).toFixed(2)}" data-prop-position="${i}" aria-label="物品位置 ${axis}"></label>`).join('')}</div>
      <div class="btn-row" style="margin-top:9px">
        <button class="btn" data-action="prop-gizmo" data-gizmo-mode="move"><span data-icon="move"></span>移动手柄</button>
        <button class="btn" data-action="prop-ground">摆正并落地</button>
      </div>
    </div>
    <div class="section">
      <div class="section-label">旋转 <span class="aside">度</span></div>
      ${axes.map((axis, i) => `<div class="slider-row"><span class="axis">${axis}</span><input type="range" min="-180" max="180" step="0.5" data-prop-rotation="${i}" value="${rotations[i].toFixed(1)}" aria-label="物品旋转 ${axis}"><output>${fmtDeg(rotations[i])}</output></div>`).join('')}
      <button class="btn" data-action="prop-gizmo" data-gizmo-mode="rotate"><span data-icon="rotate"></span>旋转手柄</button>
    </div>
    <div class="panel-actions">
      <button class="btn" data-action="duplicate"><span data-icon="duplicate"></span>复制物品</button>
      <button class="btn danger" data-action="delete"><span data-icon="trash"></span>删除物品</button>
    </div>
    <div class="btn-row" style="margin-top:9px"><button class="btn" data-action="save-pose" data-scope="group"><span data-icon="bookmark"></span>保存场景组合</button></div>
    <div class="panel-footnote">尺寸支持数值输入和手柄拖动；名称与尺寸会随场景保存，也会进入同一条定格、录制轨道。</div>`;
  mountIcons(panelEl);
}

// Keep the actual input/button nodes in place when an input commits on blur.
// Rebuilding the panel here would remove the user's next click target.
function syncPropPanelProperties(fig) {
  const value = fig.propState;
  const name = value.label.trim() || typeInfo(fig.type).label;
  const title = panelEl.querySelector('.panel-title');
  if (title?.firstChild?.nodeType === Node.TEXT_NODE) title.firstChild.textContent = name;
  const chip = panelEl.querySelector(`[data-action="select-figure"][data-id="${fig.id}"]`);
  if (chip) {
    chip.title = name;
    const text = chip.querySelector('.chip-name');
    if (text) text.textContent = name;
  }
  panelEl.querySelector('[data-prop-label]').value = value.label;
  panelEl.querySelector('[data-prop-color]').value = value.color;
  panelEl.querySelector('[data-prop-show-label]').checked = value.showLabel;
  panelEl.querySelectorAll('[data-prop-dimension]').forEach((field) => { field.value = Number(value.dimensions[Number(field.dataset.propDimension)].toFixed(3)); });
  panelEl.querySelectorAll('[data-prop-position]').forEach((field) => { field.value = fig.root.position.getComponent(Number(field.dataset.propPosition)).toFixed(2); });
}

function renderPanel() {
  const fig = selectedFigure();
  updateModeUI();
  if (!fig) {
    panelEl.innerHTML = `
      <div class="panel-head">
        <div>
          <div class="panel-title"><span class="dot"></span>场景</div>
          <div class="panel-sub">还没有角色</div>
        </div>
      </div>
      <div class="empty-hint">用左上方 <b>添加角色</b> 开始。<br>可以添加多个角色，在同一画面里摆组合姿势。</div>
      <div class="panel-actions">
        <button class="btn primary" data-action="add-figure"><span data-icon="addUser"></span>添加角色</button>
      </div>`;
    mountIcons(panelEl);
    return;
  }

  if (PROP_TYPES[fig.type]) {
    renderPropPanel(fig);
    return;
  }

  const idx = state.figures.indexOf(fig) + 1;
  const rot = Math.round(rotationDegrees(fig));
  const sizePct = Math.round(fig.size * 100);
  panelEl.innerHTML = `
    <div class="panel-head">
      <div>
        <div class="panel-title">${typeInfo(fig.type).label} · ${idx}<span class="dot"></span></div>
        <div class="panel-sub">${typeInfo(fig.type).body} · 人和动物可同框</div>
      </div>
    </div>
    <div class="chips">
      ${figureChips()}
      <button class="chip chip-add" data-action="add-figure" title="添加角色"><span data-icon="plus"></span></button>
    </div>
    <div class="section">
      <div class="section-label">关节 <span class="aside">${ANIMAL_TYPES[fig.type] ? 'FK 旋转' : state.mode === 'ik' ? 'IK 拖拽' : 'FK 旋转'}</span></div>
      ${jointPickerHtml(fig)}
      ${jointEditorHtml(fig)}
    </div>
    <div class="section">
      <div class="section-label">姿势</div>
      <div class="btn-row">
        <button class="btn" data-action="reset-pose"><span data-icon="undo"></span>重置姿势</button>
        <button class="btn" data-action="open-poses"><span data-icon="poses"></span>姿势库</button>
      </div>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn" data-action="save-pose" data-scope="single"><span data-icon="bookmark"></span>保存角色</button>
        <button class="btn" data-action="save-pose" data-scope="group"><span data-icon="duplicate"></span>保存组合</button>
      </div>
    </div>
    <div class="section">
      <div class="section-label">朝向 <span class="aside">拖动${fig.labels.hips}可移动</span></div>
      <div class="slider-row">
        <span class="axis">Y</span>
        <input type="range" min="0" max="360" step="1" value="${rot}" data-rot-y aria-label="角色朝向">
        <output>${rot}°</output>
      </div>
    </div>
    <div class="section">
      <div class="section-label">大小 <span class="aside">整体等比缩放</span></div>
      <div class="slider-row">
        <span class="axis">%</span>
        <input type="range" min="25" max="200" step="1" value="${sizePct}" data-figure-size aria-label="角色大小">
        <output>${sizePct}%</output>
      </div>
    </div>
    <div class="panel-actions">
      <button class="btn" data-action="duplicate"><span data-icon="duplicate"></span>复制</button>
      <button class="btn danger" data-action="delete"><span data-icon="trash"></span>删除</button>
    </div>
    <div class="panel-footnote">${ANIMAL_TYPES[fig.type] ? '动物参考模型 · 点选关节后旋转，侧栏滑块精修角度；切到「平移」可上下移动。飞行动作为静态姿势参考。' : '点选关节后用彩色圆环旋转；底部切到「平移」可拖动箭头移动人物；拖动手脚摆 IK。侧栏滑杆精修角度。'}</div>`;
  mountIcons(panelEl);
}

function syncJointUI() {
  const fig = selectedFigure();
  if (fig && PROP_TYPES[fig.type]) {
    const angles = relativeEuler(fig.joints.hips).map(wrapDeg);
    panelEl.querySelectorAll('[data-prop-rotation]').forEach((input) => {
      if (document.activeElement === input) return;
      input.value = angles[Number(input.dataset.propRotation)].toFixed(1);
      input.parentElement.querySelector('output').textContent = fmtDeg(Number(input.value));
    });
    panelEl.querySelectorAll('[data-prop-position]').forEach((input) => {
      if (document.activeElement !== input) input.value = fig.root.position.getComponent(Number(input.dataset.propPosition)).toFixed(2);
    });
    panelEl.querySelectorAll('[data-prop-dimension]').forEach((input) => {
      if (document.activeElement !== input) input.value = Number(fig.propState.dimensions[Number(input.dataset.propDimension)].toFixed(3));
    });
    return;
  }
  const part = state.selectedPart;
  if (!fig || !part) return;
  const bone = fig.joints[part.boneName];
  if (!bone) return;
  const rel = relativeEuler(bone).map((v) => wrapDeg(v));
  panelEl.querySelectorAll('[data-joint-axis]').forEach((input) => {
    if (document.activeElement === input) return;
    const i = Number(input.dataset.jointAxis);
    input.value = rel[i].toFixed(1);
    const out = input.parentElement.querySelector('output');
    if (out) out.textContent = fmtDeg(rel[i]);
  });
}

function renderAll() {
  renderPanel();
}

// ---------------- panel events ----------------
panelEl.addEventListener('click', (e) => {
  if (motionStudio?.isPreviewing) return;
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const fig = selectedFigure();

  if (action === 'add-figure') {
    openFiguresPopover(document.querySelector('[data-tool="figures"]'));
    return;
  }
  if (action === 'select-figure') {
    selectFigureById(Number(btn.dataset.id));
    return;
  }
  if (!fig) return;

  if (PROP_TYPES[fig.type] && action === 'prop-gizmo') {
    setGizmoMode(btn.dataset.gizmoMode);
    selectPart(fig, 'hips');
    return;
  }
  if (PROP_TYPES[fig.type] && action === 'prop-ground') {
    pushHistorySnapshot();
    fig.root.position.y = 0;
    fig.root.rotation.set(0, 0, 0);
    fig.joints.hips.quaternion.copy(fig.joints.hips.userData.rest);
    fig.joints.hips.position.y = fig.joints.hips.userData.baseY;
    fig.root.updateMatrixWorld(true);
    renderPanel();
    scheduleAutosave();
    return;
  }

  if (action === 'open-poses') {
    openPosesPopover(document.querySelector('[data-tool="poses"]'));
  } else if (action === 'save-pose') {
    openSavePoseModal({ scope: btn.dataset.scope || 'single' });
  } else if (action === 'reset-pose') {
    pushHistorySnapshot();
    resetPose(fig);
    scheduleAutosave();
    renderPanel();
    toast('已恢复初始姿势');
  } else if (action === 'reset-joint' && state.selectedPart) {
    const bone = fig.joints[state.selectedPart.boneName];
    if (bone) {
      pushHistorySnapshot();
      bone.quaternion.copy(bone.userData.rest);
      fig.root.updateMatrixWorld(true);
      renderPanel();
      scheduleAutosave();
      toast('已恢复该关节');
    }
  } else if (action === 'duplicate') {
    pushHistorySnapshot();
    const srcData = figureToData(fig);
    srcData.trackId = makeId();
    srcData.pos = [nextFigureX(), 0, 0];
    const fig2 = addFigure(fig.type, { data: srcData });
    state.selectedId = fig2.id;
    clearPartSelection();
    renderPanel();
    frameAll();
    scheduleAutosave();
    toast(PROP_TYPES[fig.type] ? '已复制物品和标记' : '已复制角色');
  } else if (action === 'delete') {
    pushHistorySnapshot();
    const index = state.figures.indexOf(fig);
    clearPartSelection();
    removeFigure(fig);
    const next = state.figures[Math.min(index, state.figures.length - 1)];
    state.selectedId = next?.id ?? null;
    renderPanel();
    scheduleAutosave();
    toast(PROP_TYPES[fig.type] ? '已删除物品' : '已删除角色');
  }
});

panelEl.addEventListener('change', (e) => {
  if (motionStudio?.isPreviewing) return;
  const fig = selectedFigure();
  if (fig && PROP_TYPES[fig.type] && e.target.matches('[data-prop-label], [data-prop-color], [data-prop-show-label], [data-prop-dimension], [data-prop-position]')) {
    const input = e.target;
    if ((input.matches('[data-prop-dimension], [data-prop-position]')) && (!input.value.trim() || !Number.isFinite(Number(input.value)))) {
      syncPropPanelProperties(fig);
      return;
    }
    pushHistorySnapshot();
    const value = normalizeProp(fig.type, fig.propState);
    if (input.matches('[data-prop-label]')) value.label = input.value;
    if (input.matches('[data-prop-color]')) value.color = input.value;
    if (input.matches('[data-prop-show-label]')) value.showLabel = input.checked;
    if (input.matches('[data-prop-dimension]')) value.dimensions[Number(input.dataset.propDimension)] = Number(input.value);
    if (input.matches('[data-prop-position]')) fig.root.position.setComponent(Number(input.dataset.propPosition), clamp(Number(input.value), -20, 20));
    fig.propState = fig.updateProp(value);
    fig.root.updateMatrixWorld(true);
    scheduleAutosave();
    syncPropPanelProperties(fig);
    return;
  }
  const picker = e.target.closest('[data-joint-select]');
  if (!picker) return;
  if (fig && picker.value && fig.joints[picker.value]) selectPart(fig, picker.value);
});

panelEl.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target.matches('input[type="range"]')) {
      sliderPendingSnapshot = serializeScene();
    }
  },
  { capture: true },
);

panelEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-prop-label], [data-prop-dimension], [data-prop-position]')) {
    e.preventDefault();
    e.target.blur();
    return;
  }
  if (e.target.matches('input[type="range"]') && !sliderPendingSnapshot) {
    sliderPendingSnapshot = serializeScene();
  }
});

function commitSliderSnapshot() {
  if (sliderPendingSnapshot) {
    pushHistorySnapshot(sliderPendingSnapshot);
    sliderPendingSnapshot = null;
  }
}

panelEl.addEventListener('input', (e) => {
  if (motionStudio?.isPreviewing) return;
  const input = e.target;
  const fig = selectedFigure();
  if (!fig) return;

  if (PROP_TYPES[fig.type] && input.matches('[data-prop-rotation]')) {
    commitSliderSnapshot();
    const angles = [0, 0, 0];
    panelEl.querySelectorAll('[data-prop-rotation]').forEach((field) => { angles[Number(field.dataset.propRotation)] = Number(field.value); });
    setRelativeEuler(fig.joints.hips, angles);
    fig.root.updateMatrixWorld(true);
    input.parentElement.querySelector('output').textContent = fmtDeg(Number(input.value));
    scheduleAutosave();
  } else if (input.matches('[data-joint-axis]')) {
    commitSliderSnapshot();
    const bone = fig.joints[input.dataset.bone];
    if (!bone) return;
    const deg = [0, 0, 0];
    panelEl.querySelectorAll(`[data-joint-axis][data-bone="${input.dataset.bone}"]`).forEach((inp) => {
      deg[Number(inp.dataset.jointAxis)] = Number(inp.value);
    });
    setRelativeEuler(bone, deg);
    fig.root.updateMatrixWorld(true);
    const out = input.parentElement.querySelector('output');
    if (out) out.textContent = fmtDeg(Number(input.value));
    scheduleAutosave();
  } else if (input.matches('[data-rot-y]')) {
    commitSliderSnapshot();
    const value = Number(input.value);
    fig.root.rotation.y = value * DEG;
    fig.root.updateMatrixWorld(true);
    const out = input.parentElement.querySelector('output');
    if (out) out.textContent = `${Math.round(value)}°`;
    scheduleAutosave();
  } else if (input.matches('[data-figure-size]')) {
    commitSliderSnapshot();
    const pct = Number(input.value);
    setFigureSize(fig, pct / 100);
    const out = input.parentElement.querySelector('output');
    if (out) out.textContent = `${Math.round(pct)}%`;
    scheduleAutosave();
  }
});

window.addEventListener('pointerup', () => {
  sliderPendingSnapshot = null;
});

// ---------------- camera ----------------
function flyTo(pos, target, duration = 520) {
  camTween = {
    p0: camera.position.clone(),
    p1: pos.clone(),
    t0: controls.target.clone(),
    t1: target.clone(),
    start: performance.now(),
    duration,
  };
}

function panelOcclusion() {
  if (window.innerWidth <= 760) return 0;
  const rect = panelEl.getBoundingClientRect();
  return rect.width > 0 ? rect.width + 14 : 0;
}

function sceneFit() {
  const box = new THREE.Box3();
  for (const fig of state.figures) {
    fig.root.updateMatrixWorld(true);
    box.expandByObject(fig.root);
  }
  if (box.isEmpty()) {
    return { center: new THREE.Vector3(0, 0.94, 0), distance: 3.6 };
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const vfov = camera.fov * DEG;
  const freeW = window.innerWidth - panelOcclusion();
  const motionHeight = document.getElementById('motion-studio')?.hidden === false ? document.getElementById('motion-studio').getBoundingClientRect().height + 14 : 0;
  const topHeight = document.querySelector('.topbar').getBoundingClientRect().bottom;
  const freeH = Math.max(window.innerHeight * 0.3, window.innerHeight - motionHeight - topHeight - 16);
  const freeAspect = freeW / window.innerHeight;
  const distV = size.y / (2 * Math.tan(vfov / 2)) * window.innerHeight / freeH;
  const distH = size.x / (2 * Math.tan(vfov / 2) * freeAspect);
  const distance = clamp(Math.max(distV, distH) * 1.22 + 0.35, 2.9, 12);
  center.y = clamp(center.y, 0.55, 1.35);
  return { center, distance };
}

function frameAll(fly = true) {
  if (!state.figures.length) return;
  const { center, distance } = sceneFit();
  let dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 0.001) dir.set(2.2, 1.2, 3.2);
  dir.normalize();
  const pos = center.clone().addScaledVector(dir, distance);
  if (pos.y < 0.35) pos.y = 0.35;
  if (fly) flyTo(pos, center);
  else {
    camera.position.copy(pos);
    controls.target.copy(center);
    controls.update();
  }
}

function setView(name) {
  const { center, distance } = state.figures.length ? sceneFit() : { center: new THREE.Vector3(0, 0.94, 0), distance: 3.6 };
  const d = distance;
  const map = {
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    top: new THREE.Vector3(0.001, 1, 0.001),
    persp: new THREE.Vector3(0.52, 0.32, 0.78),
  };
  const dir = (map[name] || map.persp).clone().normalize();
  const target = center.clone();
  if (name === 'top') target.y = Math.max(0.6, center.y - 0.2);
  const pos = target.clone().addScaledVector(dir, d);
  if (name !== 'top') pos.y = Math.max(pos.y, target.y + 0.15);
  flyTo(pos, target);
}

// ---------------- UI: popovers ----------------
function closePopover() {
  if (!activePopover) return;
  activePopover.anchor?.classList.remove('on');
  activePopover.el.remove();
  activePopover = null;
}

function openPopover(tool, anchor, html, width = 300) {
  if (activePopover?.tool === tool) {
    closePopover();
    return null;
  }
  closePopover();
  const el = document.createElement('div');
  el.className = 'popover';
  el.style.width = `${width}px`;
  el.innerHTML = html;
  popRoot.appendChild(el);
  mountIcons(el);

  const rect = anchor.getBoundingClientRect();
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  el.style.left = `${left}px`;
  el.style.top = `${rect.bottom + 8}px`;

  anchor.classList.add('on');
  activePopover = { tool, el, anchor };
  el.addEventListener('click', onPopoverClick);
  return el;
}

function popoverHead(title, sub) {
  return `<div class="popover-head">
    <div><div class="popover-title">${title}</div><div class="popover-sub">${sub}</div></div>
    <button class="icon-plain" data-close aria-label="关闭"><span data-icon="close"></span></button>
  </div>`;
}

function propTilesHtml() {
  return `<div class="catalog-label">基础物品 <span>支持数字与名称标记</span></div>
    <div class="figure-tiles prop-tiles">${Object.entries(PROP_TYPES).map(([type, info]) => `<button class="figure-tile" data-add-figure="${type}"><span class="ico" data-icon="${info.icon}"></span><span class="tname">${info.label}</span><span class="tsub">${info.sub}</span></button>`).join('')}</div>
    <p class="catalog-note">添加后在右侧填写数字或名称，调整尺寸、位置和颜色。</p>`;
}

function openFiguresPopover(anchor, onlyProps = false) {
  if (onlyProps) {
    openPopover('props', anchor, `${popoverHead('添加物品', '与人物、动物同框，也能定格和录制')}${propTilesHtml()}`, 312);
    return;
  }
  openPopover(
    'figures',
    anchor,
    `${popoverHead('添加角色', '人物与动物可以在同一画面里摆姿势')}
     <div class="catalog-label">人物 <span>原有模型</span></div>
     <div class="figure-tiles">
       <button class="figure-tile" data-add-figure="male">
         <span class="ico" data-icon="male"></span>
         <span class="tname">男性</span><span class="tsub">蓝色运动装</span>
       </button>
       <button class="figure-tile" data-add-figure="female">
         <span class="ico" data-icon="female"></span>
         <span class="tname">女性</span><span class="tsub">红色运动装</span>
       </button>
       <button class="figure-tile" data-add-figure="boy">
         <span class="ico" data-icon="boy"></span>
         <span class="tname">小孩</span><span class="tsub">绿色运动装</span>
       </button>
     </div>
     <div class="catalog-label">动物 <span>可编辑关节 · 专属姿势</span></div>
     <div class="figure-tiles animal-tiles">
       ${Object.entries(ANIMAL_TYPES).map(([type, info]) => `<button class="figure-tile" data-add-figure="${type}">
         <span class="ico" data-icon="${info.icon}"></span>
         <span class="tname">${info.category}</span><span class="tsub">${info.model}代表模型</span>
         <span class="tile-detail">${info.sub}</span>
       </button>`).join('')}
     </div>
     <p class="catalog-note">蜥蜴作为爬行动物的代表模型，鸟作为飞行动物的代表模型。均支持 FK 关节摆姿、缩放、复制与保存。</p>
     ${propTilesHtml()}`,
    292,
  );
}

function customPoseSearchText(p) {
  if (p.kind === 'group') {
    const types = [...new Set((p.figures || []).map((fd) => typeInfo(fd.type).short))].join('');
    return `${p.name} 组合 多人 场景 ${p.figures.length} 个角色 ${types}`;
  }
  return `${p.name} 单角色 ${typeInfo(p.type).label} ${typeInfo(p.type).short}`;
}

function customPoseListHtml() {
  if (!customPoses.length) {
    return `<div class="pop-empty">还没有保存的动作。摆好后点「保存角色」或「保存组合」，会存在本机浏览器里。</div>`;
  }
  return customPoses
    .map((p) => {
      const group = p.kind === 'group';
      const compatible = group || (selectedFigure() && poseTypesCompatible(p.type, selectedFigure().type));
      const meta = group
        ? `组合 · ${p.figures.length} 个角色 · ${poseStamp(p.createdAt)}`
        : `${typeInfo(p.type).label} · ${poseStamp(p.createdAt)}`;
      return `<div class="custom-pose" data-search="${escapeHtml(customPoseSearchText(p).toLowerCase())}">
        <button class="cp-main" data-apply-custom="${p.id}"${compatible ? '' : ` disabled title="请选择${typeInfo(p.type).label}后应用"`}>
          <span class="cp-title">
            <span class="cp-name">${escapeHtml(p.name)}</span>
            ${group ? '<span class="cp-badge">组合</span>' : ''}
          </span>
          <span class="cp-meta">${meta}</span>
        </button>
        <button class="cp-del" data-delete-pose="${p.id}" title="删除这个动作" aria-label="删除 ${escapeHtml(p.name)}">
          <span data-icon="trash"></span>
        </button>
      </div>`;
    })
    .join('');
}

function applyCustomSearch(query) {
  const q = String(query || '').trim().toLowerCase();
  const list = document.querySelector('[data-custom-list]');
  if (!list) return;
  let shown = 0;
  list.querySelectorAll('.custom-pose').forEach((node) => {
    const hit = !q || (node.dataset.search || '').includes(q);
    node.hidden = !hit;
    if (hit) shown += 1;
  });
  const empty = document.querySelector('[data-search-empty]');
  if (empty) empty.hidden = !q || shown > 0 || !customPoses.length;
  const count = document.querySelector('[data-custom-count]');
  if (count) {
    count.textContent = q && customPoses.length ? `${shown}/${customPoses.length}` : String(customPoses.length);
  }
}

function openPosesPopover(anchor) {
  const fig = selectedFigure();
  const cards = (fig && !PROP_TYPES[fig.type] ? posesForType(fig.type) : []).map(
    (p, i) => `<button class="pose-card" data-pose="${p.id}">
      <span class="pose-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="pname">${p.name}</span>
      <span class="phint">${p.hint}</span>
    </button>`,
  ).join('');
  const el = openPopover(
    'poses',
    anchor,
    `${popoverHead('姿势库', fig ? `${typeInfo(fig.type).label}${PROP_TYPES[fig.type] ? ' · 请在右侧调整物品，或载入场景组合' : '专属 · 点击应用到当前角色'}` : '请先添加一个角色')}<div class="pose-grid">${cards}</div>
     <div class="popover-sep"></div>
     <div class="custom-head">
       <div class="section-label">我的动作库 <span class="aside" data-custom-count>${customPoses.length}</span></div>
       <div class="custom-actions">
         <button class="btn tiny" data-action="save-pose" data-scope="single"><span data-icon="bookmark"></span>保存角色</button>
         <button class="btn tiny" data-action="save-pose" data-scope="group"><span data-icon="duplicate"></span>保存组合</button>
       </div>
     </div>
     <input class="text-input search-input" type="search" data-custom-search placeholder="搜索动作名称或类型" autocomplete="off" spellcheck="false" aria-label="搜索我的动作">
     <div class="custom-list" data-custom-list>${customPoseListHtml()}</div>
     <div class="pop-empty" data-search-empty hidden>没有找到匹配的动作。</div>`,
    312,
  );
  if (!el) return;
  const search = el.querySelector('[data-custom-search]');
  if (search) {
    search.addEventListener('input', () => applyCustomSearch(search.value));
    applyCustomSearch(search.value);
  }
}

function openViewPopover(anchor) {
  openPopover(
    'view',
    anchor,
    `${popoverHead('视角', '只改变观察角度，不影响姿势')}
     <div class="view-grid">
       <button class="btn" data-view="front">正面</button>
       <button class="btn" data-view="back">背面</button>
       <button class="btn" data-view="left">左侧</button>
       <button class="btn" data-view="right">右侧</button>
       <button class="btn" data-view="top">顶部</button>
       <button class="btn" data-view="persp">透视</button>
     </div>
     <div class="btn-row" style="margin-top:8px">
       <button class="btn" data-action="frame-all" style="width:100%">框选全部角色</button>
     </div>`,
    252,
  );
}

function settingsBody() {
  const swatches = Object.entries(THEMES)
    .map(
      ([key, t]) =>
        `<button class="swatch${settings.theme === key ? ' active' : ''}" data-theme="${key}" style="background:${t.swatch}" title="${key === 'gray' ? '浅灰' : key === 'warm' ? '暖白' : '深灰'}"></button>`,
    )
    .join('');
  return `${popoverHead('场景设置', '影棚氛围与显示')}
    <div class="setting">
      <div><span class="setting-label">背景</span><span class="setting-sub">影棚色调</span></div>
      <div class="theme-row">${swatches}</div>
    </div>
    <div class="setting">
      <div><span class="setting-label">地面网格</span><span class="setting-sub">0.5 米间距</span></div>
      <button class="switch${settings.grid ? ' on' : ''}" data-grid-toggle aria-label="地面网格"></button>
    </div>
    <div class="setting">
      <div><span class="setting-label">主光强度</span></div>
      <input type="range" min="0.4" max="3.2" step="0.05" value="${keyLight.intensity}" data-light style="width:104px">
    </div>
    <div class="setting">
      <div><span class="setting-label">清空场景</span><span class="setting-sub">可撤销</span></div>
      <button class="btn danger" data-clear>清空</button>
    </div>`;
}

function openSettingsPopover(anchor) {
  const el = openPopover('settings', anchor, settingsBody(), 300);
  if (!el) return;
  const light = el.querySelector('[data-light]');
  light?.addEventListener('input', () => {
    settings.light = Number(light.value);
    keyLight.intensity = settings.light;
    saveSettings();
  });
}

function onPopoverClick(e) {
  if (e.target.closest('[data-close]')) {
    closePopover();
    return;
  }
  const add = e.target.closest('[data-add-figure]');
  if (add) {
    addFigureAction(add.dataset.addFigure);
    return;
  }
  const savePoseBtn = e.target.closest('[data-action="save-pose"]');
  if (savePoseBtn) {
    openSavePoseModal({ reopen: true, scope: savePoseBtn.dataset.scope || 'single' });
    return;
  }
  const customPoseBtn = e.target.closest('[data-apply-custom]');
  if (customPoseBtn) {
    const entry = customPoses.find((p) => p.id === customPoseBtn.dataset.applyCustom);
    if (!entry) return;
    if (entry.kind === 'group') {
      applyGroupPose(entry);
      closePopover();
      toast(`已应用组合「${entry.name}」· ${entry.figures.length} 个角色`);
      return;
    }
    const fig = selectedFigure();
    if (!fig) {
      toast('请先添加角色');
      return;
    }
    if (!applyCustomPose(fig, entry)) return;
    closePopover();
    toast(`已应用「${entry.name}」`);
    return;
  }
  const deletePoseBtn = e.target.closest('[data-delete-pose]');
  if (deletePoseBtn) {
    openDeletePoseConfirm(deletePoseBtn.dataset.deletePose);
    return;
  }
  const poseBtn = e.target.closest('[data-pose]');
  if (poseBtn) {
    const fig = selectedFigure();
    if (!fig) {
      toast('请先添加角色');
      return;
    }
    const pose = posesForType(fig.type).find((entry) => entry.id === poseBtn.dataset.pose);
    if (pose) {
      applyPoseToFigure(fig, pose);
      closePopover();
      toast(`已应用「${pose.name}」`);
      if (ANIMAL_TYPES[fig.type]) frameAll();
    }
    return;
  }
  const viewBtn = e.target.closest('[data-view]');
  if (viewBtn) {
    setView(viewBtn.dataset.view);
    closePopover();
    return;
  }
  if (e.target.closest('[data-action="frame-all"]')) {
    frameAll();
    closePopover();
    return;
  }
  const themeBtn = e.target.closest('[data-theme]');
  if (themeBtn) {
    settings.theme = themeBtn.dataset.theme;
    applyTheme();
    saveSettings();
    return;
  }
  if (e.target.closest('[data-grid-toggle]')) {
    settings.grid = !settings.grid;
    applyTheme();
    saveSettings();
    return;
  }
  if (e.target.closest('[data-clear]')) {
    openClearConfirm();
  }
}

document.addEventListener(
  'pointerdown',
  (e) => {
    if (!activePopover) return;
    if (e.target === canvas) return;
    if (e.target.closest('.popover') || e.target.closest('.tool')) return;
    closePopover();
  },
  true,
);

// ---------------- add / duplicate helpers ----------------
function addFigureAction(type) {
  pushHistorySnapshot();
  const fig = addFigure(type);
  state.selectedId = fig.id;
  clearPartSelection();
  closePopover();
  renderPanel();
  if (state.figures.length > 1) frameAll();
  scheduleAutosave();
  toast(`${typeInfo(type).label}已添加`);
}

// ---------------- mode ----------------
function updateModeUI() {
  const type = selectedFigure()?.type;
  const rigid = Boolean(PROP_TYPES[type]);
  if (!rigid && state.gizmoMode === 'scale') state.gizmoMode = 'rotate';
  updateGizmoSwitchUI();
  const animal = Boolean(ANIMAL_TYPES[type]) || rigid;
  document.querySelectorAll('#mode-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === (animal ? 'fk' : state.mode));
    b.disabled = animal && b.dataset.mode === 'ik';
    if (b.dataset.mode === 'ik') b.title = rigid ? '物品使用平移和旋转手柄' : animal ? '动物使用 FK 关节调整；IK 拖拽适用于人物' : '拖动手脚自动弯曲四肢，拖其他部位旋转关节';
  });
}

function setMode(mode) {
  state.mode = mode;
  settings.mode = mode;
  saveSettings();
  updateModeUI();
  renderPanel();
  scheduleAutosave();
}

function updateGizmoSwitchUI() {
  document.querySelectorAll('#gizmo-switch button').forEach((b) => {
    if (b.dataset.gizmo === 'scale') b.hidden = !PROP_TYPES[selectedFigure()?.type];
    b.classList.toggle('active', b.dataset.gizmo === state.gizmoMode);
  });
}

function setGizmoMode(mode) {
  if (!['move', 'rotate', 'scale'].includes(mode)) return;
  if (mode === 'scale' && !PROP_TYPES[selectedFigure()?.type]) return;
  if (mode === state.gizmoMode) return;
  state.gizmoMode = mode;
  if (mode === 'move' || mode === 'scale') {
    const fig = selectedFigure();
    if (!fig) {
      state.gizmoMode = 'rotate';
      updateGizmoSwitchUI();
      toast('请先添加角色');
      return;
    }
    if (!state.selectedPart) selectPart(fig, 'hips');
  }
  updateGizmoSwitchUI();
  updateSelectionMarker();
  renderPanel();
}

// ---------------- help / onboarding ----------------
function openHelp() {
  closePopover();
  modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal" role="dialog" aria-modal="true" aria-label="操作说明">
      <div class="modal-head">
        <div>
          <h2>操作说明</h2>
          <p class="modal-sub">码上动 · 三维动作创作工作台</p>
        </div>
        <button class="icon-plain" data-close-modal aria-label="关闭"><span data-icon="close"></span></button>
      </div>
      <h3>镜头</h3>
      <div class="shortcut"><span>旋转视角</span><span>在空白处按住左键拖动</span></div>
      <div class="shortcut"><span>平移视角</span><span>按住右键拖动 / 双指拖动</span></div>
      <div class="shortcut"><span>缩放</span><span>滚轮 / 双指捏合</span></div>
      <h3>摆姿势</h3>
      <div class="shortcut"><span>旋转关节</span><span>点选关节后拖动 X / Y / Z 彩色圆环（E）</span></div>
      <div class="shortcut"><span>IK 拖拽</span><span>人物：拖动手或脚，四肢自动弯曲。动物：使用 FK 旋转关节。</span></div>
      <div class="shortcut"><span>FK 旋转</span><span>拖动肩、肘、腰、头等关节；前臂 / 小腿可直接点选，或用侧栏「选择关节」</span></div>
      <div class="shortcut"><span>移动人物</span><span>拖动骨盆在地面移动；切到「平移」拖动 XYZ 箭头（W）</span></div>
      <div class="shortcut"><span>爬行动物</span><span>以蜥蜴为代表模型，可调整四肢、颈部和分段尾巴。</span></div>
      <div class="shortcut"><span>飞行动物</span><span>以鸟为代表模型，可调整翅根、翼尖、尾羽及腿脚。</span></div>
      <div class="shortcut"><span>保存姿势</span><span>侧栏或姿势库里的「保存当前姿势」，存在本机</span></div>
      <div class="shortcut"><span>精修角度</span><span>选中关节后用右侧 X / Y / Z 滑块</span></div>
      <div class="shortcut"><span>角色同框</span><span>左上角「添加角色」，可分别选中摆姿</span></div>
      <h3>快捷键</h3>
      <div class="shortcut"><span>撤销</span><span><kbd>Ctrl</kbd><kbd>Z</kbd></span></div>
      <div class="shortcut"><span>重做</span><span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd></span></div>
      <div class="shortcut"><span>取消选择</span><span><kbd>Esc</kbd></span></div>
      <div class="modal-foot">所有数据保存在本机浏览器里，不会上传。当前场景会自动保存。</div>
      <div class="modal-foot">基于 SSSpo 项目开发。</div>
    </div>
  </div>`;
  mountIcons(modalRoot);
  modalRoot.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  modalRoot.querySelector('[data-modal-backdrop]').addEventListener('pointerdown', (e) => {
    if (e.target.hasAttribute('data-modal-backdrop')) closeModal();
  });
}

function closeModal() {
  modalRoot.innerHTML = '';
}

function refreshPosesPopover(clearSearch = false) {
  if (activePopover?.tool !== 'poses') return;
  const el = activePopover.el;
  const list = el.querySelector('[data-custom-list]');
  if (!list) return;
  list.innerHTML = customPoseListHtml();
  const search = el.querySelector('[data-custom-search]');
  if (search && clearSearch) search.value = '';
  applyCustomSearch(search ? search.value : '');
}

function openSavePoseModal(options = {}) {
  const opts = typeof options === 'boolean' ? { reopen: options } : options;
  const reopen = !!opts.reopen;
  const fig = selectedFigure();
  if (!fig) {
    toast('请先添加角色');
    return;
  }
  let scope = opts.scope === 'group' ? 'group' : 'single';
  const seq = customPoses.length + 1;
  const fallbacks = {
    single: `${typeInfo(fig.type).label}姿势 ${seq}`,
    group: `组合动作 ${seq}`,
  };
  const figureCount = state.figures.length;
  const hints = {
    single: `只保存角色 ${state.figures.indexOf(fig) + 1}（${typeInfo(fig.type).label}）的关节角度和身体高度，可套用到同类角色。`,
    group: `保存当前 ${figureCount} 个角色的姿势、站位、朝向和大小；应用时还原整套场景，可撤销。`,
  };

  modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal modal-sm" role="dialog" aria-modal="true" aria-label="保存到动作库">
      <div class="modal-head">
        <div>
          <h2>保存到动作库</h2>
          <p class="modal-sub">动作会保存在本机浏览器，可随时套用。</p>
        </div>
      </div>
      <div class="scope-tabs" role="group" aria-label="保存范围">
        <button class="scope-tab${scope === 'single' ? ' active' : ''}" data-scope="single" aria-pressed="${scope === 'single'}">
          <span class="scope-title">当前角色</span>
          <span class="scope-sub">${typeInfo(fig.type).label} · 单角色动作</span>
        </button>
        <button class="scope-tab${scope === 'group' ? ' active' : ''}" data-scope="group" aria-pressed="${scope === 'group'}">
          <span class="scope-title">场景组合</span>
          <span class="scope-sub">${figureCount} 个角色 · 含站位</span>
        </button>
      </div>
      <p class="save-hint" data-save-hint>${hints[scope]}</p>
      <label class="field-label" for="pose-name">动作名称</label>
      <input class="text-input" id="pose-name" maxlength="20" placeholder="例如：倚墙站姿 / 三人合影" autocomplete="off">
      <div class="btn-row" style="justify-content:flex-end; margin-top:16px">
        <button class="btn" data-cancel>取消</button>
        <button class="btn primary" data-confirm><span data-icon="bookmark"></span>保存</button>
      </div>
    </div>
  </div>`;
  mountIcons(modalRoot);
  const input = modalRoot.querySelector('#pose-name');
  const hint = modalRoot.querySelector('[data-save-hint]');
  const tabs = Array.from(modalRoot.querySelectorAll('.scope-tab'));
  const setScope = (next) => {
    scope = next;
    tabs.forEach((tab) => {
      const active = tab.dataset.scope === scope;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', active);
    });
    hint.textContent = hints[scope];
    const current = input.value.trim();
    if (!current || current === fallbacks.single || current === fallbacks.group) {
      input.value = fallbacks[scope];
      input.select();
    }
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => setScope(tab.dataset.scope)));
  input.value = fallbacks[scope];
  setTimeout(() => {
    input.focus();
    input.select();
  }, 30);

  const submit = () => {
    const name = (input.value || '').trim().slice(0, 20) || fallbacks[scope];
    const entry =
      scope === 'group'
        ? {
            id: makeId(),
            name,
            kind: 'group',
            figures: state.figures.map(figureToData),
            selectedIndex: Math.max(0, state.figures.findIndex((f) => f.id === state.selectedId)),
            createdAt: Date.now(),
          }
        : { id: makeId(), name, kind: 'single', ...currentPoseData(fig), createdAt: Date.now() };
    addCustomPose(entry);
    closeModal();
    toast(
      scope === 'group'
        ? `已保存组合「${name}」· ${state.figures.length} 人`
        : `已保存「${name}」`,
    );
    if (reopen) refreshPosesPopover(true);
  };

  modalRoot.querySelector('[data-confirm]').addEventListener('click', submit);
  modalRoot.querySelector('[data-cancel]').addEventListener('click', closeModal);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  });
  modalRoot.querySelector('[data-modal-backdrop]').addEventListener('pointerdown', (e) => {
    if (e.target.hasAttribute('data-modal-backdrop')) closeModal();
  });
}

function openDeletePoseConfirm(id) {
  const entry = customPoses.find((p) => p.id === id);
  if (!entry) return;
  const detail = entry.kind === 'group' ? `是 ${entry.figures.length} 个角色组合动作，` : '';
  modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-label="删除动作">
      <div class="modal-head">
        <div>
          <h2>删除这个动作？</h2>
          <p class="modal-sub">「${escapeHtml(entry.name)}」${detail}会从本机动作库移除，当前场景不受影响。</p>
        </div>
      </div>
      <div class="btn-row" style="justify-content:flex-end; margin-top:8px">
        <button class="btn" data-cancel>取消</button>
        <button class="btn danger" data-confirm>删除</button>
      </div>
    </div>
  </div>`;
  modalRoot.querySelector('[data-cancel]').addEventListener('click', closeModal);
  modalRoot.querySelector('[data-confirm]').addEventListener('click', () => {
    customPoses = customPoses.filter((p) => p.id !== id);
    persistCustomPoses();
    closeModal();
    toast('动作已删除');
    refreshPosesPopover();
  });
  modalRoot.querySelector('[data-modal-backdrop]').addEventListener('pointerdown', (e) => {
    if (e.target.hasAttribute('data-modal-backdrop')) closeModal();
  });
}

function openClearConfirm() {
  closePopover();
  modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-label="清空场景">
      <div class="modal-head">
        <div>
          <h2>清空场景</h2>
          <p class="modal-sub">所有角色和姿势都会被移除，此操作可以撤销。</p>
        </div>
      </div>
      <div class="btn-row" style="justify-content:flex-end; margin-top:8px">
        <button class="btn" data-cancel>取消</button>
        <button class="btn danger" data-confirm>清空</button>
      </div>
    </div>
  </div>`;
  modalRoot.querySelector('[data-cancel]').addEventListener('click', closeModal);
  modalRoot.querySelector('[data-confirm]').addEventListener('click', () => {
    closeModal();
    pushHistorySnapshot();
    clearPartSelection();
    for (const fig of state.figures.slice()) removeFigure(fig);
    state.figures = [];
    state.selectedId = null;
    rebuildPickables();
    renderPanel();
    scheduleAutosave();
    toast('场景已清空');
  });
  modalRoot.querySelector('[data-modal-backdrop]').addEventListener('pointerdown', (e) => {
    if (e.target.hasAttribute('data-modal-backdrop')) closeModal();
  });
}

function showOnboardingIfNeeded() {
  try {
    if (!localStorage.getItem(ONBOARD_KEY)) onboarding.classList.remove('hidden');
  } catch {
    onboarding.classList.remove('hidden');
  }
}

function dismissOnboarding() {
  onboarding.classList.add('hidden');
  try {
    localStorage.setItem(ONBOARD_KEY, '1');
  } catch {
    /* ignore */
  }
}

// ---------------- export ----------------
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function exportPNG() {
  closePopover();
  hideHover();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const markerVisible = selectionMarker.visible;
  const gizmoVisible = rotateGizmoHelper.visible;
  const moveVisible = moveGizmoHelper.visible;
  selectionMarker.visible = false;
  rotateGizmoHelper.visible = false;
  moveGizmoHelper.visible = false;
  camera.clearViewOffset();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const prevRatio = renderer.getPixelRatio();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(w * 2, h * 2, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `码上动-${timestamp()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('已导出 PNG（2×）');
  } finally {
    renderer.setPixelRatio(prevRatio);
    fitProjection();
    selectionMarker.visible = markerVisible;
    rotateGizmoHelper.visible = gizmoVisible;
    moveGizmoHelper.visible = moveVisible;
    renderer.render(scene, camera);
  }
}

function drawCleanFrame(target) {
  const visible = [selectionMarker.visible, rotateGizmoHelper.visible, moveGizmoHelper.visible];
  try {
    selectionMarker.visible = rotateGizmoHelper.visible = moveGizmoHelper.visible = false;
    withCaptureProjection(camera, target.width / target.height, () => {
      renderer.render(scene, camera);
      // The projection already uses the target aspect; mapping the complete
      // drawing buffer avoids baking window-shaped letterboxing into clips.
      target.getContext('2d').drawImage(canvas, 0, 0, target.width, target.height);
    });
  } finally {
    [selectionMarker.visible, rotateGizmoHelper.visible, moveGizmoHelper.visible] = visible;
    renderer.render(scene, camera);
  }
}

// ---------------- keyboard ----------------
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const editable = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
  if (motionStudio?.isPreviewing) {
    if (e.key === 'Escape') motionStudio.stop();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (editable) return;
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const key = e.key.toLowerCase();
    if (key === 'w') {
      setGizmoMode('move');
      return;
    }
    if (key === 'e') {
      setGizmoMode('rotate');
      return;
    }
  }
  if (e.key === 'Escape') {
    closePopover();
    closeModal();
    if (state.selectedPart) {
      clearPartSelection();
      renderPanel();
    }
  }
});

// ---------------- resize / loop ----------------
function fitProjection() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const panelW = panelOcclusion();
  const studioEl = document.getElementById('motion-studio');
  const motionH = studioEl && !studioEl.hidden ? studioEl.getBoundingClientRect().height + 14 : 0;
  const topHeight = document.querySelector('.topbar').getBoundingClientRect().bottom;
  document.documentElement.style.setProperty('--motion-height', `${motionH}px`);
  document.documentElement.style.setProperty('--topbar-height', `${topHeight}px`);
  document.documentElement.style.setProperty('--inspector-space', `${panelW}px`);
  const inspectorButton = document.getElementById('inspector-toggle');
  inspectorButton?.setAttribute('aria-expanded', String(panelEl.getBoundingClientRect().width > 0));
  camera.aspect = w / h;
  if (panelW || motionH || topHeight) camera.setViewOffset(w, h, panelW / 2, (motionH - topHeight) / 2, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

window.addEventListener('resize', fitProjection);

function animate(now) {
  requestAnimationFrame(animate);
  motionStudio?.update(now);
  if (camTween) {
    const k = clamp((now - camTween.start) / camTween.duration, 0, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(camTween.p0, camTween.p1, e);
    controls.target.lerpVectors(camTween.t0, camTween.t1, e);
    if (k >= 1) camTween = null;
  }
  if (!motionStudio?.isPreviewing) controls.update();
  updateSelectionMarker();
  renderer.render(scene, camera);
  motionStudio?.afterRender(now);
}

// ---------------- init ----------------
function setupUI() {
  mountIcons();

  document.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'help') {
        openHelp();
      } else if (tool === 'figures') {
        openFiguresPopover(btn);
      } else if (tool === 'props') {
        openFiguresPopover(btn, true);
      } else if (tool === 'poses') {
        openPosesPopover(btn);
      } else if (tool === 'view') {
        openViewPopover(btn);
      } else if (tool === 'settings') {
        openSettingsPopover(btn);
      }
    });
  });

  document.getElementById('export').addEventListener('click', exportPNG);
  document.getElementById('undo').addEventListener('click', undo);
  document.getElementById('redo').addEventListener('click', redo);
  document.getElementById('frame-scene').addEventListener('click', () => frameAll());
  document.getElementById('inspector-toggle').addEventListener('click', () => {
    document.body.classList.toggle(window.innerWidth <= 760 ? 'inspector-open' : 'inspector-collapsed');
    fitProjection();
  });
  new ResizeObserver(fitProjection).observe(document.querySelector('.topbar'));

  document.querySelectorAll('#mode-switch button').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  document.querySelectorAll('#gizmo-switch button').forEach((btn) => {
    btn.addEventListener('click', () => setGizmoMode(btn.dataset.gizmo));
  });

  document.getElementById('onboarding-close').addEventListener('click', dismissOnboarding);
  document.getElementById('onboarding-ok').addEventListener('click', dismissOnboarding);

  updateHistoryButtons();
  updateGizmoSwitchUI();
}

function loadSettings() {
  const s = readStore(SETTINGS_KEY);
  if (s) {
    if (['gray', 'warm', 'dark'].includes(s.theme)) settings.theme = s.theme;
    if (typeof s.grid === 'boolean') settings.grid = s.grid;
    if (typeof s.light === 'number') settings.light = clamp(s.light, 0.4, 3.2);
    if (s.mode === 'fk' || s.mode === 'ik') settings.mode = s.mode;
  }
  state.mode = settings.mode;
  keyLight.intensity = settings.light;
  updateModeUI();
  applyTheme();
}

async function init() {
  setupUI();
  loadSettings();
  fitProjection();
  requestAnimationFrame(animate);

  try {
    const [male, female, boy] = await Promise.all([
      loadHumanTemplate('models/guge-man.glb'),
      loadHumanTemplate('models/guge-girl.glb'),
      loadHumanTemplate('models/guge-boy.glb'),
    ]);
    humanTemplates = { male, female, boy };
  } catch (err) {
    console.error('human model failed to load', err);
    panelEl.innerHTML = `
      <div class="panel-head">
        <div>
          <div class="panel-title"><span class="dot"></span>模型加载失败</div>
          <div class="panel-sub">models/guge-man.glb · guge-girl.glb · guge-boy.glb</div>
        </div>
      </div>
      <div class="empty-hint">请确认 <b>public/models/</b> 里的三个模型存在，然后刷新页面。</div>`;
    toast('人体模型加载失败');
    return;
  }

  const saved = readStore(SCENE_KEY);
  if (saved && Array.isArray(saved.figures)) {
    rebuildScene(saved);
    frameAll(false);
  } else {
    const fig = addFigure('male');
    state.selectedId = fig.id;
    renderPanel();
    scheduleAutosave();
  }

  if (!state.selectedId && state.figures.length) state.selectedId = state.figures[0].id;
  updateModeUI();
  renderPanel();
  motionStudio = createMotionStudio({
    captureScene: serializeScene,
    captureView: () => ({ position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov }),
    applyView(raw) {
      const view = normalizeMotionView(raw);
      if (!view) return;
      camTween = null;
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = damping;
      camera.position.fromArray(view.position);
      camera.fov = view.fov;
      controls.target.fromArray(view.target);
      camera.lookAt(controls.target);
      camera.updateProjectionMatrix();
    },
    applyScene: applyMotionScene,
    loadFrame(data) {
      pushHistorySnapshot();
      rebuildScene(data);
    },
    beginPreview() {
      clearTimeout(saveTimer);
      writeStore(SCENE_KEY, serializeScene());
      clearPartSelection();
      closePopover();
      closeModal();
      camTween = null;
      controls.enabled = false;
      document.querySelectorAll('#panel, .topbar, .stage-tools, .bottom-left, .mode-wrap').forEach((element) => { element.inert = true; });
      document.body.classList.add('motion-preview');
    },
    endPreview() {
      controls.enabled = true;
      document.querySelectorAll('#panel, .topbar, .stage-tools, .bottom-left, .mode-wrap').forEach((element) => { element.inert = false; });
      document.body.classList.remove('motion-preview');
      renderPanel();
      updateHistoryButtons();
      scheduleAutosave();
    },
    drawClean: drawCleanFrame,
    toast,
    layout() { fitProjection(); },
    previewViewport() {
      const studio = document.getElementById('motion-studio');
      const bottom = studio.hidden ? window.innerHeight : studio.getBoundingClientRect().top;
      const top = document.querySelector('.topbar').getBoundingClientRect().bottom + 8;
      return { left: 0, top, width: Math.max(1, window.innerWidth - panelOcclusion()), height: Math.max(1, bottom - top) };
    },
  });
  showOnboardingIfNeeded();
}

// small debug handle for local verification
window.__poselab = {
  state,
  camera,
  controls,
  gizmo: rotateGizmo,
  gizmoHelper: rotateGizmoHelper,
  moveGizmo,
  moveGizmoHelper,
  frameAll,
  setView,
  setGizmoMode,
  get selectedFigure() {
    return selectedFigure();
  },
  get customPoses() {
    return customPoses;
  },
  savePose(name) {
    const fig = selectedFigure();
    if (!fig) return null;
    const entry = {
      id: makeId(),
      name: name || `测试姿势 ${customPoses.length + 1}`,
      kind: 'single',
      ...currentPoseData(fig),
      createdAt: Date.now(),
    };
    addCustomPose(entry);
    return entry;
  },
  saveGroupPose(name) {
    if (!state.figures.length) return null;
    const entry = {
      id: makeId(),
      name: name || `测试组合 ${customPoses.length + 1}`,
      kind: 'group',
      figures: state.figures.map(figureToData),
      selectedIndex: Math.max(0, state.figures.findIndex((f) => f.id === state.selectedId)),
      createdAt: Date.now(),
    };
    addCustomPose(entry);
    return entry;
  },
  applySavedPose(id) {
    const entry = customPoses.find((p) => p.id === id);
    if (!entry) return false;
    if (entry.kind === 'group') {
      applyGroupPose(entry);
      return true;
    }
    const fig = selectedFigure();
    if (fig) {
      return applyCustomPose(fig, entry);
    }
    return false;
  },
  deleteSavedPose(id) {
    customPoses = customPoses.filter((p) => p.id !== id);
    persistCustomPoses();
  },
  applyPose(id) {
    const fig = selectedFigure();
    const pose = fig && posesForType(fig.type).find((entry) => entry.id === id);
    if (pose) applyPoseToFigure(fig, pose);
  },
  resetPose() {
    const fig = selectedFigure();
    if (!fig) return;
    resetPose(fig);
    renderPanel();
    scheduleAutosave();
  },
  selectBone(name) {
    const fig = selectedFigure();
    if (fig && fig.joints[name]) selectPart(fig, name);
  },
  pick(x, y) {
    const hit = pickAt(x, y);
    return hit ? { boneName: hit.boneName, label: hit.label, figureId: hit.fig.id } : null;
  },
  screenOf(boneName) {
    const fig = selectedFigure();
    const bone = fig?.joints[boneName];
    if (!bone) return null;
    const p = bone.getWorldPosition(new THREE.Vector3()).project(camera);
    return {
      x: (p.x * 0.5 + 0.5) * window.innerWidth,
      y: (-p.y * 0.5 + 0.5) * window.innerHeight,
    };
  },
};

init();
