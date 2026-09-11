const AGNES_URL = 'https://api.agnes-ai.cn/v1/chat/completions';
const DEFAULT_MODEL = 'agnes-2.5-flash';

export const PROMPT =
  '这是《极限竞速：地平线》的赛事报名列表截图。请只输出列表里的每一场比赛，每行一场，格式：名称|距离千米|圈数。' +
  '名称用截图中的中文原名；距离只写数字（千米）；圈数只写数字。缺失的信息留空。不要输出表头、分类汇总、天气或任何解释文字。';

export async function recognizeViaAgnes(
  imageDataUri,
  { apiKey = process.env.AGNES_API_KEY, model = DEFAULT_MODEL, timeoutMs = 25000 } = {}
) {
  if (!apiKey) {
    const e = new Error('服务端未配置 AGNES_API_KEY');
    e.code = 'NO_KEY';
    throw e;
  }
  if (typeof imageDataUri !== 'string' || !imageDataUri.startsWith('data:image/')) {
    const e = new Error('图片格式不正确');
    e.code = 'BAD_IMAGE';
    throw e;
  }
  const body = {
    model,
    temperature: 0,
    max_tokens: 800,
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
  const callOnce = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(AGNES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        const e = new Error(res.status === 429 ? '请求过于频繁（接口限流），请稍候几秒再试' : `Agnes ${res.status}: ${txt.slice(0, 200)}`);
        e.code = res.status === 429 ? 'RATE' : 'UPSTREAM';
        e.status = res.status;
        throw e;
      }
      const json = await res.json();
      return json?.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  };
  for (let attempt = 1; ; attempt++) {
    try {
      return await callOnce();
    } catch (e) {
      const retriable = e.code === 'RATE' || e.status >= 500 || e.name === 'AbortError';
      if (!retriable || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
