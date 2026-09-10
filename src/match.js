export function sim(a, b) {
  const s = (x) => (x ?? '').replace(/\s+/g, '');
  const x = s(a);
  const y = s(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const d = lev(x, y);
  return Math.max(0, 1 - d / Math.max(x.length, y.length));
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const NAME_RE = /^[\u4e00-\u9fa5（）()·]{2,16}赛$/;
const CJK_NAME_RE = /^[\u4e00-\u9fa5（）()·]{2,16}$/;
const HEADER_RE = /正在加入|赛事报名|报名中$|乐玩/;
const KM_RE = /(\d{1,2}(?:\.\d)?)\s*[千干辛羊芊午年]?[米毛]/;
const LAPS_RE = /[-·.,，。]\s*(\d)\s*圈$|(\d)\s*圈$/;
const STATUS_RE = /^(进行中|进行|下[-—–－一]?步|报名中|报名|已完成|未完成|未开始|待开始|已结束|已报名|报名即将开始|即将开始|即将结束)$/;
const WEATHER_RE = /^((春|夏|秋|冬)季|夜[晚间]|白[天昼]|清晨|早晨|上午|中午|下午|傍[晚清早]|黄昏|拂晓|黎明|日出|日落|午[夜后]?|深夜|正午|晴朗|睛朗|多云|阴天|阳天|雨天|小雨|大雨|暴雨|阵[雨雨]|雷[阵雨]*|降水|弱降水|强降水|雨后|雪天?|雾天?|干爽|湿热|炎热|严寒|凉爽)$/;
const NOISE_RE = /[a-zA-Z0-9\/：:点季第]|千米$/;

export function classify(box) {
  const t = box.text.replace(/\s+/g, '');
  if (!t) return 'noise';
  if (STATUS_RE.test(t)) return 'status';
  if (WEATHER_RE.test(t)) return 'noise';
  if (HEADER_RE.test(t)) return 'noise';
  const km = t.match(KM_RE);
  if (km) {
    const laps = t.match(LAPS_RE);
    const prefix = t.slice(0, km.index).replace(/[（）()·]/g, '');
    const name =
      (NAME_RE.test(prefix) || CJK_NAME_RE.test(prefix)) && !STATUS_RE.test(prefix) && !HEADER_RE.test(prefix) && !WEATHER_RE.test(prefix)
        ? prefix
        : null;
    return { kind: 'km', km: parseFloat(km[1]), kmDot: km[1].includes('.'), laps: laps ? parseInt(laps[1] ?? laps[2]) : null, name };
  }
  if (NOISE_RE.test(t)) return 'noise';
  if (/^\d{1,2}$/.test(t)) return 'noise';
  if (NAME_RE.test(t)) return { kind: 'name', name: t };
  if (CJK_NAME_RE.test(t)) return { kind: 'name', name: t };
  const m = t.match(/([\u4e00-\u9fa5（）()·]{2,16}赛)([\u4e00-\u9fa5]*)$/);
  if (m) return { kind: 'name', name: m[1] };
  return 'noise';
}

export function parsePanel(boxes, scale = 1) {
  const sorted = [...boxes].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const records = [];
  let cur = null;
  const tol = 90 * scale;
  const close = () => {
    if (cur) records.push(cur);
    cur = null;
  };
  const sameLine = (cy) => Math.abs(cy - (cur.nameCy ?? cur.cy)) < tol;
  for (const box of sorted) {
    const c = classify(box);
    if (c === 'noise') continue;
    if (c === 'status') {
      if (cur && sameLine(box.cy)) cur.status = box.text.replace(/\s+/g, '');
      continue;
    }
    if (c.kind === 'name') {
      if (cur && cur.name == null && sameLine(box.cy)) {
        cur.name = c.name;
        cur.nameCy = box.cy;
      } else {
        close();
        cur = { name: c.name, km: null, laps: null, status: null, cy: box.cy, cx: box.cx, nameCy: box.cy };
      }
    } else if (c.kind === 'km') {
      const sameRowName = c.name != null && cur && cur.name == null && sameLine(box.cy);
      if (c.name != null && !sameRowName) {
        close();
        cur = { name: c.name, km: c.km, kmDot: c.kmDot, laps: c.laps ?? null, status: null, cy: box.cy, cx: box.cx, nameCy: box.cy };
      } else if (cur && sameLine(box.cy)) {
        if (sameRowName) cur.name = c.name;
        cur.km = c.km;
        cur.kmDot = c.kmDot;
        if (c.laps != null) cur.laps = c.laps;
      } else {
        close();
        cur = { name: null, km: c.km, kmDot: c.kmDot, laps: c.laps ?? null, status: null, cy: box.cy, cx: box.cx, nameCy: box.cy };
      }
    }
  }
  close();
  records.forEach((r, i) => (r.order = i));
  return records;
}

export function scoreRace(record, race) {
  const nameScore = sim(record.name, race.zh);
  let kmScore;
  if (race.km == null || record.km == null) kmScore = 0.4;
  else {
    const candidates = record.kmDot || record.km < 10 ? [record.km] : [record.km, record.km / 10];
    kmScore = Math.max(
      ...candidates.map((v) => {
        const diff = Math.abs(v - race.km);
        return diff <= 0.25 ? 1 - diff / 0.25 : diff <= 0.6 ? 0.15 : 0;
      })
    );
  }
  let lapScore;
  if (!record.laps || !race.laps) lapScore = 0.4;
  else lapScore = record.laps === race.laps ? 1 : 0;
  return nameScore * 0.7 + kmScore * 0.2 + lapScore * 0.1;
}

export function matchRecords(records, races, zhMap) {
  const results = records.map((record) => {
    const enriched = races.map((race) => ({ ...race, zh: zhMap?.[race.image]?.zh ?? null }));
    let bestNameScore = 0;
    const scored = enriched
      .map((race) => {
        const ns = sim(record.name, race.zh);
        if (ns > bestNameScore) bestNameScore = ns;
        return { race, score: scoreRace(record, race) };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const ok = best && best.score >= 0.55;
    return { record, race: ok ? best.race : null, score: best?.score ?? 0, bestNameScore, source: 'auto', candidates: scored.slice(0, 6) };
  });
  return results.filter((m) => !(m.record.km == null && m.record.name != null && m.bestNameScore < 0.35));
}
