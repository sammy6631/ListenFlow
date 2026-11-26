import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  FileText,
  Globe,
  Headphones,
  Menu,
  Plus,
  ScanText,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
  AlertCircle,
} from 'lucide-react';
import { Bookmark, ListenDocument, ReaderSettings, SourceType, VoiceInfo } from './types';
import {
  createId,
  loadDocuments,
  loadSettings,
  saveDocuments,
  saveSettings,
} from './lib/storage';
import { SAMPLE_DOCUMENTS } from './lib/samples';
import {
  exportAudioMp3,
  fetchSharedDocument,
  fetchVoices,
  ParsedDocumentResponse,
  parseRawText,
  parseUploadedFile,
  parseWebUrl,
} from './lib/api';
import { extractTextFromImage } from './lib/ocr';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { ImportModal, ImportTab } from './components/ImportModal';
import { VoiceDrawer } from './components/VoiceDrawer';
import { ReaderView } from './components/ReaderView';
import { PlayerBar } from './components/PlayerBar';

const SOURCE_BADGE_COLORS: Record<SourceType, string> = {
  pdf: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  docx: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  epub: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  web: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
  ocr: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  markdown: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  html: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  text: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
};

function getBrowserVoices(): VoiceInfo[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const raw = window.speechSynthesis.getVoices();
  return raw.map((v) => {
    const langCode = (v.lang || 'en-US').split('-')[0].toLowerCase();
    let language = v.lang || 'Unknown';
    try {
      const dn = new Intl.DisplayNames(['en'], { type: 'language' });
      language = dn.of(langCode) || v.lang;
    } catch {
      // keep fallback
    }
    return {
      shortName: v.name,
      friendlyName: v.name,
      displayName: v.name.replace(/Microsoft |Google |Apple /g, ''),
      locale: v.lang || 'en-US',
      language,
      gender: '',
      engine: 'browser' as const,
    };
  });
}

