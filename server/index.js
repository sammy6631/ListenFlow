import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDocumentPayload, parseUploadedFile, parseWebUrl, textToParagraphs } from './parsers.js';
import { getNeuralVoices, synthesizeSpeech, synthesizeFullMp3 } from './tts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json({ limit: '15mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// Ephemeral in-memory store for Bookmarklet / Share payloads (TTL 30 minutes)
const shareStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of shareStore.entries()) {
    if (now - item.createdAt > 30 * 60 * 1000) {
      shareStore.delete(id);
    }
  }
}, 5 * 60 * 1000);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'listenflow', timestamp: Date.now() });
});

app.get('/api/voices', async (_req, res) => {
  try {
    const result = await getNeuralVoices();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load voices' });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice, rate, pitch } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text is required.' });
    }
    const result = await synthesizeSpeech({
      text: text.trim().slice(0, 4000),
      voice: typeof voice === 'string' && voice ? voice : 'en-US-AvaMultilingualNeural',
      rate: typeof rate === 'number' ? rate : 1.0,
      pitch: typeof pitch === 'number' ? pitch : 0,
    });
    res.json(result);
  } catch (err) {
    console.error('[TTS error]', err);
    res.status(502).json({ error: err.message || 'Neural TTS synthesis failed.' });
  }
});

app.post('/api/tts/export', async (req, res) => {
  try {
    const { paragraphs, voice, rate, pitch, title } = req.body || {};
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'No paragraphs provided for export.' });
    }
    const mp3Buffer = await synthesizeFullMp3({
      paragraphs: paragraphs.slice(0, 150),
      voice: typeof voice === 'string' && voice ? voice : 'en-US-AvaMultilingualNeural',
      rate: typeof rate === 'number' ? rate : 1.0,
      pitch: typeof pitch === 'number' ? pitch : 0,
    });
    const safeName =
      String(title || 'listenflow-audio')
        .replace(/[^a-z0-9\-_\s]/gi, '')
        .trim()
        .slice(0, 60) || 'listenflow-audio';
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp3"`);
    res.send(mp3Buffer);
  } catch (err) {
    console.error('[TTS Export error]', err);
    res.status(500).json({ error: err.message || 'Audio export failed.' });
  }
});

app.post('/api/parse/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const doc = await parseUploadedFile(req.file);
    if (!doc.paragraphs.length) {
      return res.status(400).json({ error: 'No readable text found in the uploaded file.' });
    }
    res.json(doc);
  } catch (err) {
    console.error('[Parse File error]', err);
    res.status(400).json({ error: err.message || 'Failed to parse document.' });
  }
});

app.post('/api/parse/url', async (req, res) => {
  try {
    const { url } = req.body || {};
    const doc = await parseWebUrl(url);
    res.json(doc);
  } catch (err) {
    console.error('[Parse URL error]', err);
    res.status(400).json({ error: err.message || 'Failed to extract webpage.' });
  }
});

app.post('/api/parse/text', (req, res) => {
  try {
    const { text, title, sourceType = 'text', sourceUrl = '' } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Please provide some text to read.' });
    }
    const paragraphs = textToParagraphs(text);
    if (!paragraphs.length) {
      return res.status(400).json({ error: 'No readable text found.' });
    }
    const inferredTitle =
      (title && String(title).trim()) ||
      paragraphs[0].split(/[.!?\n]/)[0].slice(0, 64).trim() ||
      'Pasted Text';
    const doc = buildDocumentPayload({
      title: inferredTitle,
      sourceType,
      sourceUrl,
      paragraphs,
    });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to process text.' });
  }
});

// Bookmarklet endpoint: accepts live page text from any site and returns a short-lived ID
app.post('/api/share', (req, res) => {
  try {
    const { title, text, sourceUrl = '', sourceType = 'web' } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'No text provided.' });
    }
    const paragraphs = textToParagraphs(text);
    if (!paragraphs.length) {
      return res.status(400).json({ error: 'No readable text found.' });
    }
    const doc = buildDocumentPayload({
      title: title || 'Web Page',
      sourceType,
      sourceUrl,
      paragraphs,
    });
    const id = crypto.randomBytes(6).toString('hex');
    shareStore.set(id, { doc, createdAt: Date.now() });
    res.json({ id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to store shared text.' });
  }
});

app.get('/api/share/:id', (req, res) => {
  const entry = shareStore.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: 'Shared text expired or not found.' });
  }
  res.json(entry.doc);
});

// Serve built React PWA in production
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🎧 ListenFlow server running at http://localhost:${PORT}\n`);
});
