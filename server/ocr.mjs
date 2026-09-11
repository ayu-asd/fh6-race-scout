const SF_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const DEFAULT_MODEL = 'Qwen/Qwen3.5-4B';

export const PROMPT =
  '这是《极限竞速：地平线》的赛事报名列表截图。请只输出列表里的每一场比赛，每行一场，格式：名称|距离千米|圈数。' +
  '名称用截图中的中文原名；距离只写数字（千米）；圈数只写数字。缺失的信息留空。不要输出表头、分类汇总、天气或任何解释文字。';

export async function recognizeRaceList(
  imageDataUri,
  { apiKey = process.env.SILICONFLOW_API_KEY, model = DEFAULT_MODEL, timeoutMs = 20000 } = {}
) {
  if (!apiKey) {
    const e = new Error('服务端未配置 SILICONFLOW_API_KEY');
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
    enable_thinking: false,
    temperature: 0,
    max_tokens: 400,
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
      const res = await fetch(SF_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
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
        e.detail = `SiliconFlow ${res.status}: ${txt.slice(0, 300)}`;
        throw e;
      }
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) {
        const e = new Error('识别结果为空，请重试');
        e.code = 'EMPTY';
        throw e;
      }
      return text;
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error('识别服务超时，请重试');
        e.code = 'TIMEOUT';
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
  for (let attempt = 1; ; attempt++) {
    try {
      return await callOnce();
    } catch (e) {
      if (e.detail) console.warn('[ocr]', e.detail);
      const retriable = ['RATE', 'BUSY', 'EMPTY', 'TIMEOUT', 'UPSTREAM'].includes(e.code) || e.status >= 500;
      const maxAttempts = e.code === 'RATE' ? 2 : 3;
      if (!retriable || attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
}
