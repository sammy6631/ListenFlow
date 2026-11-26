import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Gauge,
  Loader2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
} from 'lucide-react';
import { ListenDocument, ReaderSettings, VoiceInfo } from '../types';

interface PlayerBarProps {
  doc: ListenDocument;
  isPlaying: boolean;
  isLoading: boolean;
  paragraphIndex: number;
  currentTime: number;
  duration: number;
  sleepRemainingSec: number | null;
  sleepEndOfParagraph: boolean;
  settings: ReaderSettings;
  activeVoice?: VoiceInfo;
  onTogglePlay: () => void;
  onPrevParagraph: () => void;
  onNextParagraph: () => void;
  onSkipSeconds: (delta: number) => void;
  onJumpParagraph: (index: number) => void;
  onOpenVoiceDrawer: () => void;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  onSetSleepTimer: (mode: 'off' | 'eop' | number) => void;
}

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  doc,
  isPlaying,
  isLoading,
  paragraphIndex,
  currentTime,
  duration,
  sleepRemainingSec,
  sleepEndOfParagraph,
  settings,
  activeVoice,
  onTogglePlay,
  onPrevParagraph,
  onNextParagraph,
  onSkipSeconds,
  onJumpParagraph,
  onOpenVoiceDrawer,
  onUpdateSettings,
  onSetSleepTimer,
}) => {
  const [openMenu, setOpenMenu] = useState<'speed' | 'sleep' | null>(null);

  const totalParagraphs = Math.max(1, doc.paragraphs.length);
  const paraFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const overallPercent = Math.min(100, ((paragraphIndex + paraFraction) / totalParagraphs) * 100);

  const voiceLabel = activeVoice?.displayName || settings.voice.replace(/Neural$/, '').split('-').pop() || 'Voice';

  return (
    <div className="fixed bottom-0 left-0 right-0 lg:left-72 z-30 px-3 sm:px-6 pb-3 sm:pb-5 pointer-events-none">
      <div className="max-w-3xl mx-auto pointer-events-auto rounded-3xl bg-[#131726]/95 backdrop-blur-xl border border-white/12 shadow-2xl shadow-black/50 px-4 sm:px-6 py-3.5">
        {/* Progress bar across document */}
        <div className="flex items-center gap-3 mb-2.5">
          <span className="text-[11px] font-medium text-slate-400 tabular-nums shrink-0">
            {paragraphIndex + 1} / {totalParagraphs}
          </span>
          <div
            className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden cursor-pointer relative group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const targetIdx = Math.min(totalParagraphs - 1, Math.floor(ratio * totalParagraphs));
              onJumpParagraph(targetIdx);
            }}
            title="Click to jump anywhere in the document"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-400 to-cyan-400 transition-all duration-150"
              style={{ width: `${Math.max(2, overallPercent)}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-slate-400 tabular-nums shrink-0">
            {Math.round(overallPercent)}%
          </span>
        </div>

        {/* Main Controls Row */}
        <div className="flex items-center justify-between gap-2 relative">
          {/* Left: Voice selector pill */}
          <button
            onClick={onOpenVoiceDrawer}
            className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/6 hover:bg-white/12 border border-white/8 transition min-w-0 max-w-[140px] sm:max-w-[190px]"
            title="Change AI Voice"
          >
            {isPlaying ? (
              <div className="flex items-end gap-0.5 h-3.5 shrink-0">
                <span className="w-0.5 h-full bg-violet-400 rounded-full animate-wave-1" />
                <span className="w-0.5 h-full bg-cyan-400 rounded-full animate-wave-2" />
                <span className="w-0.5 h-full bg-violet-400 rounded-full animate-wave-3" />
              </div>
            ) : (
              <Volume2 className="w-4 h-4 text-violet-400 shrink-0" />
            )}
            <div className="text-left min-w-0">
              <p className="text-xs font-semibold text-white truncate">{voiceLabel}</p>
              <p className="text-[10px] text-slate-400 truncate">
                {settings.engine === 'neural' ? 'Neural AI' : 'Offline Voice'}
              </p>
            </div>
          </button>

          {/* Center: Transport controls */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={onPrevParagraph}
              disabled={paragraphIndex <= 0}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/8 disabled:opacity-30 transition hidden sm:flex"
              title="Previous paragraph"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <button
              onClick={() => onSkipSeconds(-15)}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/8 transition relative"
              title="Back 15 seconds"
            >
              <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              onClick={onTogglePlay}
              className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-violet-600/35 active:scale-95 transition"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={() => onSkipSeconds(15)}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/8 transition"
              title="Forward 15 seconds"
            >
              <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              onClick={onNextParagraph}
              disabled={paragraphIndex >= totalParagraphs - 1}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/8 disabled:opacity-30 transition hidden sm:flex"
              title="Next paragraph"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Right: Speed & Sleep Timer */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setOpenMenu(openMenu === 'speed' ? null : 'speed')}
              className={`px-3 py-2 rounded-2xl text-xs font-semibold tabular-nums flex items-center gap-1.5 border transition ${
                openMenu === 'speed'
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'bg-white/6 hover:bg-white/12 border-white/8 text-slate-200'
              }`}
              title="Speed & Pitch"
            >
              <Gauge className="w-3.5 h-3.5 text-violet-300 hidden sm:inline" />
              {settings.rate % 1 === 0
                ? settings.rate.toFixed(1)
                : settings.rate.toFixed(2).replace(/0$/, '')}×
            </button>

            <button
              onClick={() => setOpenMenu(openMenu === 'sleep' ? null : 'sleep')}
              className={`px-2.5 py-2 rounded-2xl text-xs font-medium flex items-center gap-1 border transition ${
                sleepRemainingSec !== null || sleepEndOfParagraph
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                  : openMenu === 'sleep'
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'bg-white/6 hover:bg-white/12 border-white/8 text-slate-300'
              }`}
              title="Sleep Timer"
            >
              <Moon className="w-3.5 h-3.5" />
              {sleepRemainingSec !== null && <span className="tabular-nums">{formatTimer(sleepRemainingSec)}</span>}
              {sleepEndOfParagraph && <span className="hidden sm:inline">EoP</span>}
            </button>
          </div>

          {/* Speed & Pitch Popover */}
          {openMenu === 'speed' && (
            <div className="absolute right-0 bottom-16 w-72 rounded-2xl bg-[#161b2c] border border-white/12 shadow-2xl p-4 space-y-4 z-40">
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold text-white">Playback Speed</span>
                  <span className="text-violet-300 font-semibold tabular-nums">{settings.rate.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={3.0}
                  step={0.05}
                  value={settings.rate}
                  onChange={(e) => onUpdateSettings({ rate: Number(e.target.value) })}
                  className="w-full listen-slider"
                />
                <div className="grid grid-cols-5 gap-1 mt-2.5">
                  {[0.8, 1.0, 1.25, 1.5, 2.0].map((r) => (
                    <button
                      key={r}
                      onClick={() => onUpdateSettings({ rate: r })}
                      className={`py-1 rounded-lg text-[11px] font-semibold transition ${
                        Math.abs(settings.rate - r) < 0.01
                          ? 'bg-violet-600 text-white'
                          : 'bg-white/6 text-slate-300 hover:bg-white/12'
                      }`}
                    >
                      {r}×
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-white/8">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold text-white">Voice Pitch</span>
                  <span className="text-cyan-300 font-semibold tabular-nums">
                    {settings.pitch > 0 ? `+${settings.pitch}%` : `${settings.pitch}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min={-20}
                  max={20}
                  step={2}
                  value={settings.pitch}
                  onChange={(e) => onUpdateSettings({ pitch: Number(e.target.value) })}
                  className="w-full listen-slider"
                />
              </div>
            </div>
          )}

          {/* Sleep Timer Popover */}
          {openMenu === 'sleep' && (
            <div className="absolute right-0 bottom-16 w-56 rounded-2xl bg-[#161b2c] border border-white/12 shadow-2xl p-3 space-y-1.5 z-40">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 pb-1">
                Sleep Timer
              </p>
              {(
                [
                  { label: 'Off', mode: 'off' as const },
                  { label: 'End of current paragraph', mode: 'eop' as const },
                  { label: '5 minutes', mode: 5 },
                  { label: '15 minutes', mode: 15 },
                  { label: '30 minutes', mode: 30 },
                  { label: '60 minutes', mode: 60 },
                ]
              ).map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    onSetSleepTimer(opt.mode);
                    setOpenMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:bg-violet-600/25 hover:text-white transition"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
