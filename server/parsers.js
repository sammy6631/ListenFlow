import { createRequire } from 'node:module';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import mammoth from 'mammoth';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const MAX_CHUNK_CHARS = 850;

/**
 * Splits a single long paragraph along sentence boundaries so TTS chunks
 * synthesize fast and highlight cleanly.
 */
function splitLongParagraph(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const sentences = text.match(/[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g) || [text];
  const chunks = [];
  let current = '';

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    if ((current + ' ' + sentence).trim().length <= MAX_CHUNK_CHARS) {
      current = current ? `${current} ${sentence}` : sentence;
    } else {
      if (current) chunks.push(current);
      if (sentence.length > MAX_CHUNK_CHARS) {
        // Fallback hard split on spaces
        const words = sentence.split(/\s+/);
        let piece = '';
        for (const w of words) {
          if ((piece + ' ' + w).trim().length > MAX_CHUNK_CHARS && piece) {
            chunks.push(piece);
            piece = w;
          } else {
            piece = piece ? `${piece} ${w}` : w;
          }
        }
        current = piece;
      } else {
        current = sentence;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Normalizes raw paragraphs into clean, natural-sounding chunks.
 */
export function normalizeParagraphs(rawParagraphs) {
  const result = [];
  for (const p of rawParagraphs) {
    const cleaned = String(p || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;
    // Skip pure page numbers or decorative dividers
    if (/^[-_=*~•·—–\d\s]{1,6}$/.test(cleaned) && !/[a-zA-Z0-9]{2,}/.test(cleaned)) continue;
    result.push(...splitLongParagraph(cleaned));
  }
  return result;
}

export function cleanMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, (block) => {
      const inner = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
      return inner ? `\nCode snippet:\n${inner}\n` : '';
    })
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '\n');
}

export function textToParagraphs(rawText) {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Split on double newlines first
  const blocks = normalized.split(/\n{2,}/);
  const paragraphs = [];
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;

    // Join wrapped lines gracefully (especially common in PDFs)
    let current = '';
    for (const line of lines) {
      if (!current) {
        current = line;
      } else if (current.endsWith('-') && /^[a-z]/.test(line)) {
        // De-hyphenate wrapped word
        current = current.slice(0, -1) + line;
      } else if (/[.!?:;"'”’)]$/.test(current) && current.length < 75 && /^[A-Z0-9]/.test(line)) {
        // Likely a heading or bullet followed by new sentence
        paragraphs.push(current);
        current = line;
      } else {
        current = `${current} ${line}`;
      }
    }
    if (current) paragraphs.push(current);
  }
  return normalizeParagraphs(paragraphs);
}

export function buildDocumentPayload({ title, author = '', sourceType, sourceUrl = '', paragraphs }) {
  const cleanParagraphs = normalizeParagraphs(paragraphs);
  const wordCount = cleanParagraphs.reduce(
    (acc, p) => acc + p.split(/\s+/).filter(Boolean).length,
    0
  );
  const estimatedMinutes = Math.max(1, Math.round(wordCount / 160));
  return {
    title: (title || 'Untitled Document').trim().slice(0, 200),
    author: (author || '').trim().slice(0, 120),
    sourceType,
    sourceUrl,
    paragraphs: cleanParagraphs,
    wordCount,
    estimatedMinutes,
  };
}

function extractParagraphsFromHtml(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, footer, header, aside, iframe, form, button').remove();
  const blocks = [];
  $('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre').each((_, el) => {
    const $el = $(el);
    // Avoid duplicating nested p inside blockquote/li
    if ($el.find('p, li, h1, h2, h3, h4').length > 0) return;
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (text.length > 0) blocks.push(text);
  });
  if (blocks.length === 0) {
    const bodyText = $('body').text();
    return textToParagraphs(bodyText);
  }
  return normalizeParagraphs(blocks);
}

async function parseEpub(buffer, fallbackTitle) {
  const zip = new AdmZip(buffer);
  const containerEntry = zip.getEntry('META-INF/container.xml');
  if (!containerEntry) {
    throw new Error('Invalid EPUB file: missing META-INF/container.xml');
  }
  const containerXml = containerEntry.getData().toString('utf8');
  const $container = cheerio.load(containerXml, { xmlMode: true });
  const rootfilePath = $container('rootfile').attr('full-path');
  if (!rootfilePath) {
    throw new Error('Invalid EPUB file: missing rootfile path');
  }
  const opfEntry = zip.getEntry(rootfilePath);
  if (!opfEntry) {
    throw new Error('Invalid EPUB file: OPF package not found');
  }
  const opfDir = path.posix.dirname(rootfilePath);
  const opfXml = opfEntry.getData().toString('utf8');
  const $opf = cheerio.load(opfXml, { xmlMode: true });

  const title =
    $opf('dc\\:title, title').first().text().trim() || fallbackTitle;
  const author = $opf('dc\\:creator, creator').first().text().trim() || '';

  const manifest = new Map();
  $opf('manifest item').each((_, el) => {
    const id = $opf(el).attr('id');
    const href = $opf(el).attr('href');
    if (id && href) manifest.set(id, decodeURIComponent(href));
  });

  const spineIds = [];
  $opf('spine itemref').each((_, el) => {
    const idref = $opf(el).attr('idref');
    if (idref) spineIds.push(idref);
  });

  const allParagraphs = [];
  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href) continue;
    const fullPath = opfDir === '.' ? href : path.posix.join(opfDir, href);
    const entry = zip.getEntry(fullPath) || zip.getEntry(decodeURI(fullPath));
    if (!entry) continue;
    const html = entry.getData().toString('utf8');
    const paras = extractParagraphsFromHtml(html);
    allParagraphs.push(...paras);
  }

  return buildDocumentPayload({
    title,
    author,
    sourceType: 'epub',
    paragraphs: allParagraphs,
  });
}

