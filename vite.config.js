import { defineConfig } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { recognizeRaceList } from './server/ocr.mjs';

// 手动解析 .env：不能用 vite 的 loadEnv(mode, cwd, '')——prefix='' 时它会把
// process.env 合并进返回值且 process.env 优先，机器残留的旧 key 会盖过 .env
function readDotEnv() {
  const file = join(process.cwd(), '.env');
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

function ocrApiDev() {
  const middleware = (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: '仅支持 POST' }));
      return;
    }
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 12e6) req.destroy();
    });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const { image } = JSON.parse(data || '{}');
        if (!image) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: '缺少 image 字段' }));
          return;
        }
        const { text, label } = await recognizeRaceList(image);
        res.statusCode = 200;
        res.end(JSON.stringify({ text, provider: label }));
      } catch (e) {
        res.statusCode = e.code === 'NO_KEY' ? 500 : 502;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  };
  return {
    name: 'ocr-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/ocr', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ocr', middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  // 把 .env 里的密钥种进 process.env，让 recognizeRaceList 的兜底开关（查 process.env）
  // 在 dev 下也能看到备用端点的 key，行为与线上一致。.env 强制覆盖机器残留的旧 key
  const dotEnv = readDotEnv();
  for (const k of ['AGNES_CN_API_KEY', 'AGNES_API_KEY', 'SILICONFLOW_API_KEY']) {
    if (dotEnv[k]) process.env[k] = dotEnv[k];
  }
  return {
    base: './',
    server: { host: '127.0.0.1', port: 5173 },
    build: { target: 'es2022' },
    plugins: [ocrApiDev()],
  };
});
