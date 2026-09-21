// 识别后端（三路并发，谁先成功用谁）：
//   Agnes国区  https://api.agnes-ai.cn/v1/chat/completions       模型 agnes-3.0-flash
//   Agnes国际  https://apihub.agnes-ai.com/v1/chat/completions   模型 agnes-3.0-flash
//   Qwen       https://api.siliconflow.cn/v1/chat/completions    模型 Qwen/Qwen3.5-4B（需关思考）
// 三家同时请求，任一成功立即返回（Promise.any），其余中止；全部失败重试一轮（跳过密钥无效的）。
// 密钥：AGNES_CN_API_KEY（国区）/ AGNES_API_KEY（国际站）/ SILICONFLOW_API_KEY（硅基流动）

const AGNES_CN = {
  url: 'https://api.agnes-ai.cn/v1/chat/completions',
  model: 'agnes-3.0-flash',
  keyEnv: 'AGNES_CN_API_KEY',
  label: 'Agnes国区',
};
const AGNES_INTL = {
  url: 'https://apihub.agnes-ai.com/v1/chat/completions',
  model: 'agnes-3.0-flash',
  keyEnv: 'AGNES_API_KEY',
  label: 'Agnes国际',
};
const QWEN = {
  url: 'https://api.siliconflow.cn/v1/chat/completions',
  model: 'Qwen/Qwen3.5-4B',
  keyEnv: 'SILICONFLOW_API_KEY',
  label: 'Qwen',
  // Qwen 需要关思考，否则 7.6s 且 content 为空
  extra: { enable_thinking: false },
};

const PROVIDERS = { 'agnes-cn': AGNES_CN, agnes: AGNES_INTL, qwen: QWEN };

export const PROMPT =
  '这是《极限竞速：地平线》的赛事报名列表截图。请只输出列表里的每一场比赛，每行一场，格式：名称|距离千米|圈数。' +
  '名称用截图中的中文原名；距离只写数字（千米）；圈数只写数字。缺失的信息留空。不要输出表头、分类汇总、天气或任何解释文字。';

function mapHttpError(cfg, res, txt) {
  const rateLimited = res.status === 429 || /rate limit|TPM limit/i.test(txt);
  const e = new Error(
    rateLimited
      ? '识别服务繁忙（接口限流），请稍等几秒再试'
      : res.status === 401 || res.status === 403
        ? '识别服务不可用（密钥无效或过期）'
        : res.status === 503 || /overloaded/i.test(txt)
          ? '识别服务繁忙，请稍后再试'
          : '识别服务暂时不可用，请稍后再试'
  );
  e.code = rateLimited ? 'RATE' : res.status === 401 || res.status === 403 ? 'AUTH' : res.status === 503 ? 'BUSY' : 'UPSTREAM';
  e.status = res.status;
  e.detail = `${cfg.label} ${res.status}: ${txt.slice(0, 300)}`;
  return e;
}

async function callProvider(name, imageDataUri, { timeoutMs, apiKey, signal }) {
  const cfg = PROVIDERS[name];
  if (!cfg) {
    const e = new Error(`未知的识别服务: ${name}`);
    e.code = 'UNKNOWN_PROVIDER';
    e.provider = name;
    throw e;
  }
  const key = apiKey ?? process.env[cfg.keyEnv];
  if (!key) {
    const e = new Error(`服务端未配置 ${cfg.keyEnv}`);
    e.code = 'NO_KEY';
    e.provider = name;
    throw e;
  }

  const body = {
    model: cfg.model,
    temperature: 0,
    max_tokens: 400,
    ...(cfg.extra ?? {}),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: imageDataUri } },
        ],
      },
    ],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // 外部 signal（race 结束时中止输家）与自身超时合并
  const fetchSignal = signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal;
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: fetchSignal,
    });
    if (!res.ok) throw mapHttpError(cfg, res, await res.text().catch(() => ''));
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) {
      const e = new Error('识别结果为空');
      e.code = 'EMPTY';
      e.provider = name;
      throw e;
    }
    return { text, provider: name, label: cfg.label };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('识别服务超时');
      e.code = 'TIMEOUT';
      e.provider = name;
      throw e;
    }
    if (!err.provider) err.provider = name;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function raceRound(names, imageDataUri, timeoutMs) {
  const loserCtrl = new AbortController();
  try {
    return await Promise.any(names.map((n) => callProvider(n, imageDataUri, { timeoutMs, signal: loserCtrl.signal })));
  } catch (agg) {
    const errors = agg.errors ?? [];
    const withDetail = errors.find((x) => x.detail);
    if (withDetail) console.warn('[ocr]', withDetail.detail);
    const e = new Error('识别服务暂时不可用，请稍后再试');
    e.code = errors.length && errors.every((x) => x.code === 'AUTH' || x.code === 'NO_KEY') ? 'AUTH' : 'ALL_FAILED';
    e.errors = errors;
    throw e;
  } finally {
    // race 结束即中止其余请求（赢家已完成，中止无副作用），省上游额度
    loserCtrl.abort();
  }
}

async function callWithRetry(name, imageDataUri, { timeoutMs, maxAttempts, apiKey }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callProvider(name, imageDataUri, { timeoutMs, apiKey });
    } catch (e) {
      if (e.detail) console.warn('[ocr]', e.detail);
      const retriable = ['RATE', 'BUSY', 'EMPTY', 'TIMEOUT', 'UPSTREAM'].includes(e.code) || e.status >= 500;
      if (!retriable || attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

export async function recognizeRaceList(
  imageDataUri,
  { provider, timeoutMs = 15000, maxAttempts = 1, apiKey } = {}
) {
  if (typeof imageDataUri !== 'string' || !imageDataUri.startsWith('data:image/')) {
    const e = new Error('图片格式不正确');
    e.code = 'BAD_IMAGE';
    throw e;
  }

  // 显式指定 provider（本地检测工具）：只走单家，不参与并发
  if (provider) {
    return await callWithRetry(provider, imageDataUri, { timeoutMs, maxAttempts, apiKey });
  }

  const names = Object.keys(PROVIDERS).filter((n) => process.env[PROVIDERS[n].keyEnv]);
  if (!names.length) {
    const e = new Error('服务端未配置任何识别服务的密钥');
    e.code = 'NO_KEY';
    throw e;
  }

  try {
    return await raceRound(names, imageDataUri, timeoutMs);
  } catch (e) {
    // 密钥问题重试无意义；其余（拥堵/超时）换掉密钥无效的再试一轮
    if (e.code === 'AUTH') throw e;
    const authFailed = new Set((e.errors ?? []).filter((x) => x.code === 'AUTH' || x.code === 'NO_KEY').map((x) => x.provider));
    const remaining = names.filter((n) => !authFailed.has(n));
    if (!remaining.length) throw e;
    await new Promise((r) => setTimeout(r, 800));
    return await raceRound(remaining, imageDataUri, timeoutMs);
  }
}
