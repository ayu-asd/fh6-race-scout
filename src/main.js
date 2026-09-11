import { create as createPond, registerPlugin } from 'filepond';
import FilePondPluginFileValidateType from 'filepond-plugin-file-validate-type';
import 'filepond/dist/filepond.min.css';
import { matchRecords } from './match.js';

registerPlugin(FilePondPluginFileValidateType);

const BASE = import.meta.env.BASE_URL;
const CROP = { x1: 0.138, x2: 0.617, y1: 0.18, y2: 0.535 };

const $ = (id) => document.getElementById(id);
const els = {
  uploadWrap: $('upload-wrap'), fileInput: $('file-input'), previewWrap: $('preview-wrap'),
  preview: $('preview'), shotInfo: $('shot-info'), resetBtn: $('reset-btn'),
  results: $('results'), progress: $('progress'), progressText: $('progress-text'),
  toast: $('toast'), engineStatus: $('engine-status'), debugToggle: $('debug-toggle'),
  rawText: $('raw-text'), manualWrap: $('manual-wrap'), manualSearch: $('manual-search'),
  manualResults: $('manual-results'),
  sampleModal: $('sample-modal'), sampleBtn: $('sample-btn'), sampleClose: $('sample-close'),
};

const pond = createPond(els.fileInput, {
  allowMultiple: false,
  credits: false,
  acceptedFileTypes: ['image/*'],
  labelIdle: '拖入图片，或 <span class="filepond--label-action">点击选择文件</span>，或直接 <strong>Ctrl+V</strong> 粘贴截图',
  labelFileLoading: '读取中…',
  labelFileProcessingComplete: '已加载',
  labelFileProcessingAborted: '已取消',
  labelTapToCancel: '点击取消',
  onaddfile: async (err, item) => {
    if (err) return;
    const f = item.file;
    setTimeout(() => pond.removeFiles(), 60);
    handleImage(await fileToImage(f));
  },
});
window.__pond = pond;

let races = [];
let zhMap = {};
let debug = false;
let currentImg = null;

function showToast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', isError);
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (els.toast.hidden = true), isError ? 5000 : 2600);
}

els.engineStatus.textContent = '● 云端识别就绪';
els.engineStatus.className = 'status-dot ready';

async function loadData() {
  const [r, z] = await Promise.all([
    fetch(`${BASE}data/races.json`).then((x) => x.json()),
    fetch(`${BASE}data/zh_map.json`).then((x) => x.json()),
  ]);
  races = r.races;
  zhMap = z.map ?? z;
}

async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res, rej) => ((img.onload = res), (img.onerror = rej), (img.src = url)));
  return img;
}

function drawPreview(img) {
  els.preview.width = img.naturalWidth;
  els.preview.height = img.naturalHeight;
  const ctx = els.preview.getContext('2d');
  ctx.drawImage(img, 0, 0);
  if (debug) {
    const { x1, x2, y1, y2 } = CROP;
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = Math.max(2, img.naturalWidth / 500);
    ctx.strokeRect(x1 * img.naturalWidth, y1 * img.naturalHeight, (x2 - x1) * img.naturalWidth, (y2 - y1) * img.naturalHeight);
  }
}

async function handleImage(img) {
  currentImg = img;
  els.previewWrap.hidden = false;
  els.results.hidden = false;
  els.results.innerHTML = '';
  els.shotInfo.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
  drawPreview(img);

  showProgress('云端识别中…');
  await new Promise((r) => setTimeout(r, 30));
  try {
    const panel = cropPanel(img);
    const image = encodeCrop(panel.canvas);
    const t0 = performance.now();
    const resp = await fetch(`${BASE}api/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || `请求失败 (${resp.status})`);
    const text = json.text || '';
    const ms = Math.round(performance.now() - t0);
    if (debug) {
      els.rawText.hidden = false;
      const kb = Math.round((image.length - image.indexOf(',')) * 0.75 / 1024);
      const fmt = image.startsWith('data:image/webp') ? 'webp' : 'jpeg';
      els.rawText.textContent = `[裁剪 ${panel.canvas.width}×${panel.canvas.height} · 上传 ${kb}KB ${fmt} · 识别 ${ms}ms]\n${text}`;
    }
    const parsed = parseRaces(text);
    if (!parsed.length) {
      hideProgress();
      els.results.innerHTML = '<p class="warn-note">未识别到比赛信息——请确认截图包含左侧比赛列表，或用下方手动查询。</p>';
      return;
    }
    let matched = matchRecords(parsed, races, zhMap);
    if (!matched.length) {
      hideProgress();
      els.results.innerHTML = '<p class="warn-note">未识别到比赛信息——请确认截图包含左侧比赛列表，或用下方手动查询。</p>';
      return;
    }
    if (matched.length > 3) {
      const withKm = matched.filter((m) => m.record.km != null);
      matched = (withKm.length >= 3 ? withKm : matched).slice(0, 3);
    }
    renderCards(matched, ms);
  } catch (e) {
    console.error(e);
    showToast(`识别失败: ${e.message || e}`, true);
    els.results.innerHTML = '<p class="warn-note">识别失败，可尝试重新粘贴或使用手动查询。</p>';
  }
  hideProgress();
}

function encodeCrop(canvas) {
  let data = canvas.toDataURL('image/webp', 0.9);
  if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.85);
  return data;
}

function parseRaces(text) {
  const records = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^[\s\-*>・•\d.、)]+/, '').trim();
    if (!line) continue;
    const parts = line.split(/[|｜]/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const name = parts[0].replace(/[\s*`]/g, '');
    if (!/^[\u4e00-\u9fa5]{2,16}$/.test(name)) continue;
    const kmMatch = (parts[1] ?? '').match(/(\d+(?:\.\d+)?)/);
    const lapMatch = (parts[2] ?? '').match(/(\d+)/);
    records.push({
      name,
      km: kmMatch ? parseFloat(kmMatch[1]) : null,
      kmDot: true,
      laps: lapMatch ? parseInt(lapMatch[1], 10) : null,
      status: null,
      order: records.length,
    });
  }
  return records;
}

