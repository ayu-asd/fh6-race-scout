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
