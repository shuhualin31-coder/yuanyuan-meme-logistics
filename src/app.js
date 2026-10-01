const IMAGE_PATTERN = /\.(jpe?g|png|webp|gif)$/i;
const els = Object.fromEntries(['zip-input','dropzone','file-note','processing','progress-bar','progress-text','workspace','thumbnails','image-count','position','current-status','image-stage','previous','next','meme-form','mark-reviewed','reanalyze','retry-failed','form-note','thumbnail-template'].map((id) => [id, document.getElementById(id)]));

class LocalMemeRepository {
  constructor(key = 'yuanyuan-meme-session') { this.key = key; }
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } }
  save(memes) { localStorage.setItem(this.key, JSON.stringify(Object.fromEntries(memes.map(({ image, ...meme }) => [meme.id, meme])))); }
}

const repository = new LocalMemeRepository();
const state = { memes: [], current: 0 };
const size = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;
const getCurrent = () => state.memes[state.current];
const setProgress = (value, text) => { els['progress-bar'].style.width = `${value}%`; els['progress-text'].textContent = text; };

// Small browser-native ZIP reader for this prototype. It supports ordinary stored and
// deflated entries; no remote library or service is required.
function uint32(view, offset) { return view.getUint32(offset, true); }
function uint16(view, offset) { return view.getUint16(offset, true); }
function decodeName(bytes) { return new TextDecoder().decode(bytes); }
async function unzipImages(file) {
  const bytes = await file.arrayBuffer(); const view = new DataView(bytes); const data = new Uint8Array(bytes);
  let end = -1;
  for (let i = Math.max(0, data.length - 65557); i <= data.length - 22; i += 1) if (uint32(view, i) === 0x06054b50) end = i;
  if (end < 0) throw new Error('这不是可读取的 ZIP 文件。');
  let cursor = uint32(view, end + 16); const count = uint16(view, end + 10); const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (uint32(view, cursor) !== 0x02014b50) throw new Error('ZIP 目录损坏。');
    const method = uint16(view, cursor + 10); const compressedSize = uint32(view, cursor + 20); const nameLength = uint16(view, cursor + 28); const extraLength = uint16(view, cursor + 30); const commentLength = uint16(view, cursor + 32); const localOffset = uint32(view, cursor + 42); const name = decodeName(data.slice(cursor + 46, cursor + 46 + nameLength));
    if (IMAGE_PATTERN.test(name)) entries.push({ name, method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries.map((entry) => ({ ...entry, async blob() { const local = entry.localOffset; if (uint32(view, local) !== 0x04034b50) throw new Error('ZIP 条目损坏。'); const start = local + 30 + uint16(view, local + 26) + uint16(view, local + 28); const content = data.slice(start, start + entry.compressedSize); let output; if (entry.method === 0) output = content; else if (entry.method === 8 && 'DecompressionStream' in window) output = new Uint8Array(await new Response(new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); else throw new Error('浏览器不支持此 ZIP 压缩方式。'); return new Blob([output], { type: mimeType(entry.name) }); } }));
}
function mimeType(name) { const ext = name.split('.').pop().toLowerCase(); return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`; }

function defaultMeme(id, image) { return { id, image, name: '', description: '', tags: '', emotion: '', scenes: '', tone: '', intensity: '', status: 'pending' }; }
function persist() { repository.save(state.memes); }
function restoreFields(meme) { Object.keys(meme).forEach((key) => { const field = els['meme-form'].elements.namedItem(key); if (field) field.value = meme[key] || ''; }); }
function renderThumbnails() { els.thumbnails.replaceChildren(); const template = els['thumbnail-template']; state.memes.forEach((meme, index) => { const item = template.content.firstElementChild.cloneNode(true); item.classList.toggle('active', index === state.current); item.querySelector('img').src = meme.image; item.querySelector('img').alt = meme.name || `第 ${index + 1} 张表情包`; item.querySelector('.thumbnail-status').classList.toggle('reviewed', meme.status === 'reviewed'); item.addEventListener('click', () => select(index)); els.thumbnails.append(item); }); }
function render() { const meme = getCurrent(); if (!meme) return; els.position.textContent = `${state.current + 1} / ${state.memes.length}`; els['current-status'].textContent = meme.status === 'reviewed' ? '已审核' : '待审核'; els['current-status'].classList.toggle('reviewed', meme.status === 'reviewed'); const image = new Image(); image.src = meme.image; image.alt = meme.name || `第 ${state.current + 1} 张表情包`; els['image-stage'].replaceChildren(image); els.previous.disabled = state.current === 0; els.next.disabled = state.current === state.memes.length - 1; restoreFields(meme); renderThumbnails(); }
function select(index) { state.current = index; els['form-note'].textContent = ''; render(); }
function readForm() { const meme = getCurrent(); new FormData(els['meme-form']).forEach((value, key) => { meme[key] = value.trim(); }); }
function saveCurrent(message = '已保存到本地浏览器。') { readForm(); persist(); els['form-note'].textContent = message; render(); }

async function importZip(file) {
  if (!file || !file.name.toLowerCase().endsWith('.zip')) { els['file-note'].textContent = '请选择 ZIP 文件。'; return; }
  els['file-note'].textContent = `${file.name} · ${size(file.size)}`; els.processing.classList.remove('hidden'); els.workspace.classList.add('hidden');
  try {
    setProgress(5, '正在读取 ZIP…'); const files = await unzipImages(file);
    if (!files.length) throw new Error('ZIP 内没有找到支持的图片文件。');
    const saved = repository.load(); state.memes = []; let failed = 0;
    for (const [index, entry] of files.entries()) {
      setProgress(Math.round(((index + 1) / files.length) * 100), `正在处理 ${index + 1} / ${files.length}`);
      try { const blob = await entry.blob(); const id = `${file.name}:${entry.name}`; state.memes.push({ ...defaultMeme(id, URL.createObjectURL(blob)), ...(saved[id] || {}) }); } catch { failed += 1; }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!state.memes.length) throw new Error('图片读取失败，请尝试其他 ZIP。'); state.current = 0; persist(); els['image-count'].textContent = `找到 ${state.memes.length} 张图片`; els.workspace.classList.remove('hidden'); render(); setProgress(100, `处理完成：${state.memes.length} 张图片${failed ? `，${failed} 项失败` : ''}`);
  } catch (error) { els['file-note'].textContent = error.message || '无法读取 ZIP 文件。'; els.processing.classList.add('hidden'); }
}

els['zip-input'].addEventListener('change', (event) => importZip(event.target.files[0]));
['dragenter', 'dragover'].forEach((eventName) => els.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropzone.classList.add('is-dragover'); }));
['dragleave', 'drop'].forEach((eventName) => els.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropzone.classList.remove('is-dragover'); }));
els.dropzone.addEventListener('drop', (event) => importZip(event.dataTransfer.files[0]));
els.previous.addEventListener('click', () => select(Math.max(0, state.current - 1))); els.next.addEventListener('click', () => select(Math.min(state.memes.length - 1, state.current + 1)));
els['meme-form'].addEventListener('submit', (event) => { event.preventDefault(); saveCurrent(); });
els['mark-reviewed'].addEventListener('click', () => { getCurrent().status = 'reviewed'; saveCurrent('已标记为已审核。'); });
els.reanalyze.addEventListener('click', () => { els['form-note'].textContent = '重新分析接口已预留，第二阶段将接入 AI 服务。'; });
els['retry-failed'].addEventListener('click', () => { els['form-note'].textContent = '失败项目重试入口已预留；请重新导入 ZIP 以再次读取文件。'; });
