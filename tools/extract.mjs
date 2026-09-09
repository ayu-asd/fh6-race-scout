import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const htmlPath = join(import.meta.dirname, '..', '..', 'FH6 Races - All Tracks, Types & Locations.html');
const outPath = join(import.meta.dirname, '..', 'public', 'data', 'races.json');

const CATEGORY_ZH = {
  'Street Races': '街头赛',
  'Road Races': '公路赛',
  'Touge Races': '峠道赛',
  'Drag Races': '直线加速赛',
  'Dirt Races': '泥地竞速赛',
  'Cross Country Races': '越野赛',
  'Wristband Events': '腕带赛',
};

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

const stripTags = (s) => decode(s.replace(/<[^>]*>/g, ''));

const html = await readFile(htmlPath, 'utf8');

const groups = html.split('race-group__title');
const races = [];
const categories = new Map();

for (let g = 1; g < groups.length; g++) {
  const seg = groups[g];
  const catMatch = seg.match(/^"[^>]*>([\s\S]*?)<\/h2>/);
  const category = catMatch ? stripTags(catMatch[1]) : 'Unknown';
  const cards = seg.match(/<article class="race-card"[\s\S]*?<\/article>/g) ?? [];
  for (const card of cards) {
    const nameMatch = card.match(/race-card__name[^>]*>([\s\S]*?)<\/h3>/);
    const name = nameMatch ? stripTags(nameMatch[1]) : '';
    const stats = [...card.matchAll(/race-stat[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => stripTags(m[1]));
    const distStr = stats.find((s) => /\d/.test(s) && /(mi|km)/.test(s)) ?? '';
    const mi = /mi/.test(distStr) ? parseFloat(distStr) : null;
    const lapStr = stats.find((s) => /lap/i.test(s)) ?? '';
    const laps = /lap/i.test(lapStr) ? parseInt(lapStr) : 0;
    const series = stats.find((s) => !/\d/.test(s) && s !== name) ?? '';
    const imgMatch = card.match(/Race[A-Za-z0-9-]+(?:Track|Details)\.webp/);
    const image = imgMatch ? imgMatch[0].replace(/(Track|Details)\.webp$/, '') : null;
    races.push({
      name,
      category,
      categoryZh: CATEGORY_ZH[category] ?? category,
      mi,
      km: mi != null ? Math.round(mi * 1.609344 * 10) / 10 : null,
      laps,
      series,
      image,
    });
    const c = categories.get(category) ?? { en: category, zh: CATEGORY_ZH[category] ?? category, count: 0 };
    c.count++;
    categories.set(category, c);
  }
}

const data = { source: 'forza.labsgg.com/all-race-tracks', categories: [...categories.values()], races };
await writeFile(outPath, JSON.stringify(data, null, 2), 'utf8');

console.log(`categories: ${data.categories.map((c) => `${c.zh}=${c.count}`).join(' | ')}`);
console.log(`total races: ${races.length}`);
const missing = races.filter((r) => !r.image || (r.mi == null && !r.laps));
if (missing.length) console.log('WARN missing fields:', JSON.stringify(missing.map((r) => r.name)));
