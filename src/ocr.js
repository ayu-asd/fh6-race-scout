import * as paddleOcr from '@paddle-js-models/ocr';

const BASE = import.meta.env.BASE_URL;
let enginePromise = null;
let engineState = 'idle';

export function getEngineState() {
  return engineState;
}

export function loadEngine(onState) {
  if (!enginePromise) {
    engineState = 'loading';
    onState?.('loading');
    enginePromise = paddleOcr
      .init(`${BASE}models/det/model.json`, `${BASE}models/rec/model.json`)
      .then(() => {
        engineState = 'ready';
        onState?.('ready');
      })
      .catch((err) => {
        engineState = 'error';
        enginePromise = null;
        throw err;
      });
  }
  return enginePromise;
}

export async function recognize(img) {
  await loadEngine();
  const res = await paddleOcr.recognize(img);
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
