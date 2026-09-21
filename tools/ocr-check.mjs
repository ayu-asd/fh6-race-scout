import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recognizeRaceList } from '../server/ocr.mjs';

const envDir = join(import.meta.dirname, '..');
const env = readFileSync(join(envDir, '.env'), 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^"|"$/g, '');

const b64 = readFileSync(join(envDir, 'test', 'fixtures', 'case05.webp')).toString('base64');
const dataUri = `data:image/webp;base64,${b64}`;

let fails = 0;
for (const p of ['agnes-cn', 'agnes', 'qwen']) {
  const keyMap = { 'agnes-cn': 'AGNES_CN_API_KEY', agnes: 'AGNES_API_KEY', qwen: 'SILICONFLOW_API_KEY' };
  const opt = { provider: p, apiKey: g(keyMap[p]) };
  const t = Date.now();
  try {
    const { text } = await recognizeRaceList(dataUri, opt);
    console.log(`${p}: PASS ${Date.now() - t}ms | ${text.replace(/\n/g, ' / ').slice(0, 80)}`);
  } catch (e) {
    fails++;
    console.log(`${p}: FAIL ${Date.now() - t}ms ${e.code} ${e.message}`);
  }
}
process.exit(fails >= 2 ? 1 : 0);
