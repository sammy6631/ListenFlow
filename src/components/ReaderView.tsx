import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Download,
  ExternalLink,
  Loader2,
  SlidersHorizontal,
  Trash2,
  Type,
} from 'lucide-react';
import { ListenDocument, ReaderFont, ReaderSettings, ReaderTheme } from '../types';

interface ReaderViewProps {
  doc: ListenDocument;
  activeParagraphIndex: number;
  activeWordIndex: number;
  isPlaying: boolean;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  onParagraphClick: (index: number) => void;
  onToggleBookmark: (paragraphIndex: number) => void;
  onExportMp3: () => Promise<void>;
  isExporting: boolean;
}

const THEME_STYLES: Record<ReaderTheme, { bg: string; text: string; muted: string; activeBg: string; border: string }> = {
  dark: {
    bg: 'bg-[#0b0d14]',
    text: 'text-slate-200',
    muted: 'text-slate-400',
    activeBg: 'bg-violet-500/[0.11] ring-1 ring-violet-500/30',
    border: 'border-white/8',
  },
  light: {
    bg: 'bg-[#f8f9fc]',
    text: 'text-slate-800',
    muted: 'text-slate-500',
    activeBg: 'bg-violet-500/[0.09] ring-1 ring-violet-500/30',
    border: 'border-slate-200',
  },
  sepia: {
    bg: 'bg-[#f5efe2]',
    text: 'text-[#3b2f21]',
    muted: 'text-[#7c6a53]',
    activeBg: 'bg-amber-600/[0.11] ring-1 ring-amber-700/25',
    border: 'border-[#e4d7be]',
  },
};

