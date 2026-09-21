// 直连 Agnes 国际站 /v1/models（只读端点，轻量），量 N 次延迟分布
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const key = (env.match(/^AGNES_API_KEY=(\S+)/m) || [])[1];
if (!key) {
  console.log('未找到 AGNES_API_KEY');
  process.exit(1);
}

const N = 10;
const ts = [];
for (let i = 0; i < N; i++) {
  const t = Date.now();
  const r = await fetch('https://apihub.agnes-ai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const ms = Date.now() - t;
  ts.push({ i: i + 1, ms, status: r.status });
}
const ok = ts.filter((x) => x.status === 200).map((x) => x.ms).sort((a, b) => a - b);
ts.forEach((x) => console.log(`#${String(x.i).padStart(2)}  HTTP ${x.status}  ${x.ms}ms`));
if (ok.length) {
  console.log(`\n中位 ${ok[Math.floor(ok.length / 2)]}ms · 最快 ${ok[0]}ms · 最慢 ${ok[ok.length - 1]}ms`);
} else {
  console.log('\n全部失败');
}
process.exit(0);
