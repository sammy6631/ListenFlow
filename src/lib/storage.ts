import { ListenDocument, ReaderSettings } from '../types';

const DOCS_KEY = 'listen_ai_documents_v1';
const SETTINGS_KEY = 'listen_ai_settings_v1';

export const DEFAULT_SETTINGS: ReaderSettings = {
  voice: 'en-US-AvaMultilingualNeural',
  engine: 'neural',
  rate: 1.0,
  pitch: 0,
  theme: 'dark',
  font: 'serif',
  fontSize: 19,
  lineHeight: 1.75,
  autoScroll: true,
};

export function loadDocuments(): ListenDocument[] {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Seamlessly rename the built-in Quick Start sample if saved under the old name
    return parsed.map((doc: ListenDocument) => {
      if (doc.title === 'Welcome to Listen AI — Quick Start Guide') {
        return {
          ...doc,
          title: 'Welcome to ListenFlow — Quick Start Guide',
          author: 'ListenFlow',
          paragraphs: doc.paragraphs.map((p) => p.replace(/Listen AI/g, 'ListenFlow')),
        };
      }
      return doc;
    });
  } catch {
    return [];
  }
}

export function saveDocuments(docs: ListenDocument[]): void {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
  } catch {
    // Handle quota exceeded gracefully by keeping most recent docs
    try {
      localStorage.setItem(DOCS_KEY, JSON.stringify(docs.slice(0, 15)));
    } catch {
      // Ignore
    }
  }
}

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore
  }
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
