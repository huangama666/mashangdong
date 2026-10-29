/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
// Video blobs stay in IndexedDB; the track only stores small clip references.
// Keep the legacy database identifier after rebranding so saved clips remain readable.
export function createClipStore() {
  let database;
  const media = new Map();
  const open = () => database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('ssspo-motion-media', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('clips');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(new Error('无法打开本机视频存储')); };
  });

  async function load(id) {
    if (media.has(id)) return media.get(id);
    const db = await open();
    const blob = await new Promise((resolve, reject) => {
      const request = db.transaction('clips').objectStore('clips').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('无法读取视频片段'));
    });
    if (!(blob instanceof Blob)) throw new Error('视频片段已丢失，请删除该视频段或重新录制');
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('视频读取超时')), 10000);
        video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error('浏览器无法解码该视频片段')); };
        video.src = url;
        video.load();
      });
    } catch (error) { URL.revokeObjectURL(url); throw error; }
    const asset = { video, url, blob };
    media.set(id, asset);
    return asset;
  }

  return {
    async save(id, blob) {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('clips', 'readwrite');
        tx.objectStore('clips').put(blob, id);
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(new Error('本机视频存储空间不足，请先下载视频'));
      });
      return blob;
    },
    load,
    get: (id) => media.get(id),
    pause() { media.forEach(({ video }) => video.pause()); },
    dispose() { media.forEach(({ video, url }) => { video.pause(); URL.revokeObjectURL(url); }); media.clear(); },
  };
}
