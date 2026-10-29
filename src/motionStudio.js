/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
import { MAX_KEYFRAMES, MAX_FRAME_FIGURES, isRecordableScene, restoreTimeline, normalizeTiming, frameTiming, sampleTimeline, timelineDuration, frameStartTime } from './timeline.js';
import { createClipStore } from './clipStore.js';
import { normalizeTravel, travelCandidates } from './locomotion.js';
import { ANIMAL_TYPES } from './animalModel.js';
import { fitMediaRect, commitRecordedClip } from './motionMedia.js';

const STORAGE_KEY = 'poselab.motion.v1';
const LIMIT_SECONDS = 180;
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function createMotionStudio(api) {
  const host = document.getElementById('motion-studio');
  let project;
  try { project = restoreTimeline(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { project = restoreTimeline(null); }
  let selected = project.frames[0]?.id || null;
  let editingSnapshot = null;
  let editingView = null;
  let playing = false;
  let playStart = 0;
  let time = 0;
  let recorder = null;
  let stream = null;
  let recordingKind = null;
  let recordingStart = 0;
  let finishing = false;
  let endRecording = false;
  let resultUrl = null;
  let lastCapture = 0;
  let lastStatus = 0;
  let storageFailed = false;
  let mediaReady = !project.frames.some((frame) => frame.kind === 'video');
  let mediaError = '';
  let mediaGeneration = 0;
  let activeMedia = null;
  const clips = createClipStore();
  const videoLayer = document.createElement('canvas');
  videoLayer.className = 'motion-video-layer';
  videoLayer.hidden = true;
  document.getElementById('app').appendChild(videoLayer);
  const frameHistory = [];
  const capture = document.createElement('canvas');
  capture.width = 1280;
  capture.height = 720;
  const thumb = document.createElement('canvas');
  thumb.width = 160;
  thumb.height = 90;

  host.innerHTML = `
    <div class="motion-heading">
      <div><h2>动画轨道 <span data-frame-count>0 段</span></h2></div>
      <p>定格与录制共用一条轨道，从左到右播放。</p>
      <button class="icon-plain" data-motion="close" aria-label="收起定格动画">×</button>
    </div>
    <div class="motion-actions">
      <button class="btn primary" data-motion="add">＋ 定格当前画面</button>
      <button class="btn record-action" data-motion="live">● 录制拖动并入轨</button>
      <span class="action-divider" aria-hidden="true"></span>
      <button class="btn" data-motion="replace">替换选中定格</button>
      <button class="btn" data-motion="back">前移</button>
      <button class="btn" data-motion="forward">后移</button>
      <button class="btn" data-motion="delete">删除片段</button>
      <button class="btn" data-motion="undo">撤销轨道操作</button>
      <span class="motion-spacer"></span>
      <button class="btn export-action" data-motion="export">导出整条轨道</button>
    </div>
    <div class="motion-workspace">
      <div class="motion-track-area">
        <div class="motion-track-label"><span>片段轨道</span><span class="track-legend"><i class="pose-dot"></i>定格 <i class="video-dot"></i>录制</span></div>
        <div class="motion-strip" data-motion-strip role="group" aria-label="定格与录制共用轨道"></div>
      </div>
      <div class="motion-frame-inspector" aria-label="选中片段设置">
      <div class="motion-selection-title" data-motion-setting-scope>选中定格设置</div>
      <div class="motion-frame-settings">
      <label>本帧衔接 <select data-motion-setting="mode" aria-label="选中帧的衔接方式"><option value="smooth">平滑过渡</option><option value="step">逐帧定格</option></select></label>
      <label>本帧停留 <input type="number" data-motion-setting="hold" aria-label="选中帧停留秒数" min="0.1" max="5" step="0.1"> 秒</label>
      <label data-transition-label>到下一帧 <input type="number" data-motion-setting="transition" aria-label="选中帧到下一帧的过渡秒数" min="0.1" max="5" step="0.1"> 秒</label>
      </div>
      <div class="travel-editor" data-travel-editor></div>
      </div>
    </div>
    <div class="motion-controls">
      <button class="btn" data-motion="play">▶ 预览</button>
      <button class="btn" data-motion="stop">结束预览</button>
      <input type="range" data-motion-seek aria-label="动画进度" min="0" max="1" step="0.01" value="0">
      <output data-motion-clock>00:00.0 / 00:00.0</output>
    </div>
    <div class="motion-footer"><span data-motion-status role="status">轨道会自动保存到本机。</span><span>1280 × 720 · 30 fps · 仅画面</span></div>
    <details class="motion-result" data-motion-result hidden></details>`;
  const strip = host.querySelector('[data-motion-strip]');
  const status = host.querySelector('[data-motion-status]');
  const seek = host.querySelector('[data-motion-seek]');
  const buttons = (action) => host.querySelector(`[data-motion="${action}"]`);
  const total = () => timelineDuration(project.frames, project.settings);
  const isRecording = () => Boolean(recordingKind || finishing);
  const layoutObserver = new ResizeObserver(() => api.layout());
  layoutObserver.observe(host);

  async function prepareMedia() {
    const generation = ++mediaGeneration;
    mediaReady = false;
    mediaError = '';
    render();
    try {
      await Promise.all([...new Set(project.frames.filter((f) => f.kind === 'video').map((f) => f.clipId))].map((id) => clips.load(id)));
      if (generation === mediaGeneration) { mediaReady = true; render(); }
    } catch (error) {
      if (generation === mediaGeneration) { mediaError = error.message; render(); }
    }
  }

  function drawMedia(target, source) {
    const context = target.getContext('2d');
    context.fillStyle = '#dfe2e4';
    context.fillRect(0, 0, target.width, target.height);
    if ('readyState' in source && source.readyState < 2) return;
    const rect = fitMediaRect(source.videoWidth || source.width, source.videoHeight || source.height, target.width, target.height);
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      storageFailed = false;
    } catch {
      storageFailed = true;
      api.toast('本机存储空间不足，定格暂时只在本次页面中保留');
    }
  }

  function rememberFrames() {
    frameHistory.push({ frames: structuredClone(project.frames), selected });
    if (frameHistory.length > 12) frameHistory.shift();
  }

  function setOpen(open) {
    if (!open && (editingSnapshot || isRecording())) { api.toast('请先结束预览或停止录制'); return; }
    host.hidden = !open;
    document.body.classList.toggle('motion-open', open);
    document.getElementById('motion-toggle').classList.toggle('on', open);
    document.getElementById('motion-toggle').setAttribute('aria-expanded', String(open));
    api.layout();
  }

  function render() {
    const busy = Boolean(editingSnapshot || isRecording());
    const index = project.frames.findIndex((f) => f.id === selected);
    host.querySelector('[data-frame-count]').textContent = `${project.frames.length} / ${MAX_KEYFRAMES} 段 · ${project.frames.filter((f) => f.kind === 'video').length} 视频`;
    strip.innerHTML = project.frames.length ? project.frames.map((frame, i) => `<button class="motion-frame ${frame.kind === 'video' ? 'video-segment' : 'pose-segment'}${frame.id === selected ? ' selected' : ''}" data-frame="${escape(frame.id)}" aria-label="选中第 ${i + 1} 段${frame.kind === 'video' ? '视频' : '定格'}" aria-pressed="${frame.id === selected}"${isRecording() ? ' disabled' : ''}>
      ${frame.thumbnail ? `<img alt="第 ${i + 1} 段${frame.kind === 'video' ? '视频' : '定格'}" src="${frame.thumbnail}">` : '<span class="frame-placeholder">片段</span>'}<span><b>${String(i + 1).padStart(2, '0')}</b> ${frame.kind === 'video' ? `● 录制 ${clock(frame.duration)}` : `○ 定格 · ${frame.scene.figures.length} 个角色`}</span></button>`).join('') : '<div class="motion-empty"><b>定格 + 录制，一条轨道</b><span>点「定格」添加姿势；点「录制拖动」记录操作，结束后自动加入此处。</span></div>';
    for (const action of ['add', 'replace', 'back', 'forward', 'delete', 'undo']) buttons(action).disabled = busy || (action !== 'add' && (action === 'undo' ? !frameHistory.length : index < 0));
    buttons('add').disabled ||= project.frames.length >= MAX_KEYFRAMES;
    buttons('replace').disabled ||= project.frames[index]?.kind === 'video';
    buttons('back').disabled ||= index <= 0;
    buttons('forward').disabled ||= index >= project.frames.length - 1;
    buttons('play').disabled = !project.frames.length || isRecording() || !mediaReady;
    buttons('play').textContent = playing ? '❚❚ 暂停' : editingSnapshot ? '▶ 继续' : '▶ 预览';
    buttons('stop').disabled = !editingSnapshot || isRecording();
    buttons('live').disabled = finishing || Boolean(editingSnapshot) || (project.frames.length >= MAX_KEYFRAMES && recordingKind !== 'live');
    buttons('live').textContent = recordingKind === 'live' ? '■ 停止录制并入轨' : '● 录制拖动并入轨';
    buttons('live').classList.toggle('recording', recordingKind === 'live');
    buttons('export').disabled = finishing || !project.frames.length || recordingKind === 'live' || !mediaReady;
    buttons('export').textContent = recordingKind === 'timeline' ? '■ 停止导出' : '导出整条轨道';
    seek.disabled = !project.frames.length || isRecording() || !mediaReady;
    seek.max = String(total() || 1);
    const frame = project.frames[index];
    const timing = frameTiming(frame, project.settings);
    const poseSelected = Boolean(frame && frame.kind !== 'video');
    host.querySelector('[data-motion-setting-scope]').textContent = poseSelected ? `第 ${index + 1} 段定格 · 仅本帧` : frame ? '视频使用录制原时长' : '请先选择定格';
    for (const input of host.querySelectorAll('[data-motion-setting]')) {
      input.value = String(timing[input.dataset.motionSetting]);
      input.disabled = busy || !poseSelected || (input.dataset.motionSetting === 'transition' && (!project.frames[index + 1] || project.frames[index + 1].kind === 'video'));
    }
    host.querySelector('[data-transition-label]').hidden = timing.mode === 'step';
    renderTravelEditor(busy);
    updateProgress();
  }

  function renderTravelEditor(busy) {
    const editor = host.querySelector('[data-travel-editor]');
    const index = project.frames.findIndex((frame) => frame.id === selected);
    const frame = project.frames[index];
    const next = project.frames[index + 1];
    const heading = `<div class="travel-title">移动衔接 <span>选中定格 → 下一段</span></div>`;
    if (!frame || frame.kind === 'video' || !next || next.kind === 'video') {
      editor.innerHTML = `${heading}<div class="travel-hint">选中一张后面还有定格的画面，即可设置走动或跑动。录制视频保持原内容。</div>`;
      return;
    }
    const candidates = travelCandidates(frame.scene, next.scene);
    if (!candidates.length) {
      editor.innerHTML = `${heading}<div class="travel-hint">到下一帧没有人物或动物的平面位移，按定格姿势衔接。</div>`;
      return;
    }
    const names = { male: '男性', female: '女性', boy: '小孩', ...Object.fromEntries(Object.entries(ANIMAL_TYPES).map(([type, info]) => [type, info.label])) };
    const choices = normalizeTravel(frame.travel);
    const step = frameTiming(frame, project.settings).mode === 'step';
    const disabled = busy || step;
    editor.innerHTML = `${heading}<div class="travel-options">${candidates.map((candidate) => `<label><span>角色 ${candidate.index + 1} · ${names[candidate.type]} <small>${candidate.distance.toFixed(2)} 米</small></span><select data-travel-track="${escape(candidate.trackId)}" aria-label="角色 ${candidate.index + 1} ${names[candidate.type]}的移动衔接"${disabled ? ' disabled' : ''}>
      <option value="none"${!choices[candidate.trackId] ? ' selected' : ''}>按定格（不走跑）</option>
      <option value="walk"${choices[candidate.trackId] === 'walk' ? ' selected' : ''}>走过去</option>
      <option value="run"${choices[candidate.trackId] === 'run' ? ' selected' : ''}>跑过去</option>
      </select></label>`).join('')}</div><div class="travel-hint">${step ? '将本帧衔接切换为「平滑过渡」后，走跑衔接才会生效。' : '只影响当前定格到下一定格。到达后接回目标姿势；蜥蜴采用慢爬 / 快爬，鸟采用迈步。'}</div>`;
  }

  function updateProgress() {
    seek.value = String(time);
    host.querySelector('[data-motion-clock]').textContent = `${clock(time)} / ${clock(total())}`;
    if (finishing) status.textContent = '正在生成视频，请稍候…';
    else if (recordingKind) status.textContent = `● 正在${recordingKind === 'live' ? '录制拖动' : '录制动画'} ${clock((performance.now() - recordingStart) / 1000)} · 保持本页在前台`;
    else if (editingSnapshot) status.textContent = playing ? '正在预览 · 结束预览后可继续摆姿势' : '预览已暂停 · 点击结束预览可返回编辑';
    else if (mediaError) status.textContent = `无法读取视频：${mediaError}。删除失效片段后可继续。`;
    else if (!mediaReady) status.textContent = '正在读取本机视频片段…';
    else if (storageFailed) status.textContent = '存储空间不足：轨道尚未保存，刷新会丢失。';
    else status.textContent = `${project.frames.length ? '已自动保存同一轨道 · 蓝色为视频，金色为定格 · 选中后可前移、后移、删除' : '定格和录制会加入同一轨道，全部保存在本机。'}${total() > LIMIT_SECONDS ? ' · 超过 180 秒，请缩短轨道后导出' : ''}`;
  }

  function beginPreview() {
    if (editingSnapshot) return;
    editingSnapshot = api.captureScene();
    editingView = api.captureView();
    api.beginPreview();
  }

  function stopPreview() {
    playing = false;
    clips.pause();
    activeMedia = null;
    videoLayer.hidden = true;
    if (editingSnapshot) {
      const saved = editingSnapshot;
      api.applyScene(saved);
      api.applyView(editingView);
      editingView = null;
      editingSnapshot = null;
      api.endPreview();
    }
    time = 0;
    render();
  }

  function showSample() {
    const sample = sampleTimeline(project.frames, time, project.settings);
    if (!sample) return;
    if (sample.kind === 'video') {
      const video = clips.get(sample.clipId)?.video;
      if (!video) return;
      const changed = activeMedia !== video;
      if (changed) { activeMedia?.pause(); activeMedia = video; }
      if (changed || Math.abs(video.currentTime - sample.time) > (playing ? 0.25 : 0.015)) video.currentTime = Math.min(sample.time, Math.max(0, video.duration - 0.025) || sample.time);
      if (playing && video.paused) video.play().catch(() => { api.toast('视频播放中断，请重新预览'); });
      if (!playing) video.pause();
    } else {
      activeMedia?.pause();
      activeMedia = null;
      api.applyScene(sample.scene);
      api.applyView(sample.view || editingView);
    }
    videoLayer.hidden = false;
    strip.querySelectorAll('[data-frame]').forEach((node, i) => node.classList.toggle('playing', i === sample.index));
  }

  function addFrame(replace = false) {
    if (editingSnapshot || isRecording()) return;
    const snapshot = api.captureScene();
    if (!snapshot.figures.length) { api.toast('先添加一个角色，再定格'); return; }
    if (!isRecordableScene(snapshot)) { api.toast(`每个定格最多 ${MAX_FRAME_FIGURES} 个角色，请减少角色后重试`); return; }
    const index = project.frames.findIndex((f) => f.id === selected);
    if (!replace && project.frames.length >= MAX_KEYFRAMES) return;
    api.drawClean(thumb);
    rememberFrames();
    const frame = { kind: 'pose', id: replace && index >= 0 ? selected : crypto.randomUUID(), scene: snapshot, view: api.captureView(), travel: replace && index >= 0 ? normalizeTravel(project.frames[index].travel) : {}, timing: replace && index >= 0 ? frameTiming(project.frames[index], project.settings) : normalizeTiming(), thumbnail: thumb.toDataURL('image/jpeg', 0.7) };
    if (replace && index >= 0) project.frames[index] = frame;
    else project.frames.push(frame);
    selected = frame.id;
    persist();
    render();
    strip.querySelector(`[data-frame="${frame.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    api.toast(replace ? '已替换选中的定格' : `定格已加入轨道第 ${project.frames.length} 段`);
  }

  function releaseStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function showResult(blob, mime, title, note) {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    const result = host.querySelector('[data-motion-result]');
    resultUrl = URL.createObjectURL(blob);
    const extension = mime.includes('mp4') ? 'mp4' : 'webm';
    result.hidden = false;
    result.innerHTML = `<summary><b>${escape(title)}</b><span>${extension.toUpperCase()} · ${(blob.size / 1024 / 1024).toFixed(2)} MB</span><span class="result-disclosure">查看视频与下载</span></summary><div class="motion-result-content"><video controls playsinline src="${resultUrl}" aria-label="录制视频预览"></video><div><p>${escape(note)}</p><a class="btn primary" download="码上动-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}" href="${resultUrl}">下载视频</a></div></div>`;
    api.layout();
  }

  async function completeRecording(blob, mime, interrupted, kind, elapsed) {
    if (kind === 'live') {
      const id = crypto.randomUUID();
      try {
        drawMedia(thumb, capture);
        const result = await commitRecordedClip({ store: clips, id, blob, elapsed, thumbnail: thumb.toDataURL('image/jpeg', 0.7), commit(frame) {
          rememberFrames();
          project.frames.push(frame);
          selected = id;
          mediaReady = false;
          persist();
          showResult(blob, mime, '录制已加入同一轨道', interrupted ? '录制提前结束；已保存的部分仍可预览和合成。' : '此视频段已保存在本机，可在轨道中排序并与定格一起导出。');
          render();
          strip.querySelector(`[data-frame="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } });
        persist();
        if (result.previewError) {
          mediaError = result.previewError.message;
          api.toast('录制已入轨，但暂时无法预览；可先下载保存');
        } else {
          await prepareMedia();
          api.toast(`录制已加入轨道第 ${project.frames.length} 段`);
        }
      } catch (error) {
        showResult(blob, mime, '视频已生成，但未能保存到轨道', `${error.message}；请立即下载保存。`);
        api.toast('视频未能入轨，请先下载保存');
      }
    } else {
      showResult(blob, mime, interrupted ? '轨道导出已提前结束' : '整条轨道已合成视频', '导出结果请下载保存；原来的定格和录制片段仍在同一条轨道中。');
      api.toast('轨道视频已生成，点击下载保存');
    }
  }

  function stopRecording(interrupted = false) {
    if (!recorder || recorder.state === 'inactive' || finishing) return;
    finishing = true;
    recorder.interrupted = interrupted;
    recorder.finishedAt = performance.now();
    playing = false;
    activeMedia?.pause();
    recorder.stop();
    render();
  }

  function startRecording(kind) {
    if (isRecording()) return;
    if (kind === 'timeline' && !mediaReady) { api.toast(mediaError || '视频片段仍在读取，请稍后重试'); return; }
    if (!window.MediaRecorder || !capture.captureStream) { api.toast('当前浏览器不支持录制，请用最新版 Chrome 打开'); return; }
    if (kind === 'timeline' && (!project.frames.length || total() > LIMIT_SECONDS)) { api.toast('请添加定格，并将视频总时长控制在 180 秒以内'); return; }
    if (!api.captureScene().figures.length && kind === 'live') { api.toast('先添加角色，再录制'); return; }
    stopPreview();
    setOpen(true);
    const chunks = [];
    let failed = false;
    try {
      if (kind === 'timeline') {
        beginPreview();
        time = 0;
        showSample();
      }
      if (activeMedia) drawMedia(capture, activeMedia);
      else api.drawClean(capture);
      stream = capture.captureStream(30);
      const mime = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('没有可用的视频编码格式');
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
      const activeRecorder = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { failed = true; api.toast('视频录制失败，请结束后重试'); stopRecording(true); };
      recorder.onstop = async () => {
        const interrupted = activeRecorder.interrupted;
        const finalMime = activeRecorder.mimeType || mime;
        const kind = recordingKind;
        const elapsed = ((activeRecorder.finishedAt || performance.now()) - recordingStart) / 1000;
        releaseStream();
        recordingKind = null;
        recorder = null;
        stopPreview();
        try {
          if (!failed && chunks.length) await completeRecording(new Blob(chunks, { type: finalMime }), finalMime, interrupted, kind, elapsed);
          else api.toast('没有生成有效视频，请重新录制');
        } finally { finishing = false; render(); }
      };
      recorder.onstart = () => {
        recordingStart = performance.now();
        playStart = recordingStart;
        playing = kind === 'timeline';
      };
      recordingKind = kind;
      recordingStart = performance.now();
      lastCapture = 0;
      recorder.start(200);
      render();
    } catch (error) {
      releaseStream();
      recordingKind = null;
      recorder = null;
      finishing = false;
      stopPreview();
      api.toast(`无法开始录制：${error.message}`);
    }
  }

  host.addEventListener('click', (event) => {
    const frame = event.target.closest('[data-frame]');
    if (frame && !isRecording()) {
      stopPreview();
      selected = frame.dataset.frame;
      const entry = project.frames.find((f) => f.id === selected);
      if (entry.kind === 'video') {
        const asset = clips.get(entry.clipId);
        if (asset) showResult(asset.blob, asset.blob.type, '选中的录制片段', '此视频与定格共用轨道，可前移、后移、删除或一起合成。');
        else api.toast(mediaError || '视频片段正在读取');
      } else { api.loadFrame(entry.scene); api.applyView(entry.view); }
      render();
      return;
    }
    const action = event.target.closest('[data-motion]')?.dataset.motion;
    if (!action) return;
    if (action === 'close') return setOpen(false);
    if (action === 'live') return recordingKind === 'live' ? stopRecording() : startRecording('live');
    if (action === 'export') return recordingKind === 'timeline' ? stopRecording(true) : startRecording('timeline');
    if (isRecording()) return;
    if (action === 'stop') return stopPreview();
    if (action === 'play' && project.frames.length && mediaReady) {
      beginPreview();
      playing = !playing;
      if (!playing) activeMedia?.pause();
      playStart = performance.now() - time * 1000;
      render();
      return;
    }
    if (editingSnapshot) return;
    if (action === 'add') return addFrame();
    if (action === 'replace') return addFrame(true);
    if (action === 'undo' && frameHistory.length) {
      const previous = frameHistory.pop();
      project.frames = previous.frames;
      selected = previous.selected;
    } else {
      const index = project.frames.findIndex((f) => f.id === selected);
      if (index < 0) return;
      const other = index + (action === 'back' ? -1 : 1);
      if (action === 'delete') {
        rememberFrames();
        project.frames.splice(index, 1);
        selected = project.frames[Math.min(index, project.frames.length - 1)]?.id || null;
      } else if ((action === 'back' || action === 'forward') && other >= 0 && other < project.frames.length) {
        rememberFrames();
        [project.frames[index], project.frames[other]] = [project.frames[other], project.frames[index]];
      } else return;
    }
    time = 0;
    persist();
    render();
    prepareMedia();
  });

  host.addEventListener('change', (event) => {
    const trackId = event.target.dataset.travelTrack;
    if (trackId) {
      if (editingSnapshot || isRecording()) return;
      const index = project.frames.findIndex((frame) => frame.id === selected);
      const frame = project.frames[index];
      const next = project.frames[index + 1];
      if (!frame || frame.kind === 'video' || frameTiming(frame, project.settings).mode === 'step' || !next || next.kind === 'video' || !travelCandidates(frame.scene, next.scene).some((item) => item.trackId === trackId)) return;
      rememberFrames();
      const choices = normalizeTravel(frame.travel);
      if (event.target.value === 'walk' || event.target.value === 'run') choices[trackId] = event.target.value;
      else delete choices[trackId];
      frame.travel = choices;
      persist();
      render();
      return;
    }
    const key = event.target.dataset.motionSetting;
    if (!key || editingSnapshot || isRecording()) return;
    const frame = project.frames.find((item) => item.id === selected);
    if (!frame || frame.kind === 'video') return;
    rememberFrames();
    frame.timing = normalizeTiming({ ...frameTiming(frame, project.settings), [key]: key === 'mode' ? event.target.value : Number(event.target.value) });
    time = 0;
    persist();
    render();
  });
  seek.addEventListener('input', () => {
    if (isRecording() || !project.frames.length || !mediaReady) return;
    beginPreview();
    playing = false;
    time = Number(seek.value);
    showSample();
    buttons('play').textContent = '▶ 继续';
    buttons('stop').disabled = false;
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (recordingKind) stopRecording(true);
    else if (playing) { playing = false; activeMedia?.pause(); render(); }
  });
  window.addEventListener('pagehide', () => { releaseStream(); clips.dispose(); });
  document.getElementById('motion-toggle').addEventListener('click', () => setOpen(host.hidden));
  render();
  if (!mediaReady) prepareMedia();

  return {
    get isPreviewing() { return Boolean(editingSnapshot); },
    get isRecording() { return isRecording(); },
    toggle: () => setOpen(host.hidden),
    stop: () => recordingKind ? stopRecording(true) : stopPreview(),
    update(now) {
      if (playing) {
        time = Math.min(total(), (now - playStart) / 1000);
        showSample();
        if (time >= total()) {
          playing = false;
          if (recordingKind === 'timeline') endRecording = true;
          else { stopPreview(); api.toast('预览结束，已返回编辑'); }
        }
      }
      if (recordingKind && now - recordingStart >= LIMIT_SECONDS * 1000) endRecording = true;
      if (now - lastStatus > 100) { updateProgress(); lastStatus = now; }
    },
    afterRender(now) {
      const captureDue = recordingKind && !finishing && (now - lastCapture >= 1000 / 30 || endRecording);
      if (editingSnapshot || captureDue) {
        if (activeMedia) drawMedia(capture, activeMedia);
        else api.drawClean(capture);
      }
      if (editingSnapshot && !videoLayer.hidden) {
        const viewport = api.previewViewport();
        Object.assign(videoLayer.style, { left: `${viewport.left}px`, top: `${viewport.top}px`, width: `${viewport.width}px`, height: `${viewport.height}px` });
        if (videoLayer.width !== Math.round(viewport.width) || videoLayer.height !== Math.round(viewport.height)) { videoLayer.width = Math.round(viewport.width); videoLayer.height = Math.round(viewport.height); }
        drawMedia(videoLayer, capture);
      }
      if (captureDue) {
        lastCapture = now - ((now - lastCapture) % (1000 / 30));
      }
      if (endRecording) { endRecording = false; stopRecording(); }
    },
  };
}
