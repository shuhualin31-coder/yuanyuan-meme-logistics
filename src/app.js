const IMAGE_PATTERN = /\.(jpe?g|png|webp|gif)$/i;
const SUPABASE_URL = 'https://kxixtofcjlnonwpxoaou.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gmt6yKnlfHkTGxnTZpUJfg_2EM-jKs1';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aXh0b2Zjamxub253cHhvYW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0OTM5OTksImV4cCI6MjEwNjA2OTk5OX0.-x-2fMWzN6THRbKHDmWyW1XtcTEWAEv4LtxEris2_H8';
const AI_ANALYZE_URL = `${SUPABASE_URL}/functions/v1/meme-analyze`;
const MEME_IMPORT_URL = `${SUPABASE_URL}/functions/v1/meme-import`;

const els = Object.fromEntries([
  'zip-input','dropzone','file-note','processing','progress-bar','progress-text',
  'workspace','thumbnails','image-count','position','current-status','image-stage',
  'previous','next','meme-form','mark-reviewed','reanalyze','retry-failed',
  'analyze-all','upload-reviewed','form-note','thumbnail-template'
].map((id) => [id, document.getElementById(id)]));

class LocalMemeRepository {
  constructor(key = 'yuanyuan-meme-session') { this.key = key; }
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } }
  save(memes) {
    localStorage.setItem(this.key, JSON.stringify(
      Object.fromEntries(memes.map(({ image, aiError, ...meme }) => [meme.id, meme]))
    ));
  }
}

const repository = new LocalMemeRepository();
const state = { memes: [], current: 0, failedAnalysis: new Set() };
const size = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;
const getCurrent = () => state.memes[state.current];
const setProgress = (value, text) => {
  els['progress-bar'].style.width = `${value}%`;
  els['progress-text'].textContent = text;
};

function uint32(view, offset) { return view.getUint32(offset, true); }
function uint16(view, offset) { return view.getUint16(offset, true); }
function decodeName(bytes) { return new TextDecoder().decode(bytes); }

