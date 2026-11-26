import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  ScanText,
  Sparkles,
  Upload,
  X,
  Bookmark,
  Check,
  Copy,
} from 'lucide-react';
import { ParsedDocumentResponse, parseRawText, parseUploadedFile, parseWebUrl } from '../lib/api';
import { extractTextFromImage } from '../lib/ocr';

export type ImportTab = 'file' | 'url' | 'text' | 'screen';

interface ImportModalProps {
  isOpen: boolean;
  initialTab?: ImportTab;
  onClose: () => void;
  onImported: (doc: ParsedDocumentResponse, autoPlay?: boolean) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  initialTab = 'file',
  onClose,
  onImported,
}) => {
  const [tab, setTab] = useState<ImportTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL tab
  const [urlInput, setUrlInput] = useState('');

  // Text tab
  const [titleInput, setTitleInput] = useState('');
  const [textInput, setTextInput] = useState('');

  // File drag
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // OCR tab
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrStatus, setOcrStatus] = useState<string>('');
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setError(null);
    }
  }, [isOpen, initialTab]);

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
  const bookmarkletHref = `javascript:(()=>{try{const s=window.getSelection().toString().trim();const t=s||(document.querySelector('article,main')?.innerText||document.body.innerText||'').trim();if(!t){alert('No readable text found on this page.');return;}const f=document.createElement('form');f.method='POST';f.action='${appOrigin}/api/share-open';f.target='_blank';f.style.display='none';const add=(k,v)=>{const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;f.appendChild(i);};add('title',document.title||'Web Page');add('sourceUrl',location.href);add('text',t.slice(0,120000));document.body.appendChild(f);f.submit();f.remove();}catch(e){window.open('${appOrigin}/?url='+encodeURIComponent(location.href),'_blank');}})();`;

  // Set javascript: href directly on the DOM node so React 19 does not strip it
  useEffect(() => {
    if (isOpen && tab === 'screen' && bookmarkletRef.current) {
      bookmarkletRef.current.setAttribute('href', bookmarkletHref);
    }
  }, [isOpen, tab, bookmarkletHref]);

  const handleImageOcr = useCallback(
    async (file: File | Blob, label = 'Screenshot OCR') => {
      setLoading(true);
      setError(null);
      setOcrProgress(5);
      setOcrStatus('Loading OCR engine...');
      try {
        const extracted = await extractTextFromImage(file, (pct, status) => {
          setOcrProgress(pct);
          setOcrStatus(status);
        });
        if (!extracted) {
          throw new Error('Could not detect any readable text in that image. Try a clearer crop or higher resolution screenshot.');
        }
        const doc = await parseRawText(extracted, label, 'ocr');
        onImported(doc, true);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'OCR failed');
      } finally {
        setLoading(false);
        setOcrProgress(0);
        setOcrStatus('');
      }
    },
    [onClose, onImported]
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (file.type.startsWith('image/')) {
        setTab('screen');
        await handleImageOcr(file, file.name.replace(/\.[^.]+$/, '') || 'Scanned Image');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const parsed = await parseUploadedFile(file);
        onImported(parsed, true);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read this file.');
      } finally {
        setLoading(false);
      }
    },
    [handleImageOcr, onClose, onImported]
  );

  // Allow pasting an image screenshot directly while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            setTab('screen');
            handleImageOcr(blob, `Screenshot ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [isOpen, handleImageOcr]);

  if (!isOpen) return null;

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseWebUrl(urlInput.trim());
      setUrlInput('');
      onImported(parsed, true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch this webpage.');
    } finally {
      setLoading(false);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseRawText(textInput.trim(), titleInput.trim() || undefined, 'text');
      setTitleInput('');
      setTextInput('');
      onImported(parsed, true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process text.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setTextInput((prev) => (prev ? `${prev}\n\n${clip}` : clip));
    } catch {
      setError('Clipboard access was blocked by the browser. Press Ctrl+V inside the text box instead.');
    }
  };

  const copyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletHref);
      setCopiedBookmarklet(true);
      setTimeout(() => setCopiedBookmarklet(false), 2500);
    } catch {
      setError('Could not copy bookmarklet automatically.');
    }
  };

  const tabs: { id: ImportTab; label: string; icon: React.ReactNode }[] = [
    { id: 'file', label: 'Documents', icon: <Upload className="w-4 h-4" /> },
    { id: 'url', label: 'Website URL', icon: <Globe className="w-4 h-4" /> },
    { id: 'text', label: 'Paste Text', icon: <FileText className="w-4 h-4" /> },
    { id: 'screen', label: 'On-Screen / OCR', icon: <ScanText className="w-4 h-4" /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-3xl bg-[#121521] border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Listen to Anything</h2>
              <p className="text-xs text-slate-400">PDF, Word, ePub, websites, screenshots, or pasted text</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/8 transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 px-6 pt-4 pb-2 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setError(null);
              }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                tab === t.id
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-600/25'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-xl bg-rose-500/15 border border-rose-500/30 px-4 py-3 text-sm text-rose-200 flex items-start justify-between gap-3">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {tab === 'file' && (
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFile(file);
                }}
                onClick={() => !loading && fileInputRef.current?.click()}
                className={`group cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition ${
                  isDragging
                    ? 'border-violet-400 bg-violet-500/15'
                    : 'border-white/15 bg-white/[0.02] hover:border-violet-500/60 hover:bg-violet-500/[0.06]'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.epub,.txt,.md,.markdown,.html,.htm,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = '';
                  }}
                />
                {loading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
                    <p className="text-sm font-medium text-white">Extracting clean text from your document...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-violet-500/15 text-violet-300 flex items-center justify-center group-hover:scale-105 transition">
                      <Upload className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-base font-medium text-white">
                        Drop your file here, or <span className="text-violet-400">browse</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Supports PDF, Word (.docx), ePub eBooks, TXT, Markdown, HTML, and Screenshots
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2 mt-2">
                      {['PDF', 'DOCX', 'EPUB', 'TXT', 'MD', 'HTML', 'PNG/JPG'].map((badge) => (
                        <span
                          key={badge}
                          className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/6 text-slate-300 border border-white/8"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'url' && (
            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Paste any article, blog post, Wikipedia page, or PDF link
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://en.wikipedia.org/wiki/Speech_synthesis"
                    className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    disabled={loading}
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={loading || !urlInput.trim()}
                    className="px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition shadow-lg shadow-violet-600/25"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                    {loading ? 'Extracting...' : 'Listen'}
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.03] border border-white/8 p-4">
                <p className="text-xs font-medium text-slate-300 mb-2">Try an example article:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Wikipedia: Audiobook', url: 'https://en.wikipedia.org/wiki/Audiobook' },
                    { label: 'Wikipedia: Speech Synthesis', url: 'https://en.wikipedia.org/wiki/Speech_synthesis' },
                  ].map((ex) => (
                    <button
                      key={ex.url}
                      type="button"
                      onClick={() => setUrlInput(ex.url)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white/6 hover:bg-violet-500/20 text-slate-300 hover:text-violet-200 transition"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          )}

          {tab === 'text' && (
            <form onSubmit={handleTextSubmit} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="Title (optional)"
                  className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="px-3.5 py-2.5 rounded-xl bg-white/8 hover:bg-white/12 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition"
                >
                  <ClipboardPaste className="w-4 h-4 text-violet-400" />
                  Paste Clipboard
                </button>
              </div>
              <textarea
                rows={7}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type or paste any text, emails, notes, essays, or copied webpage content here..."
                className="w-full rounded-xl bg-white/5 border border-white/10 p-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
                disabled={loading}
                autoFocus
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {textInput.trim() ? `${textInput.trim().split(/\s+/).length} words` : 'Ready for instant narration'}
                </span>
                <button
                  type="submit"
                  disabled={loading || !textInput.trim()}
                  className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition shadow-lg shadow-violet-600/25"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Start Listening
                </button>
              </div>
            </form>
          )}

          {tab === 'screen' && (
            <div className="space-y-4">
              {/* Tool 1: Live Website Bookmarklet */}
              <div className="rounded-2xl bg-gradient-to-br from-violet-500/12 to-cyan-500/8 border border-violet-500/25 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Bookmark className="w-4 h-4 text-violet-400" />
                      1-Click &ldquo;Read Any Website On Screen&rdquo; Bookmarklet
                    </h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      Drag the purple button below to your browser&apos;s bookmarks bar. Whenever you&apos;re reading
                      any webpage (even behind a login!), click it to read your highlighted text or the full article aloud.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <a
                    ref={bookmarkletRef}
                    onClick={(e) => {
                      e.preventDefault();
                      copyBookmarklet();
                    }}
                    draggable
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/30 cursor-grab active:cursor-grabbing"
                    title="Drag this button to your bookmarks bar!"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Listen with ListenFlow
                  </a>
                  <button
                    type="button"
                    onClick={copyBookmarklet}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-slate-200 text-xs font-medium transition"
                  >
                    {copiedBookmarklet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedBookmarklet ? 'Copied Bookmarklet Code!' : 'Copy Code'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Tip: If dragging is tricky, click <strong className="text-slate-300">Copy Code</strong>, right-click your Chrome bookmarks bar → <strong className="text-slate-300">Add page…</strong>, name it <strong className="text-slate-300">ListenFlow</strong>, and paste into the <strong className="text-slate-300">URL</strong> box.
                </p>
              </div>

              {/* Tool 2: Screenshot / Image OCR */}
              <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-cyan-400" />
                      Read Text from a Screenshot or Photo (OCR)
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Take a screenshot (<kbd className="px-1.5 py-0.5 rounded bg-white/10 text-slate-200">Win+Shift+S</kbd>) and press{' '}
                      <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-slate-200">Ctrl+V</kbd> anywhere, or upload an image.
                    </p>
                  </div>
                </div>

                {loading ? (
                  <div className="space-y-2 py-2">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                        {ocrStatus || 'Scanning text...'}
                      </span>
                      <span>{ocrProgress}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-200"
                        style={{ width: `${Math.max(8, ocrProgress)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageOcr(file, file.name.replace(/\.[^.]+$/, ''));
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="px-4 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-white text-xs font-medium flex items-center gap-2 transition"
                    >
                      <ImageIcon className="w-4 h-4 text-cyan-400" />
                      Choose Screenshot / Photo
                    </button>
                    <span className="text-xs text-slate-500">or press Ctrl+V right now</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
