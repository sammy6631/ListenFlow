import React, { useMemo, useRef, useState } from 'react';
import { Check, Loader2, Play, Search, Sparkles, Volume2, Wifi, WifiOff, X } from 'lucide-react';
import { ReaderSettings, VoiceInfo } from '../types';
import { synthesizeChunk } from '../lib/api';

interface VoiceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  neuralVoices: VoiceInfo[];
  browserVoices: VoiceInfo[];
  neuralOnline: boolean;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}

const PREVIEW_SAMPLE = 'Hello! Welcome to ListenFlow. I can read your documents, articles, and books with natural expression.';

export const VoiceDrawer: React.FC<VoiceDrawerProps> = ({
  isOpen,
  onClose,
  neuralVoices,
  browserVoices,
  neuralOnline,
  settings,
  onUpdateSettings,
}) => {
  const [search, setSearch] = useState('');
  const [selectedLang, setSelectedLang] = useState<string>('ALL');
  const [genderFilter, setGenderFilter] = useState<'ALL' | 'Female' | 'Male'>('ALL');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const activeList = settings.engine === 'neural' ? neuralVoices : browserVoices;

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of activeList) {
      counts.set(v.language, (counts.get(v.language) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lang]) => lang);
  }, [activeList]);

  const filteredVoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeList.filter((v) => {
      if (selectedLang !== 'ALL' && v.language !== selectedLang) return false;
      if (genderFilter !== 'ALL' && v.gender !== genderFilter) return false;
      if (!q) return true;
      return (
        v.displayName.toLowerCase().includes(q) ||
        v.locale.toLowerCase().includes(q) ||
        v.language.toLowerCase().includes(q) ||
        v.shortName.toLowerCase().includes(q)
      );
    });
  }, [activeList, genderFilter, search, selectedLang]);

  const featuredVoices = useMemo(
    () => filteredVoices.filter((v) => v.featured),
    [filteredVoices]
  );

  if (!isOpen) return null;

  const handlePreview = async (voice: VoiceInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setPreviewingId(voice.shortName);
    try {
      if (voice.engine === 'browser') {
        const u = new SpeechSynthesisUtterance(PREVIEW_SAMPLE);
        const match = window.speechSynthesis.getVoices().find((v) => v.name === voice.shortName);
        if (match) u.voice = match;
        u.onend = () => setPreviewingId(null);
        u.onerror = () => setPreviewingId(null);
        window.speechSynthesis.speak(u);
      } else {
        const { audioUrl } = await synthesizeChunk({
          text: PREVIEW_SAMPLE,
          voice: voice.shortName,
          rate: 1.0,
          pitch: settings.pitch,
        });
        const audio = new Audio(audioUrl);
        previewAudioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          setPreviewingId(null);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          setPreviewingId(null);
        };
        await audio.play();
      }
    } catch {
      setPreviewingId(null);
    }
  };

  const selectVoice = (voice: VoiceInfo) => {
    onUpdateSettings({
      engine: voice.engine,
      voice: voice.shortName,
    });
  };

  const renderVoiceCard = (v: VoiceInfo) => {
    const isSelected = settings.voice === v.shortName && settings.engine === v.engine;
    const isPreviewing = previewingId === v.shortName;

    return (
      <div
        key={`${v.engine}-${v.shortName}`}
        onClick={() => selectVoice(v)}
        className={`group flex items-center justify-between gap-3 p-3 rounded-2xl border cursor-pointer transition ${
          isSelected
            ? 'bg-violet-600/20 border-violet-500/60 shadow-sm shadow-violet-500/15'
            : 'bg-white/[0.03] border-white/8 hover:bg-white/[0.06] hover:border-white/15'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold ${
              isSelected
                ? 'bg-violet-500 text-white'
                : v.gender === 'Female'
                ? 'bg-fuchsia-500/15 text-fuchsia-300'
                : 'bg-cyan-500/15 text-cyan-300'
            }`}
          >
            {isSelected ? <Check className="w-4 h-4" /> : v.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-white truncate">{v.displayName}</p>
              {v.featured && (
                <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 text-[10px] font-semibold shrink-0">
                  HD
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate">
              {v.language} · {v.locale} {v.gender ? `· ${v.gender}` : ''}
            </p>
          </div>
        </div>

        <button
          onClick={(e) => handlePreview(v, e)}
          className="p-2 rounded-xl bg-white/6 hover:bg-violet-500/30 text-slate-300 hover:text-white transition shrink-0"
          title="Preview voice"
        >
          {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin text-violet-300" /> : <Play className="w-4 h-4" />}
        </button>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md h-full bg-[#111420] border-l border-white/10 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Volume2 className="w-5 h-5 text-violet-400" />
            <div>
              <h2 className="text-base font-semibold text-white">Voice Studio</h2>
              <p className="text-xs text-slate-400">{activeList.length} voices available</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/8 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Engine Switch */}
        <div className="px-5 pt-4 pb-3 space-y-3 border-b border-white/8">
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-white/5 border border-white/8">
            <button
              onClick={() => {
                onUpdateSettings({
                  engine: 'neural',
                  voice:
                    neuralVoices.some((v) => v.shortName === settings.voice)
                      ? settings.voice
                      : neuralVoices[0]?.shortName || 'en-US-AvaMultilingualNeural',
                });
                setSelectedLang('ALL');
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${
                settings.engine === 'neural'
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Neural AI
              {neuralOnline ? (
                <Wifi className="w-3 h-3 text-emerald-300" />
              ) : (
                <WifiOff className="w-3 h-3 text-amber-300" />
              )}
            </button>
            <button
              onClick={() => {
                onUpdateSettings({
                  engine: 'browser',
                  voice:
                    browserVoices.some((v) => v.shortName === settings.voice)
                      ? settings.voice
                      : browserVoices[0]?.shortName || '',
                });
                setSelectedLang('ALL');
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${
                settings.engine === 'browser'
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              Offline Device ({browserVoices.length})
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search voice name, language, or accent..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* Language + Gender Filters */}
          <div className="flex items-center gap-2">
            <select
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value)}
              className="flex-1 rounded-xl bg-[#181c2c] border border-white/10 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="ALL">All Languages ({languages.length})</option>
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>

            <div className="flex rounded-xl bg-white/5 p-0.5 border border-white/8">
              {(['ALL', 'Female', 'Male'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGenderFilter(g)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                    genderFilter === g ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {g === 'ALL' ? 'All' : g}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Voice List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {featuredVoices.length > 0 && !search && selectedLang === 'ALL' && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
                Top Natural Voices
              </p>
              <div className="space-y-2">{featuredVoices.map(renderVoiceCard)}</div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {search || selectedLang !== 'ALL' ? `Matching Voices (${filteredVoices.length})` : `All Voices (${filteredVoices.length})`}
            </p>
            {filteredVoices.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No voices match your filter.</p>
            ) : (
              <div className="space-y-2">{filteredVoices.slice(0, 120).map(renderVoiceCard)}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