export default function App() {
  const [documents, setDocuments] = useState<ListenDocument[]>(() => {
    const saved = loadDocuments();
    if (saved.length > 0) return saved;
    const now = Date.now();
    return SAMPLE_DOCUMENTS.map((s, idx) => ({
      ...s,
      id: createId(),
      createdAt: now - idx * 60000,
      lastOpenedAt: now - idx * 60000,
    }));
  });

  const [activeDocId, setActiveDocId] = useState<string | null>(() => {
    const saved = loadDocuments();
    return saved[0]?.id || null;
  });

  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings());
  const [neuralVoices, setNeuralVoices] = useState<VoiceInfo[]>([]);
  const [neuralOnline, setNeuralOnline] = useState(true);
  const [browserVoices, setBrowserVoices] = useState<VoiceInfo[]>(() => getBrowserVoices());

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importModalTab, setImportModalTab] = useState<ImportTab>('file');
  const [voiceDrawerOpen, setVoiceDrawerOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Select first sample doc if nothing selected on initial load
  useEffect(() => {
    if (!activeDocId && documents.length > 0) {
      setActiveDocId(documents[0].id);
    }
  }, [activeDocId, documents]);

  // Persist documents & settings
  useEffect(() => {
    saveDocuments(documents);
  }, [documents]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Load neural voices + browser voices
  useEffect(() => {
    fetchVoices()
      .then((res) => {
        setNeuralVoices(res.voices || []);
        setNeuralOnline(res.online);
      })
      .catch(() => {
        setNeuralOnline(false);
      });

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const updateBrowser = () => setBrowserVoices(getBrowserVoices());
      updateBrowser();
      window.speechSynthesis.onvoiceschanged = updateBrowser;
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId) || null,
    [documents, activeDocId]
  );

  const handleUpdateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleProgressChange = useCallback((docId: string, paragraphIndex: number) => {
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === docId ? { ...d, currentParagraphIndex: paragraphIndex, lastOpenedAt: Date.now() } : d
      )
    );
  }, []);

  const player = useAudioPlayer(activeDoc, settings, handleProgressChange);

  const addImportedDocument = useCallback(
    (parsed: ParsedDocumentResponse, autoPlay = false) => {
      const now = Date.now();
      const newDoc: ListenDocument = {
        id: createId(),
        title: parsed.title,
        author: parsed.author,
        sourceType: parsed.sourceType,
        sourceUrl: parsed.sourceUrl,
        paragraphs: parsed.paragraphs,
        wordCount: parsed.wordCount,
        estimatedMinutes: parsed.estimatedMinutes,
        createdAt: now,
        lastOpenedAt: now,
        currentParagraphIndex: 0,
        bookmarks: [],
      };
      setDocuments((prev) => [newDoc, ...prev]);
      setActiveDocId(newDoc.id);
      setSidebarOpen(false);
      showToast(`Added "${newDoc.title}" (${newDoc.wordCount.toLocaleString()} words)`);
      if (autoPlay) {
        setTimeout(() => {
          player.jumpToParagraph(0, true);
        }, 120);
      }
    },
    [player, showToast]
  );

  // Handle incoming bookmarklet (?share=...) or PWA Share Target (?url=... or ?text=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get('share');
    const urlParam = params.get('url');
    const textParam = params.get('text');
    const titleParam = params.get('title') || undefined;

    if (!shareId && !urlParam && !textParam) return;

    // Clean URL right away so refreshing doesn't re-import
    window.history.replaceState({}, '', window.location.pathname);

    if (shareId) {
      showToast('Loading text from webpage...');
      fetchSharedDocument(shareId)
        .then((doc) => addImportedDocument(doc, true))
        .catch((err) => showToast(err.message || 'Could not load shared page.'));
    } else if (urlParam) {
      showToast('Extracting article from URL...');
      parseWebUrl(urlParam)
        .then((doc) => addImportedDocument(doc, true))
        .catch((err) => showToast(err.message || 'Could not extract URL.'));
    } else if (textParam) {
      // Sometimes Android Share sends a URL inside the text param
      const trimmed = textParam.trim();
      if (/^https?:\/\/\S+$/i.test(trimmed)) {
        showToast('Extracting article from shared link...');
        parseWebUrl(trimmed)
          .then((doc) => addImportedDocument(doc, true))
          .catch(() => {
            parseRawText(trimmed, titleParam, 'text').then((doc) => addImportedDocument(doc, true));
          });
      } else {
        parseRawText(trimmed, titleParam, 'text')
          .then((doc) => addImportedDocument(doc, true))
          .catch((err) => showToast(err.message || 'Could not import shared text.'));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global keyboard shortcuts (Space play/pause, arrows seek)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (importModalOpen || voiceDrawerOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (!activeDoc) return;

      if (e.code === 'Space') {
        e.preventDefault();
        player.togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        player.skipSeconds(15);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        player.skipSeconds(-15);
      } else if (e.key === ']') {
        player.jumpToParagraph(player.paragraphIndex + 1, player.isPlaying);
      } else if (e.key === '[') {
        player.jumpToParagraph(player.paragraphIndex - 1, player.isPlaying);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDoc, importModalOpen, player, voiceDrawerOpen]);

  // Global paste for screenshots (when modal is closed)
  useEffect(() => {
    if (importModalOpen) return;
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            showToast('Scanning pasted screenshot with OCR...');
            try {
              const text = await extractTextFromImage(blob);
              if (!text) {
                showToast('No text detected in pasted image.');
                return;
              }
              const parsed = await parseRawText(
                text,
                `Screenshot ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                'ocr'
              );
              addImportedDocument(parsed, true);
            } catch {
              showToast('Could not scan text from image.');
            }
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImportedDocument, importModalOpen, showToast]);

  // Global file drop anywhere on window
  const handleGlobalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setGlobalDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      showToast(`Scanning "${file.name}" with OCR...`);
      try {
        const text = await extractTextFromImage(file);
        if (!text) {
          showToast('No readable text found in image.');
          return;
        }
        const parsed = await parseRawText(text, file.name.replace(/\.[^.]+$/, ''), 'ocr');
        addImportedDocument(parsed, true);
      } catch {
        showToast('Failed to scan image.');
      }
      return;
    }

    showToast(`Importing "${file.name}"...`);
    try {
      const parsed = await parseUploadedFile(file);
      addImportedDocument(parsed, true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to parse file.');
    }
  };

  const handleDeleteDoc = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDocuments((prev) => {
      const next = prev.filter((d) => d.id !== id);
      if (activeDocId === id) {
        player.stopAllPlayback();
        setActiveDocId(next[0]?.id || null);
      }
      return next;
    });
  };

  const handleToggleBookmark = (paragraphIndex: number) => {
    if (!activeDoc) return;
    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id !== activeDoc.id) return d;
        const exists = d.bookmarks.some((b) => b.paragraphIndex === paragraphIndex);
        if (exists) {
          return { ...d, bookmarks: d.bookmarks.filter((b) => b.paragraphIndex !== paragraphIndex) };
        }
        const bm: Bookmark = {
          id: createId(),
          paragraphIndex,
          snippet: d.paragraphs[paragraphIndex]?.slice(0, 140) || '',
          createdAt: Date.now(),
        };
        return { ...d, bookmarks: [...d.bookmarks, bm].sort((a, b) => a.paragraphIndex - b.paragraphIndex) };
      })
    );
  };

  const handleExportMp3 = async () => {
    if (!activeDoc) return;
    setIsExporting(true);
    showToast('Generating MP3 audiobook — this may take a few seconds...');
    try {
      await exportAudioMp3({
        title: activeDoc.title,
        paragraphs: activeDoc.paragraphs,
        voice: settings.engine === 'neural' ? settings.voice : 'en-US-AvaMultilingualNeural',
        rate: settings.rate,
        pitch: settings.pitch,
      });
      showToast('MP3 downloaded!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'MP3 export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const openImport = (tab: ImportTab) => {
    setImportModalTab(tab);
    setImportModalOpen(true);
  };

  const activeVoiceInfo = useMemo(() => {
    const pool = settings.engine === 'neural' ? neuralVoices : browserVoices;
    return pool.find((v) => v.shortName === settings.voice);
  }, [browserVoices, neuralVoices, settings.engine, settings.voice]);

  const filteredDocs = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.author.toLowerCase().includes(q) ||
        d.sourceType.toLowerCase().includes(q)
    );
  }, [documents, librarySearch]);

  return (
    <div
      className="h-screen w-screen overflow-hidden flex bg-[#0b0d14] text-slate-100 select-none sm:select-auto"
      onDragOver={(e) => {
        e.preventDefault();
        if (!importModalOpen) setGlobalDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setGlobalDragOver(false);
      }}
      onDrop={handleGlobalDrop}
    >
      {/* Global Drag Overlay */}
      {globalDragOver && (
        <div className="fixed inset-0 z-50 bg-violet-950/80 backdrop-blur-md flex items-center justify-center p-6 pointer-events-none">
          <div className="rounded-3xl border-2 border-dashed border-violet-400 bg-[#121521]/90 px-12 py-10 text-center shadow-2xl">
            <Upload className="w-12 h-12 text-violet-300 mx-auto mb-3 animate-bounce" />
            <p className="text-xl font-bold text-white">Drop to Listen Immediately</p>
            <p className="text-sm text-violet-200 mt-1">PDF, Word (.docx), ePub, TXT, Markdown, HTML, or Screenshot</p>
          </div>
        </div>
      )}

      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar: Brand + Quick Import + Library */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-72 shrink-0 bg-[#0e111b] border-r border-white/8 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/8">
          <button
            onClick={() => setActiveDocId(null)}
            className="flex items-center gap-2.5 text-left group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-600/25 group-hover:scale-105 transition">
              <Headphones className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white block leading-none">
                ListenFlow
              </span>
              <span className="text-[11px] text-slate-400">Neural Speech Reader</span>
            </div>
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Add Button + Quick Sources */}
        <div className="p-4 space-y-2.5 border-b border-white/8">
          <button
            onClick={() => openImport('file')}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-violet-600/25 transition active:scale-[0.99]"
          >
            <Plus className="w-4 h-4" />
            Add Document or Link
          </button>

          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                { tab: 'file' as const, label: 'File', icon: <Upload className="w-3.5 h-3.5" /> },
                { tab: 'url' as const, label: 'Web', icon: <Globe className="w-3.5 h-3.5" /> },
                { tab: 'text' as const, label: 'Paste', icon: <FileText className="w-3.5 h-3.5" /> },
                { tab: 'screen' as const, label: 'Screen', icon: <ScanText className="w-3.5 h-3.5" /> },
              ]
            ).map((btn) => (
              <button
                key={btn.tab}
                onClick={() => openImport(btn.tab)}
                className="flex flex-col items-center gap-1 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] text-slate-300 hover:text-white text-[11px] font-medium transition border border-white/5"
              >
                {btn.icon}
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Library Header + Search */}
        <div className="px-4 pt-3 pb-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Library ({documents.length})
            </span>
            <button
              onClick={() => setVoiceDrawerOpen(true)}
              className="text-[11px] font-medium text-violet-400 hover:text-violet-300 flex items-center gap-1"
            >
              <Volume2 className="w-3 h-3" /> Voices
            </button>
          </div>
          {documents.length > 3 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Filter library..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/8 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          )}
        </div>

        {/* Library List */}
        <div className="flex-1 overflow-y-auto px-3 pb-6 space-y-1.5">
          {filteredDocs.length === 0 ? (
            <div className="text-center py-10 px-4">
              <BookOpen className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-400">No documents yet. Drop any file or link to start listening.</p>
            </div>
          ) : (
            filteredDocs.map((d) => {
              const isSelected = d.id === activeDocId;
              const pct =
                d.paragraphs.length > 0
                  ? Math.round(((d.currentParagraphIndex + (isSelected && player.isPlaying ? 0.5 : 0)) / d.paragraphs.length) * 100)
                  : 0;
              return (
                <div
                  key={d.id}
                  onClick={() => {
                    setActiveDocId(d.id);
                    setSidebarOpen(false);
                  }}
                  className={`group relative rounded-2xl p-3 cursor-pointer transition border ${
                    isSelected
                      ? 'bg-violet-600/18 border-violet-500/40'
                      : 'bg-transparent border-transparent hover:bg-white/[0.04] hover:border-white/6'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                            SOURCE_BADGE_COLORS[d.sourceType] || SOURCE_BADGE_COLORS.text
                          }`}
                        >
                          {d.sourceType}
                        </span>
                        <span className="text-[10px] text-slate-400">~{d.estimatedMinutes} min</span>
                      </div>
                      <p className={`text-xs font-semibold line-clamp-2 leading-snug ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                        {d.title}
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteDoc(d.id, e)}
                      className="p-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10 transition shrink-0"
                      title="Delete from library"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Mini progress bar */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-white/8 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 rounded-full"
                        style={{ width: `${Math.max(pct, isSelected ? 4 : 0)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-500 tabular-nums">{pct}%</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0e111b] border-b border-white/8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-xl text-slate-300 hover:bg-white/8"
            aria-label="Open Library"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-bold text-white flex items-center gap-1.5">
            <Headphones className="w-4 h-4 text-violet-400" /> ListenFlow
          </span>
          <button
            onClick={() => openImport('file')}
            className="p-2 -mr-1 rounded-xl text-violet-400 hover:bg-violet-500/15"
            aria-label="Add Document"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Player Error Banner */}
        {player.error && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {player.error}
            </span>
            <button onClick={player.clearError} className="text-amber-300 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeDoc ? (
          <>
            <ReaderView
              doc={activeDoc}
              activeParagraphIndex={player.paragraphIndex}
              activeWordIndex={player.activeWordIndex}
              isPlaying={player.isPlaying}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onParagraphClick={(idx) => player.jumpToParagraph(idx, true)}
              onToggleBookmark={handleToggleBookmark}
              onExportMp3={handleExportMp3}
              isExporting={isExporting}
            />
            <PlayerBar
              doc={activeDoc}
              isPlaying={player.isPlaying}
              isLoading={player.isLoading}
              paragraphIndex={player.paragraphIndex}
              currentTime={player.currentTime}
              duration={player.duration}
              sleepRemainingSec={player.sleepRemainingSec}
              sleepEndOfParagraph={player.sleepEndOfParagraph}
              settings={settings}
              activeVoice={activeVoiceInfo}
              onTogglePlay={player.togglePlay}
              onPrevParagraph={() => player.jumpToParagraph(player.paragraphIndex - 1, true)}
              onNextParagraph={() => player.jumpToParagraph(player.paragraphIndex + 1, true)}
              onSkipSeconds={player.skipSeconds}
              onJumpParagraph={(idx) => player.jumpToParagraph(idx, true)}
              onOpenVoiceDrawer={() => setVoiceDrawerOpen(true)}
              onUpdateSettings={handleUpdateSettings}
              onSetSleepTimer={player.setSleepTimer}
            />
          </>
        ) : (
          /* Home / Empty Hero Screen */
          <div className="flex-1 overflow-y-auto px-6 py-12 flex flex-col items-center justify-center">
            <div className="max-w-3xl w-full space-y-8">
              <div className="text-center space-y-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-medium">
                  <Sparkles className="w-3.5 h-3.5" /> Free Neural AI Voices · 60+ Languages
                </div>
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
                  Turn anything you read into natural speech
                </h1>
                <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto">
                  Drop a PDF, Word file, ePub, website link, or screenshot — and listen with real-time word highlighting.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(
                  [
                    {
                      tab: 'file' as const,
                      title: 'Import Documents',
                      desc: 'PDF, Word (.docx), ePub eBooks, TXT, Markdown & HTML',
                      icon: <Upload className="w-5 h-5 text-violet-300" />,
                      accent: 'from-violet-500/20 to-indigo-500/5 border-violet-500/25',
                    },
                    {
                      tab: 'url' as const,
                      title: 'Website & Article Reader',
                      desc: 'Paste any URL to strip ads and listen to the clean article',
                      icon: <Globe className="w-5 h-5 text-cyan-300" />,
                      accent: 'from-cyan-500/20 to-sky-500/5 border-cyan-500/25',
                    },
                    {
                      tab: 'screen' as const,
                      title: 'Read What’s On Screen',
                      desc: '1-click browser bookmarklet for any live page + Screenshot OCR',
                      icon: <ScanText className="w-5 h-5 text-amber-300" />,
                      accent: 'from-amber-500/20 to-orange-500/5 border-amber-500/25',
                    },
                    {
                      tab: 'text' as const,
                      title: 'Paste or Type Text',
                      desc: 'Instant narration for notes, emails, essays, or copied text',
                      icon: <FileText className="w-5 h-5 text-emerald-300" />,
                      accent: 'from-emerald-500/20 to-teal-500/5 border-emerald-500/25',
                    },
                  ]
                ).map((card) => (
                  <button
                    key={card.tab}
                    onClick={() => openImport(card.tab)}
                    className={`text-left p-5 rounded-3xl bg-gradient-to-br ${card.accent} border hover:scale-[1.01] transition shadow-lg`}
                  >
                    <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center mb-3">
                      {card.icon}
                    </div>
                    <h3 className="text-base font-semibold text-white">{card.title}</h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">{card.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-sm rounded-2xl bg-[#1a1f33] border border-violet-500/35 px-4 py-3 text-xs font-medium text-white shadow-2xl flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Modals & Drawers */}
      <ImportModal
        isOpen={importModalOpen}
        initialTab={importModalTab}
        onClose={() => setImportModalOpen(false)}
        onImported={addImportedDocument}
      />

      <VoiceDrawer
        isOpen={voiceDrawerOpen}
        onClose={() => setVoiceDrawerOpen(false)}
        neuralVoices={neuralVoices}
        browserVoices={browserVoices}
        neuralOnline={neuralOnline}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />
    </div>
  );
}
