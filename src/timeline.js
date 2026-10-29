/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
import { Quaternion } from 'three';
import { PROP_TYPES, normalizeProp } from './propModel.js';
import { addTravelToSample, normalizeTravel } from './locomotion.js';
import { normalizeMotionView, interpolateMotionView } from './motionMedia.js';

export const MAX_KEYFRAMES = 48;
export const MAX_FRAME_FIGURES = 40;
export const DEFAULT_TIMING = { hold: 0.4, transition: 0.8, mode: 'smooth' };
const copy = (value) => structuredClone(value);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const types = new Set(['male', 'female', 'boy', 'lizard', 'bird', ...Object.keys(PROP_TYPES)]);
const vector = (v, length) => Array.isArray(v) && v.length === length && v.every(Number.isFinite);

export function normalizeTiming(raw = {}) {
  raw ||= {};
  const bounded = (key, min, max) => Number.isFinite(Number(raw[key])) ? clamp(Number(raw[key]), min, max) : DEFAULT_TIMING[key];
  return { hold: bounded('hold', 0.1, 5), transition: bounded('transition', 0.1, 5), mode: raw.mode === 'step' ? 'step' : 'smooth' };
}

export function frameTiming(frame, defaults = DEFAULT_TIMING) {
  return normalizeTiming({ ...normalizeTiming(defaults), ...frame?.timing });
}

export function timelineDuration(frames, raw = DEFAULT_TIMING) {
  const timing = normalizeTiming(raw);
  return frames.reduce((sum, frame, index) => sum + segmentDuration(frames, index, timing), 0);
}

function hasTransition(frames, index, timing) {
  return timing.mode === 'smooth' && index < frames.length - 1 && frames[index].kind !== 'video' && frames[index + 1].kind !== 'video';
}

function segmentDuration(frames, index, timing) {
  const own = frameTiming(frames[index], timing);
  return frames[index].kind === 'video' ? frames[index].duration : own.hold + (hasTransition(frames, index, own) ? own.transition : 0);
}

export function frameStartTime(frames, index, raw = DEFAULT_TIMING) {
  const timing = normalizeTiming(raw);
  return frames.slice(0, index).reduce((sum, frame, i) => sum + segmentDuration(frames, i, timing), 0);
}

export function interpolateScenes(a, b, t) {
  if (t >= 1) return copy(b);
  if (t <= 0) return copy(a);
  const out = copy(a);
  const targets = new Map(b.figures.map((figure) => [figure.trackId, figure]));
  for (const figure of out.figures) {
    const target = targets.get(figure.trackId);
    if (!target || target.type !== figure.type) continue;
    figure.pos = figure.pos.map((v, i) => lerp(v, target.pos[i], t));
    const delta = Math.atan2(Math.sin(target.rotY - figure.rotY), Math.cos(target.rotY - figure.rotY));
    figure.rotY += delta * t;
    figure.size = lerp(figure.size, target.size, t);
    figure.hipsOffset = lerp(figure.hipsOffset, target.hipsOffset, t);
    if (PROP_TYPES[figure.type]) {
      const from = normalizeProp(figure.type, figure.prop);
      const to = normalizeProp(target.type, target.prop);
      figure.prop = { ...from, dimensions: from.dimensions.map((value, i) => lerp(value, to.dimensions[i], t)) };
    }
    for (const [name, q] of Object.entries(figure.joints)) {
      if (target.joints[name]) figure.joints[name] = new Quaternion().fromArray(q).normalize().slerp(new Quaternion().fromArray(target.joints[name]).normalize(), t).toArray();
    }
  }
  return out;
}

export function sampleTimeline(frames, seconds, raw = DEFAULT_TIMING) {
  if (!frames.length) return null;
  const timing = normalizeTiming(raw);
  const total = timelineDuration(frames, timing);
  let remaining = clamp(Number(seconds) || 0, 0, total);
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (frame.kind === 'video') {
      if (remaining < frame.duration || index === frames.length - 1) return { kind: 'video', clipId: frame.clipId, time: Math.min(remaining, frame.duration), index };
      remaining -= frame.duration;
      continue;
    }
    const own = frameTiming(frame, timing);
    if (remaining < own.hold || index === frames.length - 1) return { kind: 'pose', scene: copy(frame.scene), view: normalizeMotionView(frame.view), index };
    remaining -= own.hold;
    if (hasTransition(frames, index, own)) {
      if (remaining < own.transition) {
        const t = remaining / own.transition;
        const eased = t * t * (3 - 2 * t);
        const interpolated = interpolateScenes(frame.scene, frames[index + 1].scene, eased);
        return { kind: 'pose', scene: addTravelToSample(interpolated, frame.scene, frames[index + 1].scene, frame.travel, t, own.transition), view: interpolateMotionView(frame.view, frames[index + 1].view, eased), index };
      }
      remaining -= own.transition;
    }
  }
  return null;
}

export function isRecordableScene(scene) {
  if (!Array.isArray(scene?.figures) || !scene.figures.length || scene.figures.length > MAX_FRAME_FIGURES) return false;
  const seenTracks = new Set();
  for (const figure of scene.figures) {
    if (!figure || !types.has(figure.type) || typeof figure.trackId !== 'string' || figure.trackId.length > 100 || seenTracks.has(figure.trackId)) return false;
    seenTracks.add(figure.trackId);
    if (!vector(figure.pos, 3) || !Number.isFinite(figure.rotY) || !Number.isFinite(figure.hipsOffset) || !Number.isFinite(figure.size) || figure.size < 0.25 || figure.size > 2) return false;
    if (!figure.joints || typeof figure.joints !== 'object' || Array.isArray(figure.joints) || Object.keys(figure.joints).length > 100) return false;
    if (!Object.values(figure.joints).every((q) => vector(q, 4) && Math.hypot(...q) > 0.1)) return false;
    if (PROP_TYPES[figure.type] && figure.prop !== undefined) {
      const prop = figure.prop;
      if (!prop || typeof prop !== 'object' || typeof prop.label !== 'string' || Array.from(prop.label).length > 24) return false;
      if (!/^#[0-9a-f]{6}$/i.test(prop.color) || typeof prop.showLabel !== 'boolean') return false;
      if (!vector(prop.dimensions, 3) || prop.dimensions.some((value) => value < 0.05 || value > 6)) return false;
    }
  }
  return true;
}

export function restoreTimeline(raw) {
  const settings = normalizeTiming(raw?.settings || {});
  const seenFrames = new Set();
  const frames = (Array.isArray(raw?.frames) ? raw.frames : []).filter((frame) => {
    if (!frame || typeof frame.id !== 'string' || frame.id.length > 100 || seenFrames.has(frame.id)) return false;
    if (frame.kind === 'video') {
      if (typeof frame.clipId !== 'string' || frame.clipId.length > 100 || !Number.isFinite(frame.duration) || frame.duration < 0.1 || frame.duration > 180) return false;
    } else if (!isRecordableScene(frame.scene)) return false;
    seenFrames.add(frame.id);
    return true;
  }).slice(0, MAX_KEYFRAMES).map((frame) => ({
    id: frame.id,
    ...(frame.kind === 'video' ? { kind: 'video', clipId: frame.clipId, duration: frame.duration } : { kind: 'pose', scene: copy(frame.scene), view: normalizeMotionView(frame.view), travel: normalizeTravel(frame.travel), timing: frameTiming(frame, settings) }),
    thumbnail: typeof frame.thumbnail === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(frame.thumbnail) && frame.thumbnail.length < 60000 ? frame.thumbnail : '',
  }));
  return { version: 3, frames, settings };
}
