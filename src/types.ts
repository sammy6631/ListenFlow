export type SourceType = 'pdf' | 'docx' | 'epub' | 'web' | 'text' | 'markdown' | 'html' | 'ocr';

export interface Bookmark {
  id: string;
  paragraphIndex: number;
  snippet: string;
  note?: string;
  createdAt: number;
}

export interface ListenDocument {
  id: string;
  title: string;
  author: string;
  sourceType: SourceType;
  sourceUrl?: string;
  paragraphs: string[];
  wordCount: number;
  estimatedMinutes: number;
  createdAt: number;
  lastOpenedAt: number;
  currentParagraphIndex: number;
  bookmarks: Bookmark[];
}

export interface VoiceInfo {
  shortName: string;
  friendlyName: string;
  displayName: string;
  locale: string;
  language: string;
  gender: string;
  featured?: boolean;
  engine: 'neural' | 'browser';
}

export interface WordBoundary {
  text: string;
  offsetMs: number;
  durationMs: number;
}

export interface SynthesizedChunk {
  audioUrl: string;
  wordBoundaries: WordBoundary[];
  durationMs?: number;
}

export type ReaderTheme = 'dark' | 'light' | 'sepia';
export type ReaderFont = 'sans' | 'serif' | 'dyslexic';

export interface ReaderSettings {
  voice: string;
  engine: 'neural' | 'browser';
  rate: number; // 0.5 to 3.0
  pitch: number; // -20 to 20 (%)
  theme: ReaderTheme;
  font: ReaderFont;
  fontSize: number; // px
  lineHeight: number;
  autoScroll: boolean;
}