export async function parseUploadedFile(file) {
  const originalName = file.originalname || 'document';
  const ext = path.extname(originalName).toLowerCase();
  const baseTitle = path.basename(originalName, ext).replace(/[_-]+/g, ' ').trim();

  if (ext === '.pdf' || file.mimetype === 'application/pdf') {
    const parsed = await pdfParse(file.buffer);
    const title = parsed.info?.Title?.trim() || baseTitle;
    const author = parsed.info?.Author?.trim() || '';
    const paragraphs = textToParagraphs(parsed.text || '');
    if (paragraphs.length === 0) {
      throw new Error(
        'No selectable text was found in this PDF (it may be a scanned image). Try taking a screenshot and using the On-Screen OCR tab!'
      );
    }
    return buildDocumentPayload({ title, author, sourceType: 'pdf', paragraphs });
  }

  if (
    ext === '.docx' ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const { value: html } = await mammoth.convertToHtml({ buffer: file.buffer });
    const paragraphs = extractParagraphsFromHtml(html);
    if (paragraphs.length === 0) {
      const { value: raw } = await mammoth.extractRawText({ buffer: file.buffer });
      return buildDocumentPayload({
        title: baseTitle,
        sourceType: 'docx',
        paragraphs: textToParagraphs(raw || ''),
      });
    }
    return buildDocumentPayload({ title: baseTitle, sourceType: 'docx', paragraphs });
  }

  if (ext === '.epub' || file.mimetype === 'application/epub+zip') {
    return parseEpub(file.buffer, baseTitle);
  }

  if (ext === '.html' || ext === '.htm' || file.mimetype === 'text/html') {
    const html = file.buffer.toString('utf8');
    const dom = new JSDOM(html);
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const paragraphs = article?.content
      ? extractParagraphsFromHtml(article.content)
      : extractParagraphsFromHtml(html);
    return buildDocumentPayload({
      title: article?.title || baseTitle,
      author: article?.byline || '',
      sourceType: 'html',
      paragraphs,
    });
  }

  if (ext === '.md' || ext === '.markdown') {
    const raw = file.buffer.toString('utf8');
    const cleaned = cleanMarkdown(raw);
    const headingMatch = raw.match(/^#\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : baseTitle;
    return buildDocumentPayload({
      title,
      sourceType: 'markdown',
      paragraphs: textToParagraphs(cleaned),
    });
  }

  // Fallback plain text (.txt, .csv, .log, .json, .rtf, etc.)
  const raw = file.buffer.toString('utf8');
  return buildDocumentPayload({
    title: baseTitle,
    sourceType: 'text',
    paragraphs: textToParagraphs(raw),
  });
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith('169.254.')
  ) {
    return true;
  }
  return false;
}

export async function parseWebUrl(rawUrl) {
  let normalizedUrl = String(rawUrl || '').trim();
  if (!normalizedUrl) throw new Error('Please enter a website URL.');
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error('Invalid website URL. Please check the address and try again.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  if (isBlockedHost(parsedUrl.hostname)) {
    throw new Error('Local or private network URLs cannot be fetched by the URL reader.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Timed out waiting for the website to respond.');
    }
    throw new Error(`Could not reach website: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `Website returned HTTP ${response.status}. Some sites block direct fetching — try using the On-Screen Bookmarklet or Copy & Paste!`
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) {
    const arrayBuffer = await response.arrayBuffer();
    const fakeFile = {
      originalname: path.basename(parsedUrl.pathname) || 'document.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from(arrayBuffer),
    };
    const doc = await parseUploadedFile(fakeFile);
    return { ...doc, sourceUrl: parsedUrl.toString() };
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url: parsedUrl.toString() });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  let paragraphs = [];
  if (article?.content) {
    paragraphs = extractParagraphsFromHtml(article.content);
  }
  if (paragraphs.length === 0) {
    paragraphs = extractParagraphsFromHtml(html);
  }
  if (paragraphs.length === 0) {
    throw new Error(
      'Could not extract readable text from this page (it may require login or heavy JavaScript). Use the On-Screen Bookmarklet on the live page instead!'
    );
  }

  const title =
    article?.title?.trim() ||
    dom.window.document.title?.trim() ||
    parsedUrl.hostname;
  const author = [article?.byline, article?.siteName].filter(Boolean).join(' · ');

  return buildDocumentPayload({
    title,
    author,
    sourceType: 'web',
    sourceUrl: parsedUrl.toString(),
    paragraphs,
  });
}
