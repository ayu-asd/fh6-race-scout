import * as paddleOcr from '@paddle-js-models/ocr';

const BASE = import.meta.env.BASE_URL;
let enginePromise = null;
let engineState = 'idle';

export function getEngineState() {
  return engineState;
}

let failCurrentInit = null;

export function failEngineNow() {
  failCurrentInit?.(new Error('webgl 上下文丢失'));
}

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

export function loadEngine(onState) {
  if (enginePromise) return enginePromise;
  engineState = 'loading';
  onState?.('loading');
  enginePromise = (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await new Promise((res, rej) => {
          failCurrentInit = rej;
          withTimeout(paddleOcr.init(`${BASE}models/det/model.json`, `${BASE}models/rec/model.json`), 60000, '模型初始化超时').then(res, rej);
        });
        failCurrentInit = null;
        engineState = 'ready';
        onState?.('ready');
        return;
      } catch (err) {
        failCurrentInit = null;
        if (attempt >= 3) {
          engineState = 'error';
          enginePromise = null;
          throw err;
        }
        console.warn(`模型初始化失败（第 ${attempt} 次），正在重试…`, err);
        await new Promise((r) => setTimeout(r, 1200 * attempt));
      }
    }
  })();
  return enginePromise;
}

export async function recognize(img) {
  await loadEngine();
  let res;
  try {
    res = await withTimeout(paddleOcr.recognize(img), 45000, 'OCR 超时（可能 WebGL 上下文丢失）');
  } catch (err) {
    enginePromise = null;
    if (engineState === 'ready') engineState = 'error';
    throw err;
  }
  const text = res?.text ?? [];
  const points = res?.points ?? [];
  const boxes = [];
  for (let i = 0; i < text.length; i++) {
    const pts = points[i];
    if (!pts || pts.length < 4) continue;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x1 = Math.min(...xs);
    const x2 = Math.max(...xs);
    const y1 = Math.min(...ys);
    const y2 = Math.max(...ys);
    boxes.push({ text: text[i] ?? '', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 });
  }
  return boxes;
}
