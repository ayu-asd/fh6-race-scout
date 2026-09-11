import { recognizeRaceList } from '../server/ocr.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST' });
    return;
  }
  const image = req.body?.image;
  if (!image) {
    res.status(400).json({ error: '缺少 image 字段' });
    return;
  }
  try {
    const text = await recognizeRaceList(image);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ text });
  } catch (e) {
    const status = e.code === 'NO_KEY' ? 500 : e.code === 'BAD_IMAGE' ? 400 : 502;
    res.status(status).json({ error: e.message });
  }
}