async function unzipImages(file) {
  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);
  const data = new Uint8Array(bytes);
  let end = -1;
  for (let i = Math.max(0, data.length - 65557); i <= data.length - 22; i += 1) {
    if (uint32(view, i) === 0x06054b50) end = i;
  }
  if (end < 0) throw new Error('这不是可读取的 ZIP 文件。');

  let cursor = uint32(view, end + 16);
  const count = uint16(view, end + 10);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    if (uint32(view, cursor) !== 0x02014b50) throw new Error('ZIP 目录损坏。');
    const method = uint16(view, cursor + 10);
    const compressedSize = uint32(view, cursor + 20);
    const nameLength = uint16(view, cursor + 28);
    const extraLength = uint16(view, cursor + 30);
    const commentLength = uint16(view, cursor + 32);
    const localOffset = uint32(view, cursor + 42);
    const name = decodeName(data.slice(cursor + 46, cursor + 46 + nameLength));
    if (IMAGE_PATTERN.test(name)) entries.push({ name, method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries.map((entry) => ({
    ...entry,
    async blob() {
      const local = entry.localOffset;
      if (uint32(view, local) !== 0x04034b50) throw new Error('ZIP 条目损坏。');
      const start = local + 30 + uint16(view, local + 26) + uint16(view, local + 28);
      const content = data.slice(start, start + entry.compressedSize);
      let output;
      if (entry.method === 0) output = content;
      else if (entry.method === 8 && 'DecompressionStream' in window) {
        output = new Uint8Array(
          await new Response(
            new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
          ).arrayBuffer()
        );
      } else {
        throw new Error('浏览器不支持此 ZIP 压缩方式。');
      }
      return new Blob([output], { type: mimeType(entry.name) });
    }
  }));
}

function mimeType(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
}

function defaultMeme(id, image) {
  return {
    id, image, name: '', description: '', tags: '', emotion: '',
    scenes: '', tone: '', intensity: '', speech_acts: '', aliases: '',
    status: 'pending', aiAnalyzed: false, synced: false
  };
}

function persist() { repository.save(state.memes); }

function restoreFields(meme) {
  Object.keys(meme).forEach((key) => {
    const field = els['meme-form'].elements.namedItem(key);
    if (field) field.value = meme[key] || '';
  });
}

function renderThumbnails() {
  els.thumbnails.replaceChildren();
  const template = els['thumbnail-template'];
  state.memes.forEach((meme, index) => {
    const item = template.content.firstElementChild.cloneNode(true);
    item.classList.toggle('active', index === state.current);
    item.querySelector('img').src = meme.image;
    item.querySelector('img').alt = meme.name || `第 ${index + 1} 张表情包`;
    item.querySelector('.thumbnail-status').classList.toggle('reviewed', meme.status === 'reviewed');
    item.querySelector('.thumbnail-ai').classList.toggle('ready', meme.aiAnalyzed === true);
    item.addEventListener('click', () => select(index));
    els.thumbnails.append(item);
  });
}

function render() {
  const meme = getCurrent();
  if (!meme) return;
  els.position.textContent = `${state.current + 1} / ${state.memes.length}`;
  els['current-status'].textContent = meme.status === 'reviewed' ? '已审核' : '待审核';
  els['current-status'].classList.toggle('reviewed', meme.status === 'reviewed');

  const image = new Image();
  image.src = meme.image;
  image.alt = meme.name || `第 ${state.current + 1} 张表情包`;
  els['image-stage'].replaceChildren(image);
  els.previous.disabled = state.current === 0;
  els.next.disabled = state.current === state.memes.length - 1;
  restoreFields(meme);
  renderThumbnails();
}

function select(index) {
  state.current = index;
  els['form-note'].textContent = '';
  render();
}

function readForm() {
  const meme = getCurrent();
  new FormData(els['meme-form']).forEach((value, key) => { meme[key] = value.trim(); });
}

function saveCurrent(message = '已保存到本地浏览器。') {
  readForm();
  persist();
  els['form-note'].textContent = message;
  render();
}

function arrayToText(value) {
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

async function imageUrlToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('无法读取当前图片。');
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(blob);
  });
}

function applyAiResult(meme, result) {
  const fields = {
    name: result.name,
    description: result.description,
    tags: arrayToText(result.tags),
    emotion: result.emotion,
    scenes: arrayToText(result.scenes),
    tone: result.tone,
    intensity: String(result.intensity ?? ''),
    speech_acts: arrayToText(result.speech_acts),
    aliases: arrayToText(result.aliases),
  };

  let filled = 0;
  Object.entries(fields).forEach(([key, value]) => {
    if (!String(meme[key] || '').trim() && String(value || '').trim()) {
      meme[key] = value;
      filled += 1;
    }
  });
  meme.aiAnalyzed = true;
  meme.aiError = '';
  return filled;
}

async function analyzeMeme(meme) {
  const image = await imageUrlToDataUrl(meme.image);
  const response = await fetch(AI_ANALYZE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ image }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload.code || payload.error || `HTTP ${response.status}`;
    throw new Error(code === 'OPENAI_API_KEY_MISSING'
      ? 'AI服务还没有配置 API Key。'
      : `AI分析失败：${code}`);
  }

  return payload.result;
}

async function analyzeCurrent() {
  const meme = getCurrent();
  if (!meme) return;
  els['reanalyze'].disabled = true;
  els['form-note'].textContent = 'AI正在看这张图……';
  try {
    const result = await analyzeMeme(meme);
    const filled = applyAiResult(meme, result);
    persist();
    els['form-note'].textContent = `AI分析完成，填入了 ${filled} 个空白字段；已有人工修改没有被覆盖。`;
    render();
  } catch (error) {
    meme.aiError = error.message;
    state.failedAnalysis.add(meme.id);
    els['form-note'].textContent = error.message;
  } finally {
    els['reanalyze'].disabled = false;
  }
}

