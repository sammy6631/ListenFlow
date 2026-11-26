import { SourceType, VoiceInfo, WordBoundary } from '../types';

export interface ParsedDocumentResponse {
  title: string;
  author: string;
  sourceType: SourceType;
  sourceUrl?: string;
  paragraphs: string[];
  wordCount: number;
  estimatedMinutes: number;
}

export interface TTSResponse {
  audioBase64: string;
  mimeType: string;
  wordBoundaries: WordBoundary[];
}

async function handleJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchVoices(): Promise<{ voices: VoiceInfo[]; online: boolean }> {
  const res = await fetch('/api/voices');
  return handleJsonResponse<{ voices: VoiceInfo[]; online: boolean }>(res);
}

export async function synthesizeChunk(params: {
  text: string;
  voice: string;
  rate: number;
  pitch: number;
  signal?: AbortSignal;
}): Promise<{ audioUrl: string; wordBoundaries: WordBoundary[] }> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: params.signal,
    body: JSON.stringify({
      text: params.text,
      voice: params.voice,
      rate: params.rate,
      pitch: params.pitch,
    }),
  });
  const data = await handleJsonResponse<TTSResponse>(res);
  const binary = atob(data.audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: data.mimeType || 'audio/mpeg' });
  const audioUrl = URL.createObjectURL(blob);
  return {
    audioUrl,
    wordBoundaries: data.wordBoundaries || [],
  };
}

export async function exportAudioMp3(params: {
  title: string;
  paragraphs: string[];
  voice: string;
  rate: number;
  pitch: number;
}): Promise<void> {
  const res = await fetch('/api/tts/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to export audio');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const safeName = params.title.replace(/[^a-z0-9\-_\s]/gi, '').trim().slice(0, 60) || 'listenflow-audio';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.mp3`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function parseUploadedFile(file: File): Promise<ParsedDocumentResponse> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/parse/file', {
    method: 'POST',
    body: form,
  });
  return handleJsonResponse<ParsedDocumentResponse>(res);
}

export async function parseWebUrl(url: string): Promise<ParsedDocumentResponse> {
  const res = await fetch('/api/parse/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return handleJsonResponse<ParsedDocumentResponse>(res);
}

export async function parseRawText(text: string, title?: string, sourceType: SourceType = 'text'): Promise<ParsedDocumentResponse> {
  const res = await fetch('/api/parse/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, title, sourceType }),
  });
  return handleJsonResponse<ParsedDocumentResponse>(res);
}

export async function fetchSharedDocument(shareId: string): Promise<ParsedDocumentResponse> {
  const res = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
  return handleJsonResponse<ParsedDocumentResponse>(res);
}
