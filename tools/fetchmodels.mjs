import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MODELS = [
  {
    dir: 'det',
    json: 'https://js-models.bj.bcebos.com/PaddleOCR/PP-OCRv3/ch_PP-OCRv3_det_infer_js_960/model.json',
  },
  {
    dir: 'rec',
    json: 'https://js-models.bj.bcebos.com/PaddleOCR/PP-OCRv3/ch_PP-OCRv3_rec_infer_js/model.json',
  },
  {
    dir: 'det_v2',
    json: 'https://paddlejs.bj.bcebos.com/models/ocr_v2_det_new/model.json',
  },
  {
    dir: 'rec_v2',
    json: 'https://paddlejs.bj.bcebos.com/models/ocr_v2_rec_320/model.json',
  },
];

const root = join(import.meta.dirname, '..', 'public', 'models');

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

for (const m of MODELS) {
  const dir = join(root, m.dir);
  await mkdir(dir, { recursive: true });
  const jsonPath = join(dir, 'model.json');
  const jsonLen = await download(m.json, jsonPath);
  const json = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(jsonPath, 'utf8')));
  console.log(`[ok] ${m.dir}/model.json  ${(jsonLen / 1024).toFixed(0)} KB  chunkNum=${json.chunkNum}`);
  for (let i = 1; i <= json.chunkNum; i++) {
    const chunkUrl = m.json.replace(/model\.json$/, `chunk_${i}.dat`);
    const len = await download(chunkUrl, join(dir, `chunk_${i}.dat`));
    console.log(`[ok] ${m.dir}/chunk_${i}.dat  ${(len / 1024 / 1024).toFixed(1)} MB`);
  }
}
console.log('all models downloaded ->', root);