async function analyzeAll() {
  if (!state.memes.length) return;
  els['analyze-all'].disabled = true;
  state.failedAnalysis.clear();
  els.processing.classList.remove('hidden');

  for (let index = 0; index < state.memes.length; index += 1) {
    const meme = state.memes[index];
    setProgress(
      Math.round((index / state.memes.length) * 100),
      `AI正在分析 ${index + 1} / ${state.memes.length}`
    );
    try {
      const result = await analyzeMeme(meme);
      applyAiResult(meme, result);
    } catch (error) {
      meme.aiError = error.message;
      state.failedAnalysis.add(meme.id);
    }
    persist();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  setProgress(
    100,
    state.failedAnalysis.size
      ? `AI分析完成，${state.failedAnalysis.size} 张失败，可用“重试失败项”再次尝试`
      : `AI分析完成：${state.memes.length} 张`
  );
  els['analyze-all'].disabled = false;
  render();
}

async function uploadReviewed() {
  readForm();
  persist();

  const targets = state.memes.filter((meme) => meme.status === 'reviewed' && !meme.synced);
  if (!targets.length) {
    els['form-note'].textContent = '没有新的“已审核”表情包需要上传。';
    return;
  }

  els['upload-reviewed'].disabled = true;
  els['form-note'].textContent = `正在把 ${targets.length} 张已审核表情包送进 Supabase……`;

  try {
    const items = [];
    for (const meme of targets) {
      const image = await imageUrlToDataUrl(meme.image);
      items.push({
        id: meme.id,
        filename: meme.id.split(':').slice(1).join(':') || meme.name,
        image,
        name: meme.name,
        description: meme.description,
        tags: meme.tags,
        emotion: meme.emotion,
        scenes: meme.scenes,
        tone: meme.tone,
        intensity: meme.intensity,
        speech_acts: meme.speech_acts,
        aliases: meme.aliases,
        status: meme.status,
        aiAnalyzed: meme.aiAnalyzed === true,
      });
    }

    const response = await fetch(MEME_IMPORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ items }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `上传失败：HTTP ${response.status}`);

    const failed = new Map((payload.failed || []).map((item) => [item.id, item.error]));
    targets.forEach((meme) => {
      if (!failed.has(meme.id)) {
        meme.synced = true;
        meme.aiError = '';
      } else {
        meme.aiError = `入库失败：${failed.get(meme.id)}`;
      }
    });

    persist();
    const successCount = targets.length - failed.size;
    els['form-note'].textContent = failed.size
      ? `已入库 ${successCount} 张，还有 ${failed.size} 张失败，可修正后再次上传。`
      : `已成功送达 Supabase：${successCount} 张。🎉`;
    render();
  } catch (error) {
    els['form-note'].textContent = error.message || '上传失败。';
  } finally {
    els['upload-reviewed'].disabled = false;
  }
}

async function retryFailed() {
  const targets = state.memes.filter((meme) => state.failedAnalysis.has(meme.id) || meme.aiError);
  if (!targets.length) {
    els['form-note'].textContent = '目前没有需要重试的 AI 失败项。';
    return;
  }

  state.failedAnalysis.clear();
  els['retry-failed'].disabled = true;
  for (let index = 0; index < targets.length; index += 1) {
    const meme = targets[index];
    els['form-note'].textContent = `正在重试 ${index + 1} / ${targets.length}…`;
    try {
      const result = await analyzeMeme(meme);
      applyAiResult(meme, result);
    } catch (error) {
      meme.aiError = error.message;
      state.failedAnalysis.add(meme.id);
    }
    persist();
  }
  els['retry-failed'].disabled = false;
  els['form-note'].textContent = state.failedAnalysis.size
    ? `还有 ${state.failedAnalysis.size} 张失败。`
    : '失败项已经全部重试成功。';
  render();
}

