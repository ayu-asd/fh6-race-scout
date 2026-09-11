import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'test', 'fixtures');

const CASES = [
  { img: 'case01.webp', src: '1.png', expect: ['东京码头冲锋赛', '北部上坡赛', '北伊根'] },
  { img: 'case02.webp', src: '2.png', expect: ['立山高山越野赛', '新宿御苑越野赛', '高城越野赛'] },
  { img: 'case03.webp', src: '3.png', expect: ['奈良井宿环道赛', '曾尔环道赛', '霜山环道赛'] },
  { img: 'case04.webp', src: '5.png', expect: ['地平线攀爬赛', '传奇岛径道赛', '北部径道赛'] },
  { img: 'case05.webp', src: '6.png', expect: ['高城径道赛', '瀑布径道赛', '向日葵攀爬赛'] },
  { img: 'case06.webp', src: '7.png', expect: ['樱桃园径道赛', '石部攀爬赛', '鲷鱼烧攀爬赛'] },
  { img: 'case07.webp', src: '8.png', expect: ['南岸越野环道赛', '曾尔高地越野赛', '琉璃光寺越野赛'] },
  { img: 'case08.webp', src: '12.png', expect: ['亲不知径道赛', '金阁寺径道赛', '糠平径道赛'] },
  { img: 'case09.webp', src: 'new_3.png', expect: ['彩虹桥下坡赛', '河流下坡赛', '向日葵冲锋赛'] },
  { img: 'case10.webp', src: 'new_8.png', expect: ['白川环道赛', '色川环道赛', '霜山冲刺赛'] },
];

const baseArg = process.argv.find((a) => a.startsWith('--base='));
const BASE = baseArg ? baseArg.slice('--base='.length) : process.env.E2E_BASE || 'http://127.0.0.1:5173';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
const browser = await chromium.launch({
  headless: true,
  executablePath,
  channel: executablePath ? undefined : 'chrome',
  args: ['--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(BASE);

const status = () => page.evaluate(() => document.getElementById('engine-status')?.textContent || '');
await page.waitForFunction(() => /就绪|失败/.test(document.getElementById('engine-status')?.textContent || ''), null, { timeout: 120000 });
if (!/就绪/.test(await status())) {
  console.error(`引擎未就绪（${BASE}）：${await status()}`);
  process.exit(1);
}
console.log(`base: ${BASE}  fixtures: ${CASES.length}`);

let pass = 0;
const failed = [];
for (const c of CASES) {
  const prev = await page.evaluate(() => document.querySelector('.warn-note')?.textContent || '');
  await page.setInputFiles('input[type=file]', join(FIXTURES, c.img));
  try {
    await page.waitForFunction(
      (p) => {
        const n = document.querySelector('.warn-note');
        return n && /场/.test(n.textContent) && n.textContent !== p;
      },
      prev,
      { timeout: 60000 }
    );
  } catch {
    failed.push(c.img);
    console.log(`FAIL ${c.img} (${c.src}) 超时`);
    continue;
  }
  const out = await page.evaluate(() => ({
    note: document.querySelector('.warn-note')?.textContent || '',
    cards: [...document.querySelectorAll('.card')].map((el) => el.querySelector('.card-name')?.textContent || '(候选)'),
  }));
  const want = [...c.expect].sort();
  const got = [...out.cards].sort();
  const ok = want.length === got.length && want.every((x, i) => x === got[i]);
  if (ok) pass++;
  else failed.push(c.img);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.img} (${c.src})  ${out.note}`);
  console.log(`     got : ${out.cards.join(' | ')}`);
  if (!ok) console.log(`     want: ${c.expect.join(' | ')}`);
  await page.evaluate(() => document.getElementById('reset-btn')?.click());
  await page.waitForTimeout(200);
}
await browser.close();
console.log(`\n${pass}/${CASES.length} passed${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
