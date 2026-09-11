import { defineConfig, loadEnv } from 'vite';
import { recognizeViaAgnes } from './server/agnes.mjs';

function agnesApiDev(apiKey) {
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
        const text = await recognizeViaAgnes(image, { apiKey });
        res.statusCode = 200;
        res.end(JSON.stringify({ text }));
      } catch (e) {
        res.statusCode = e.code === 'NO_KEY' ? 500 : 502;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  };
  return {
    name: 'agnes-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/ocr', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ocr', middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.AGNES_API_KEY || process.env.AGNES_API_KEY;
  return {
    base: './',
    server: { host: '127.0.0.1', port: 5173 },
    build: { target: 'es2022' },
    plugins: [agnesApiDev(apiKey)],
  };
});
