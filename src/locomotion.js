/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
import { Quaternion, Vector3, MathUtils } from 'three';

const MOVERS = new Set(['male', 'female', 'boy', 'lizard', 'bird']);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => { const t = clamp01(value); return t * t * (3 - 2 * t); };

export function normalizeTravel(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([id, mode]) => id.length <= 100 && (mode === 'walk' || mode === 'run')).slice(0, 40));
}

export function travelCandidates(from, to) {
  if (!from?.figures || !to?.figures) return [];
  const targets = new Map(to.figures.map((figure) => [figure.trackId, figure]));
  return from.figures.flatMap((figure, index) => {
    const target = targets.get(figure.trackId);
    if (!MOVERS.has(figure.type) || !target || target.type !== figure.type) return [];
    const dx = target.pos[0] - figure.pos[0];
    const dz = target.pos[2] - figure.pos[2];
    const distance = Math.hypot(dx, dz);
    return distance > 0.02 ? [{ trackId: figure.trackId, type: figure.type, index, distance, direction: Math.atan2(dx, dz) }] : [];
  });
}

export function addTravelToSample(sample, from, to, raw, progress, duration) {
  const choices = normalizeTravel(raw);
  if (!Object.keys(choices).length || progress <= 0 || progress >= 1) return sample;
  const candidates = new Map(travelCandidates(from, to).map((item) => [item.trackId, item]));
  for (const figure of sample.figures) {
    const candidate = candidates.get(figure.trackId);
    if (candidate && choices[figure.trackId]) figure.travel = { mode: choices[figure.trackId], progress, duration, distance: candidate.distance, direction: candidate.direction };
  }
  return sample;
}

// Capture a neutral, standing rig once. Axes are expressed in each joint's
// parent space so imported human bones and procedural animal pivots share
// the same forward/backward motion despite different rest orientations.
export function captureLocomotionRig(fig) {
  fig.root.updateMatrixWorld(true);
  const rootRotation = fig.root.getWorldQuaternion(new Quaternion());
  const joints = {};
  for (const [name, bone] of Object.entries(fig.joints)) {
    const inverseParent = bone.parent.getWorldQuaternion(new Quaternion()).invert();
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((axis) => new Vector3(...axis).applyQuaternion(rootRotation).applyQuaternion(inverseParent).normalize().toArray());
    joints[name] = { quaternion: bone.quaternion.toArray(), axes };
  }
  return { joints, hipsOffset: (fig.joints.hips.position.y - fig.joints.hips.userData.baseY) * fig.modelScale };
}

// Sparse older poses are valid too. Always restore a complete baseline so
// seeking after a generated gait cannot leave unrecorded joints behind.
export function restoreSampleJoints(fig, saved = {}) {
  for (const [name, bone] of Object.entries(fig.joints)) {
    const quaternion = saved[name] || fig.locomotionRig?.joints[name]?.quaternion;
    if (quaternion) bone.quaternion.fromArray(quaternion).normalize();
  }
}

export function applyTravelPose(fig, travel) {
  if (!travel || !MOVERS.has(fig.type) || !fig.locomotionRig || !['walk', 'run'].includes(travel.mode) || travel.distance <= 0.02) return;
  const p = clamp01(travel.progress);
  const weight = smooth(p / 0.18) * smooth((1 - p) / 0.18);
  if (weight < 1e-8) return;
  const running = travel.mode === 'run';
  const duration = Number.isFinite(travel.duration) ? Math.max(0.1, travel.duration) : 1;
  const stride = (fig.type === 'lizard' ? 0.42 : fig.type === 'bird' ? 0.3 : 0.72) * (fig.size || 1);
  const cycles = Math.max(travel.distance / stride, duration * (running ? 2.7 : 1.5));
  const phase = 2 * Math.PI * p * cycles;
  const swing = Math.sin(phase);
  const liftL = Math.max(0, swing);
  const liftR = Math.max(0, -swing);
  const rig = fig.locomotionRig;
  const desired = Object.fromEntries(Object.entries(rig.joints).map(([name, entry]) => [name, new Quaternion().fromArray(entry.quaternion)]));
  const rotate = (name, axis, degrees) => {
    if (!desired[name]) return;
    const delta = new Quaternion().setFromAxisAngle(new Vector3().fromArray(rig.joints[name].axes[axis]), MathUtils.degToRad(degrees));
    desired[name].premultiply(delta).normalize();
  };
  let bob;
  if (fig.type === 'lizard') {
    const amplitude = running ? 42 : 24;
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      rotate(`frontUpper${side}`, 1, swing * amplitude);
      rotate(`hindUpper${side}`, 1, -swing * amplitude);
      rotate(`frontLower${side}`, 0, -Math.max(0, swing * sign) * (running ? 24 : 13));
      rotate(`hindLower${side}`, 0, -Math.max(0, -swing * sign) * (running ? 24 : 13));
    }
    rotate('spine', 1, swing * (running ? 9 : 5));
    rotate('tailBase', 1, -swing * 12);
    rotate('tailMid', 1, -Math.sin(phase - 0.6) * 10);
    rotate('head', 1, -swing * 4);
    bob = (running ? 0.028 : 0.012) * Math.abs(Math.sin(phase));
  } else if (fig.type === 'bird') {
    const amplitude = running ? 42 : 23;
    rotate('birdLegL', 0, -swing * amplitude);
    rotate('birdLegR', 0, swing * amplitude);
    rotate('birdAnkleL', 0, liftL * (running ? 48 : 26));
    rotate('birdAnkleR', 0, liftR * (running ? 48 : 26));
    rotate('birdPawL', 0, swing * amplitude * 0.5 - liftL * 18);
    rotate('birdPawR', 0, -swing * amplitude * 0.5 - liftR * 18);
    rotate('head', 0, Math.sin(2 * phase) * 5);
    rotate('tail', 0, running ? -12 : -4);
    if (running) { rotate('wingL', 2, 12); rotate('wingR', 2, -12); }
    bob = (running ? 0.065 : 0.025) * Math.abs(Math.sin(phase));
  } else {
    const amplitude = running ? 44 : 24;
    rotate('thighL', 0, -swing * amplitude);
    rotate('thighR', 0, swing * amplitude);
    rotate('shinL', 0, liftL * (running ? 80 : 38));
    rotate('shinR', 0, liftR * (running ? 80 : 38));
    rotate('footL', 0, swing * 12 - liftL * (running ? 30 : 15));
    rotate('footR', 0, -swing * 12 - liftR * (running ? 30 : 15));
    rotate('upperArmL', 0, swing * (running ? 38 : 18));
    rotate('upperArmR', 0, -swing * (running ? 38 : 18));
    rotate('foreArmL', 0, running ? -65 : -10);
    rotate('foreArmR', 0, running ? -65 : -10);
    rotate('spine', 0, running ? 10 : 2);
    rotate('chest', 1, -swing * (running ? 7 : 3));
    bob = (running ? 0.09 : 0.025) * Math.abs(Math.sin(phase));
  }
  for (const [name, target] of Object.entries(desired)) fig.joints[name].quaternion.slerp(target, weight).normalize();
  const hips = fig.joints.hips;
  const currentOffset = (hips.position.y - hips.userData.baseY) * fig.modelScale;
  hips.position.y = hips.userData.baseY + (currentOffset + (rig.hipsOffset + bob - currentOffset) * weight) / fig.modelScale;
  const delta = Math.atan2(Math.sin(travel.direction - fig.root.rotation.y), Math.cos(travel.direction - fig.root.rotation.y));
  fig.root.rotation.y += delta * weight;
  fig.root.updateMatrixWorld(true);
}