async function importDirectImages(fileList) {
  const files = Array.from(fileList || {}).filter((file) => {
    if (!file) return false;
    return IMAGE_PATTERN.test(file.name) || /^image\/(jpeg|png|webp|gif)$/i.test(file.type);
  });

  if (!files.length) {
    els['file-note'].textContent = '请选择 JPG、JPEG、PNG、WEBP 或 GIF 图片。';
    return;
  }

  const saved = repository.load();
  const startCount = state.memes.length;
  const imported = [];

  for (const [index, file] of files.entries()) {
    const id = `direct:${file.name}:${file.lastModified}:${file.size}:${Date.now()}:${index}`;
    imported.push({
      ...defaultMeme(id, URL.createObjectURL(file)),
      ...(saved[id] || {})
    });
  }

  state.memes.push(...imported);
  state.current = startCount;
  persist();
  els['image-count'].textContent = `找到 ${state.memes.length} 张图片`;
  els.workspace.classList.remove('hidden');
  els.processing.classList.add('hidden');
  els['file-note'].textContent = `已直接添加 ${imported.length} 张图片`;
  els['form-note'].textContent = '图片已加入队列，可以开始 AI 分析。';
  render();
}

async function importZip(file) {
  if (!file || !file.name.toLowerCase().endsWith('.zip')) {
    els['file-note'].textContent = '请选择 ZIP 文件。';
    return;
  }

  els['file-note'].textContent = `${file.name} · ${size(file.size)}`;
  els.processing.classList.remove('hidden');
  els.workspace.classList.add('hidden');

  try {
    setProgress(5, '正在读取 ZIP…');
    const files = await unzipImages(file);
    if (!files.length) throw new Error('ZIP 内没有找到支持的图片文件。');

    const saved = repository.load();
    state.memes = [];
    state.failedAnalysis.clear();
    let failed = 0;

    for (const [index, entry] of files.entries()) {
      setProgress(
        Math.round(((index + 1) / files.length) * 100),
        `正在读取 ${index + 1} / ${files.length}`
      );
      try {
        const blob = await entry.blob();
        const id = `${file.name}:${entry.name}`;
        state.memes.push({
          ...defaultMeme(id, URL.createObjectURL(blob)),
          ...(saved[id] || {})
        });
      } catch {
        failed += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (!state.memes.length) throw new Error('图片读取失败，请尝试其他 ZIP。');
    state.current = 0;
    persist();
    els['image-count'].textContent = `找到 ${state.memes.length} 张图片`;
    els.workspace.classList.remove('hidden');
    els.processing.classList.add('hidden');
    render();
    els['form-note'].textContent = failed
      ? `已读取 ${state.memes.length} 张，${failed} 项图片读取失败。`
      : '图片已全部送达，可以开始 AI 分析。';
  } catch (error) {
    els['file-note'].textContent = error.message || '无法读取 ZIP 文件。';
    els.processing.classList.add('hidden');
  }
}

els['zip-input'].addEventListener('change', (event) => importZip(event.target.files[0]));
els['direct-input'].addEventListener('change', (event) => {
  importDirectImages(event.target.files);
  event.target.value = '';
});
['dragenter', 'dragover'].forEach((eventName) =>
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.add('is-dragover');
  })
);
['dragleave', 'drop'].forEach((eventName) =>
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('is-dragover');
  })
);
els.dropzone.addEventListener('drop', (event) => importZip(event.dataTransfer.files[0]));
els.previous.addEventListener('click', () => select(Math.max(0, state.current - 1)));
els.next.addEventListener('click', () => select(Math.min(state.memes.length - 1, state.current + 1)));
els['meme-form'].addEventListener('submit', (event) => { event.preventDefault(); saveCurrent(); });
els['mark-reviewed'].addEventListener('click', () => {
  getCurrent().status = 'reviewed';
  saveCurrent('已标记为已审核。');
});
els.reanalyze.addEventListener('click', analyzeCurrent);
els['analyze-all'].addEventListener('click', analyzeAll);
els['retry-failed'].addEventListener('click', retryFailed);
els['upload-reviewed'].addEventListener('click', uploadReviewed);
