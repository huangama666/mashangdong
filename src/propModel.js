import * as THREE from 'three';

export const PROP_TYPES = {
  cube: { label: '正方体', short: '方', body: '基础物品 · 正方体', icon: 'cube', sub: '边长相同，可作方块或台座', size: 1, dimensions: [0.65, 0.65, 0.65], color: '#91a9ba' },
  cuboid: { label: '长方体', short: '长', body: '基础物品 · 长方体', icon: 'cuboid', sub: '长宽高分别调整', size: 1, dimensions: [1.2, 0.6, 0.6], color: '#c4a580' },
  cylinder: { label: '圆柱体', short: '柱', body: '基础物品 · 圆柱体', icon: 'cylinder', sub: '直径和高度可调整', size: 1, dimensions: [0.65, 1, 0.65], color: '#91ab95' },
  sphere: { label: '圆球', short: '球', body: '基础物品 · 圆球', icon: 'sphere', sub: '直径可调整', size: 1, dimensions: [0.7, 0.7, 0.7], color: '#bd949d' },
};

export function normalizeProp(type, raw = {}) {
  const defaults = PROP_TYPES[type];
  if (!defaults) throw new Error(`Unsupported prop: ${type}`);
  const source = raw && typeof raw === 'object' ? raw : {};
  const dimensions = defaults.dimensions.map((fallback, i) => {
    const value = source.dimensions?.[i];
    return Number.isFinite(value) ? Math.max(0.05, Math.min(6, value)) : fallback;
  });
  if (type === 'cube' || type === 'sphere') dimensions.fill(dimensions[0]);
  if (type === 'cylinder') dimensions[2] = dimensions[0];
  return {
    label: Array.from(String(source.label ?? '').replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 24).join(''),
    color: /^#[0-9a-f]{6}$/i.test(source.color || '') ? source.color.toLowerCase() : defaults.color,
    showLabel: source.showLabel !== false,
    dimensions,
  };
}

export function resizeProp(type, raw, factors) {
  const value = normalizeProp(type, raw);
  const scales = [0, 1, 2].map((axis) => Number.isFinite(factors[axis]) ? Math.max(0, factors[axis]) : 1);
  const changed = (axes) => axes.reduce((best, axis) => Math.abs(scales[axis] - 1) > Math.abs(scales[best] - 1) ? axis : best, axes[0]);
  if (type === 'cube' || type === 'sphere') scales.fill(scales[changed([0, 1, 2])]);
  if (type === 'cylinder') scales[0] = scales[2] = scales[changed([0, 2])];
  return normalizeProp(type, { ...value, dimensions: value.dimensions.map((length, axis) => Math.round(length * scales[axis] * 1000) / 1000) });
}

function textTexture(text, color, badge = false, wrap = false) {
  const canvas = document.createElement('canvas');
  canvas.width = badge ? 768 : 1024;
  canvas.height = badge ? 192 : 512;
  const ctx = canvas.getContext('2d');
  if (badge) {
    ctx.fillStyle = '#f4f3ed';
    ctx.beginPath();
    ctx.roundRect(8, 8, 752, 176, 36);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const luminance = new THREE.Color(color).getHSL({}).l;
  ctx.fillStyle = badge || luminance > 0.32 ? '#20282d' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxWidth = badge ? 680 : wrap ? 430 : 870;
  let fontSize = badge ? 106 : 174;
  ctx.font = `650 ${fontSize}px -apple-system, "PingFang SC", sans-serif`;
  while (ctx.measureText(text).width > maxWidth && fontSize > 16) {
    fontSize -= 2;
    ctx.font = `650 ${fontSize}px -apple-system, "PingFang SC", sans-serif`;
  }
  for (const x of wrap ? [256, 768] : [canvas.width / 2]) ctx.fillText(text, x, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createPropFigure(type, raw = {}) {
  const body = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.name = 'hips';
  pivot.userData.rest = pivot.quaternion.clone();
  pivot.userData.baseY = 0;
  pivot.userData.isRoot = true;
  body.add(pivot);
  const geometry = type === 'sphere' ? new THREE.SphereGeometry(0.5, 40, 28)
    : type === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 40)
      : new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.64, metalness: 0.03 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.jointName = 'hips';
  pivot.add(mesh);
  const badgeMaterial = new THREE.SpriteMaterial({ transparent: true, depthTest: true, toneMapped: false });
  const badge = new THREE.Sprite(badgeMaterial);
  pivot.add(badge);
  let current = null;
  let textureKey = null;
  const config = { rig: 'prop', height: 1, jointGroups: [{ label: '物品', joints: ['hips'] }] };

  function updateProp(value) {
    const next = normalizeProp(type, value);
    const offset = pivot.position.y - pivot.userData.baseY;
    pivot.userData.baseY = next.dimensions[1] / 2;
    pivot.position.y = pivot.userData.baseY + offset;
    mesh.scale.fromArray(next.dimensions);
    config.height = next.dimensions[1];
    badge.position.set(0, next.dimensions[1] / 2 + 0.12, 0);
    const labelWidth = Math.max(0.35, Math.min(1.2, Array.from(next.label).length * 0.07 + 0.22));
    badge.scale.set(labelWidth, labelWidth / 4, 1);
    badge.visible = next.showLabel && Boolean(next.label.trim());
    const key = JSON.stringify([next.label, next.color, next.showLabel]);
    if (key !== textureKey) {
      material.map?.dispose();
      badgeMaterial.map?.dispose();
      const visible = next.showLabel && Boolean(next.label.trim());
      material.map = visible ? textTexture(next.label, next.color, false, type === 'sphere' || type === 'cylinder') : null;
      material.color.set(visible ? '#ffffff' : next.color);
      badgeMaterial.map = visible ? textTexture(next.label, next.color, true) : null;
      material.needsUpdate = badgeMaterial.needsUpdate = true;
      textureKey = key;
    }
    current = next;
    body.updateMatrixWorld(true);
    return next;
  }

  updateProp(raw);
  return {
    type, body, parts: [mesh], joints: { hips: pivot }, labels: { hips: '物品中心' }, material, modelScale: 1, config,
    propState: current,
    updateProp,
    dispose() {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
      badgeMaterial.map?.dispose();
      badgeMaterial.dispose();
    },
  };
}