function cropPanel(img) {
  const { x1, x2, y1, y2 } = CROP;
  const sx = Math.round(x1 * img.naturalWidth);
  const sy = Math.round(y1 * img.naturalHeight);
  const sw = Math.round((x2 - x1) * img.naturalWidth);
  const sh = Math.round((y2 - y1) * img.naturalHeight);
  const scale = Math.min(1, 1600 / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return { canvas: c, scale };
}

function showProgress(text) {
  els.progress.hidden = false;
  els.progressText.textContent = text;
}
function hideProgress() {
  els.progress.hidden = true;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderCard(m) {
  const card = document.createElement('div');
  card.className = 'card';
  const race = m.race;
  if (!race) {
    card.innerHTML = `
      <div class="card-head">
        <div class="card-select">
          <p class="hint">置信度不足（${(m.score * 100).toFixed(0)}%），请确认${m.record.name ? `「${esc(m.record.name)}」` : `第 ${m.record.order + 1} 行（未识别到名称，仅凭千米/圈数）`}是哪场比赛：</p>
          <div class="cand-list">
            ${m.candidates
              .map((c) => {
                const why = c.race.km != null ? `${c.race.km}km${c.race.laps ? ` · ${c.race.laps}圈` : ''}` : '无数据';
                return `<button class="cand-item" data-img="${esc(c.race.image)}"><span>${esc(c.race.zh || c.race.name)}</span><span class="ci-sub">${esc(c.race.categoryZh)} · ${esc(why)}</span></button>`;
              })
              .join('')}
          </div>
        </div>
      </div>`;
    [...card.querySelectorAll('.cand-item')].forEach((btn) => {
      btn.addEventListener('click', () => {
        const race = races.find((r) => r.image === btn.dataset.img);
        rerenderCard(card, race, m.record);
      });
    });
    return card;
  }
  return buildRaceCard(race, m.record.status);
}

function buildRaceCard(race, status) {
  const card = document.createElement('div');
  card.className = 'card';
  const zh = race.zh || race.name;
  const badgeCls = ['进行中', '下一步', '报名中'].includes(status) ? status : 'default';
  card.innerHTML = `
    <div class="card-head">
      <div class="card-title-row">
        <span class="chip">${esc(race.categoryZh)}</span>
        <span class="card-name">${esc(zh)}</span>
        <span class="card-en">${esc(race.zh ? race.name : '')}</span>
      </div>
      <div class="card-meta">
        <span class="meta-item"><span>距离</span> ${esc(race.km ?? '?')} 千米</span>
        ${race.laps ? `<span class="meta-item"><span>圈数</span> ${race.laps} 圈</span>` : ''}
        ${status ? `<span class="badge ${badgeCls}">${esc(status)}</span>` : ''}
      </div>
    </div>
    <div class="card-track">
      <img src="${BASE}images/${esc(race.image)}Track.webp" alt="${esc(race.name)} track layout" />
      <span class="track-label">赛道线路图</span>
    </div>
    ${race.hasDetails === false ? '' : '<button class="card-details-toggle">赛事详情图 ▾</button>'}`;
  const trackImg = card.querySelector('.card-track img');
  trackImg.addEventListener('error', () => {
    card.querySelector('.card-track').innerHTML = '<span class="track-missing">线路图待补——进比赛详情界面截图发我即可补上</span>';
  });
  const btn = card.querySelector('.card-details-toggle');
  if (!btn) return card;
  btn.addEventListener('click', () => {
    const existing = card.querySelector('.card-details');
    if (existing) {
      existing.remove();
      btn.textContent = '赛事详情图 ▾';
      return;
    }
    const div = document.createElement('div');
    div.className = 'card-details';
    div.innerHTML = `<img src="${BASE}images/${esc(race.image)}Details.webp" alt="${esc(race.name)} details" />`;
    card.insertBefore(div, btn);
    btn.textContent = '收起详情图 ▴';
  });
  return card;
}

function rerenderCard(card, race, record) {
  const fresh = buildRaceCard(race, record.status);
  card.replaceWith(fresh);
}

function renderCards(matched, ms) {
  els.results.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'cards';
  matched.forEach((m) => wrap.appendChild(renderCard(m)));
  els.results.appendChild(wrap);
  const low = matched.filter((m) => !m.race).length;
  const note = document.createElement('p');
  note.className = 'warn-note';
  note.textContent = `${matched.length} 场 · OCR ${ms}ms${low ? ` · ${low} 场需人工确认` : ' · 全部匹配成功'}`;
  els.results.appendChild(note);
}

function reset() {
  currentImg = null;
  els.previewWrap.hidden = true;
  els.results.hidden = true;
  els.rawText.hidden = true;
  pond.removeFiles();
}

els.resetBtn.addEventListener('click', reset);
els.debugToggle.addEventListener('click', () => {
  debug = !debug;
  els.debugToggle.classList.toggle('active', debug);
  if (currentImg) drawPreview(currentImg);
  if (!els.previewWrap.hidden) els.rawText.hidden = !debug || !els.rawText.textContent;
});

document.addEventListener('paste', async (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  handleImage(await fileToImage(item.getAsFile()));
});

function renderManualList(hits) {
  const list = els.manualResults;
  if (!hits.length) {
    list.innerHTML = '<div class="manual-item"><span>无匹配结果</span></div>';
    list.hidden = false;
    return;
  }
  list.innerHTML = hits
    .map(
      (r) =>
        `<div class="manual-item" data-img="${esc(r.image)}"><span>${esc(r.zh || r.name)}</span><span class="mi-sub">${esc(r.name)} · ${esc(r.categoryZh)} · ${esc(r.km ?? '?')}km${r.laps ? ` · ${r.laps}圈` : ''}</span></div>`
    )
    .join('');
  list.hidden = false;
  [...list.querySelectorAll('.manual-item[data-img]')].forEach((item) => {
    item.addEventListener('click', () => {
      const race = races.find((r) => r.image === item.dataset.img);
      els.results.hidden = false;
      els.results.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'cards';
      wrap.appendChild(buildRaceCard(race, null));
      els.results.appendChild(wrap);
      list.hidden = true;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

els.manualSearch.addEventListener('input', () => {
  const v = els.manualSearch.value.trim().toLowerCase();
  if (!v) {
    renderManualList(races);
    return;
  }
  const hits = races
    .filter((r) => (r.zh || '').toLowerCase().includes(v) || r.name.toLowerCase().includes(v) || r.categoryZh.includes(v))
    .slice(0, 20);
  renderManualList(hits);
});

els.manualSearch.addEventListener('focus', () => {
  if (!els.manualSearch.value.trim()) renderManualList(races);
});

els.manualSearch.addEventListener('click', () => {
  if (!els.manualResults.hidden) return;
  if (!els.manualSearch.value.trim()) renderManualList(races);
  els.manualResults.hidden = false;
});

document.addEventListener('click', (e) => {
  if (!els.manualSearch.contains(e.target) && !els.manualResults.contains(e.target)) els.manualResults.hidden = true;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    els.manualResults.hidden = true;
    els.sampleModal.hidden = true;
  }
});

els.sampleBtn.addEventListener('click', () => (els.sampleModal.hidden = false));
els.sampleClose.addEventListener('click', () => (els.sampleModal.hidden = true));
els.sampleModal.addEventListener('click', (e) => {
  if (e.target === els.sampleModal) els.sampleModal.hidden = true;
});

(async () => {
  await loadData();
  races.forEach((r) => (r.zh = zhMap?.[r.image]?.zh ?? null));
  window.__fh6DemoLowConfidence = (records) => {
    els.previewWrap.hidden = true;
    els.results.hidden = false;
    renderCards(matchRecords(records ?? [{ name: null, km: 7.9, laps: 3, status: '报名中', order: 0 }], races, zhMap), 0);
  };
})();