export const ReaderView: React.FC<ReaderViewProps> = ({
  doc,
  activeParagraphIndex,
  activeWordIndex,
  isPlaying,
  settings,
  onUpdateSettings,
  onParagraphClick,
  onToggleBookmark,
  onExportMp3,
  isExporting,
}) => {
  const [showAppearance, setShowAppearance] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const activeParaRef = useRef<HTMLDivElement | null>(null);

  const themeStyle = THEME_STYLES[settings.theme];
  const fontClass =
    settings.font === 'serif'
      ? 'font-reader-serif'
      : settings.font === 'dyslexic'
      ? 'font-reader-dyslexic'
      : 'font-reader-sans';

  // Smooth auto-scroll to active paragraph
  useEffect(() => {
    if (!settings.autoScroll || !activeParaRef.current) return;
    activeParaRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeParagraphIndex, settings.autoScroll]);

  const bookmarkedIndices = new Set(doc.bookmarks.map((b) => b.paragraphIndex));

  return (
    <div className={`flex-1 flex flex-col min-h-0 transition-colors duration-200 ${themeStyle.bg}`}>
      {/* Document Toolbar */}
      <div className={`sticky top-0 z-20 backdrop-blur-md border-b ${themeStyle.border} px-4 sm:px-8 py-3 flex items-center justify-between gap-3 ${settings.theme === 'dark' ? 'bg-[#0b0d14]/85' : settings.theme === 'light' ? 'bg-[#f8f9fc]/85' : 'bg-[#f5efe2]/85'}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-violet-500/15 text-violet-400">
              {doc.sourceType}
            </span>
            <span className={`text-xs ${themeStyle.muted}`}>
              {doc.wordCount.toLocaleString()} words · ~{doc.estimatedMinutes} min
            </span>
            {doc.sourceUrl && (
              <a
                href={doc.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-violet-400 hover:underline inline-flex items-center gap-1"
              >
                Source <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <h1 className={`text-sm sm:text-base font-semibold truncate mt-0.5 ${settings.theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
            {doc.title}
          </h1>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 relative">
          {/* Bookmarks toggle */}
          <button
            onClick={() => {
              setShowBookmarks((v) => !v);
              setShowAppearance(false);
            }}
            className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${
              showBookmarks
                ? 'bg-violet-600 text-white'
                : settings.theme === 'dark'
                ? 'bg-white/6 hover:bg-white/12 text-slate-200'
                : 'bg-black/5 hover:bg-black/10 text-slate-700'
            }`}
            title="Bookmarks"
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Bookmarks</span>
            {doc.bookmarks.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-violet-500/30 text-[10px]">{doc.bookmarks.length}</span>
            )}
          </button>

          {/* Appearance toggle */}
          <button
            onClick={() => {
              setShowAppearance((v) => !v);
              setShowBookmarks(false);
            }}
            className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${
              showAppearance
                ? 'bg-violet-600 text-white'
                : settings.theme === 'dark'
                ? 'bg-white/6 hover:bg-white/12 text-slate-200'
                : 'bg-black/5 hover:bg-black/10 text-slate-700'
            }`}
            title="Reading Appearance"
          >
            <Type className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Aa</span>
          </button>

          {/* Export MP3 */}
          <button
            onClick={onExportMp3}
            disabled={isExporting}
            className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${
              settings.theme === 'dark'
                ? 'bg-white/6 hover:bg-white/12 text-slate-200'
                : 'bg-black/5 hover:bg-black/10 text-slate-700'
            } disabled:opacity-50`}
            title="Download full narrated MP3"
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" /> : <Download className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{isExporting ? 'Exporting...' : 'MP3'}</span>
          </button>

          {/* Appearance Popover */}
          {showAppearance && (
            <div className="absolute right-0 top-12 w-72 rounded-2xl bg-[#151927] border border-white/12 shadow-2xl p-4 space-y-4 text-slate-200 z-30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" /> Reader Style
                </span>
              </div>

              {/* Theme */}
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'dark', label: 'Dark', preview: 'bg-[#0b0d14] text-white border-white/20' },
                    { id: 'sepia', label: 'Sepia', preview: 'bg-[#f5efe2] text-[#3b2f21] border-[#d6c6a5]' },
                    { id: 'light', label: 'Light', preview: 'bg-white text-slate-900 border-slate-300' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onUpdateSettings({ theme: t.id })}
                    className={`py-2 rounded-xl text-xs font-semibold border transition ${t.preview} ${
                      settings.theme === t.id ? 'ring-2 ring-violet-500' : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Font Family */}
              <div>
                <p className="text-xs text-slate-400 mb-1.5">Typography</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'serif', label: 'Serif' },
                      { id: 'sans', label: 'Sans' },
                      { id: 'dyslexic', label: 'Accessible' },
                    ] as { id: ReaderFont; label: string }[]
                  ).map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onUpdateSettings({ font: f.id })}
                      className={`py-1.5 rounded-lg text-xs font-medium transition ${
                        settings.font === f.id
                          ? 'bg-violet-600 text-white'
                          : 'bg-white/6 text-slate-300 hover:bg-white/12'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size */}
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Text Size</span>
                  <span>{settings.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min={14}
                  max={28}
                  value={settings.fontSize}
                  onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                  className="w-full listen-slider"
                />
              </div>

              {/* Auto-scroll toggle */}
              <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                <span>Auto-scroll while reading</span>
                <input
                  type="checkbox"
                  checked={settings.autoScroll}
                  onChange={(e) => onUpdateSettings({ autoScroll: e.target.checked })}
                  className="accent-violet-500 w-4 h-4 rounded"
                />
              </label>
            </div>
          )}

          {/* Bookmarks Popover */}
          {showBookmarks && (
            <div className="absolute right-0 top-12 w-80 max-h-96 overflow-y-auto rounded-2xl bg-[#151927] border border-white/12 shadow-2xl p-4 space-y-3 text-slate-200 z-30">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Saved Bookmarks ({doc.bookmarks.length})
              </p>
              {doc.bookmarks.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  Click the bookmark icon next to any paragraph to save quotes or spots to revisit.
                </p>
              ) : (
                <div className="space-y-2">
                  {doc.bookmarks.map((bm) => (
                    <div
                      key={bm.id}
                      onClick={() => {
                        onParagraphClick(bm.paragraphIndex);
                        setShowBookmarks(false);
                      }}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-violet-500/15 border border-white/8 cursor-pointer flex items-start justify-between gap-2 transition"
                    >
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold text-violet-300">
                          Paragraph {bm.paragraphIndex + 1}
                        </span>
                        <p className="text-xs text-slate-300 line-clamp-2 mt-0.5">{bm.snippet}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleBookmark(bm.paragraphIndex);
                        }}
                        className="p-1 text-slate-400 hover:text-rose-400"
                        title="Remove bookmark"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Reading Canvas */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-8 pb-40">
        <article className="max-w-3xl mx-auto">
          <header className="mb-8 pb-6 border-b border-current/10">
            <h2
              className={`text-2xl sm:text-3xl font-bold tracking-tight leading-snug ${
                settings.theme === 'dark' ? 'text-white' : settings.theme === 'light' ? 'text-slate-900' : 'text-[#2a2015]'
              }`}
            >
              {doc.title}
            </h2>
            {doc.author && <p className={`text-sm mt-2 ${themeStyle.muted}`}>{doc.author}</p>}
          </header>

          <div className={`space-y-3 ${fontClass}`} style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}>
            {doc.paragraphs.map((para, idx) => {
              const isActive = idx === activeParagraphIndex;
              const isBookmarked = bookmarkedIndices.has(idx);
              const words = isActive ? para.split(/\s+/).filter(Boolean) : null;

              return (
                <div
                  key={idx}
                  ref={isActive ? activeParaRef : null}
                  onClick={() => onParagraphClick(idx)}
                  className={`group relative rounded-2xl px-4 py-3 -mx-4 cursor-pointer transition-all duration-200 ${
                    isActive
                      ? themeStyle.activeBg
                      : settings.theme === 'dark'
                      ? 'hover:bg-white/[0.04]'
                      : 'hover:bg-black/[0.03]'
                  }`}
                >
                  {/* Left active indicator bar */}
                  {isActive && (
                    <span className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-gradient-to-b from-violet-500 to-cyan-400" />
                  )}

                  {/* Bookmark button on hover or when bookmarked */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleBookmark(idx);
                    }}
                    className={`absolute right-2.5 top-2.5 p-1.5 rounded-lg transition ${
                      isBookmarked
                        ? 'text-violet-400 opacity-100'
                        : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-violet-400'
                    }`}
                    title={isBookmarked ? 'Remove bookmark' : 'Bookmark paragraph'}
                  >
                    {isBookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                  </button>

                  <p className={`pr-7 ${themeStyle.text}`}>
                    {words
                      ? words.map((word, wIdx) => {
                          const isWordActive = isPlaying && wIdx === activeWordIndex;
                          const isWordPast = isPlaying && activeWordIndex > wIdx;
                          return (
                            <React.Fragment key={wIdx}>
                              <span
                                className={`rounded px-0.5 transition-colors duration-75 ${
                                  isWordActive
                                    ? 'bg-violet-500 text-white font-medium shadow-sm shadow-violet-500/40'
                                    : isWordPast
                                    ? settings.theme === 'dark'
                                      ? 'text-violet-200/90'
                                      : 'text-violet-900/90'
                                    : ''
                                }`}
                              >
                                {word}
                              </span>{' '}
                            </React.Fragment>
                          );
                        })
                      : para}
                  </p>
                </div>
              );
            })}
          </div>
        </article>
      </div>
    </div>
  );
};
