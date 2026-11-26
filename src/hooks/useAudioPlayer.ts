import { useCallback, useEffect, useRef, useState } from 'react';
import { ListenDocument, ReaderSettings, WordBoundary } from '../types';
import { synthesizeChunk } from '../lib/api';

interface CachedChunk {
  audioUrl: string;
  wordBoundaries: WordBoundary[];
  key: string;
}

export interface PlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  paragraphIndex: number;
  activeWordIndex: number; // index into whitespace-split words of active paragraph
  activeCharOffset: number; // character offset fallback
  currentTime: number;
  duration: number;
  sleepRemainingSec: number | null;
  sleepEndOfParagraph: boolean;
}

function makeCacheKey(docId: string, index: number, voice: string, pitch: number) {
  return `${docId}::${index}::${voice}::${pitch}`;
}

/**
 * Matches a spoken WordBoundary (or sequence position) to the closest word token index
 * in the paragraph text for clean visual read-along highlighting.
 */
function findWordTokenIndex(paragraph: string, boundaryIndex: number, boundaries: WordBoundary[]): number {
  if (!boundaries.length || boundaryIndex < 0) return -1;
  const tokens = paragraph.split(/\s+/).filter(Boolean);
  if (!tokens.length) return -1;

  // Walk through boundaries up to boundaryIndex matching normalized word text sequentially
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff\u4e00-\u9fff]/gi, '');
  let tokenPtr = 0;

  for (let i = 0; i <= boundaryIndex && i < boundaries.length; i++) {
    const bNorm = normalize(boundaries[i].text);
    if (!bNorm) continue;

    // Look ahead up to 6 tokens to handle punctuation/hyphenation splits
    let matched = -1;
    for (let look = 0; look < 6 && tokenPtr + look < tokens.length; look++) {
      const tNorm = normalize(tokens[tokenPtr + look]);
      if (tNorm && (tNorm === bNorm || tNorm.includes(bNorm) || bNorm.includes(tNorm))) {
        matched = tokenPtr + look;
        break;
      }
    }
    if (matched !== -1) {
      tokenPtr = matched;
      if (i < boundaryIndex && tokenPtr < tokens.length - 1) {
        // Only advance pointer if the next boundary isn't part of the same hyphenated token
        const nextNorm = normalize(boundaries[i + 1]?.text || '');
        const currTokenNorm = normalize(tokens[tokenPtr]);
        if (!nextNorm || !currTokenNorm.endsWith(nextNorm)) {
          tokenPtr++;
        }
      }
    }
  }
  return Math.min(tokenPtr, tokens.length - 1);
}

export function useAudioPlayer(
  doc: ListenDocument | null,
  settings: ReaderSettings,
  onProgressChange?: (docId: string, paragraphIndex: number) => void
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paragraphIndex, setParagraphIndex] = useState(doc?.currentParagraphIndex || 0);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [sleepEndOfParagraph, setSleepEndOfParagraph] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, CachedChunk>>(new Map());
  const inflightRef = useRef<Map<string, Promise<CachedChunk>>>(new Map());
  const boundariesRef = useRef<WordBoundary[]>([]);
  const rafRef = useRef<number | null>(null);
  const playSessionRef = useRef(0);
  const isPlayingRef = useRef(false);
  const docRef = useRef(doc);
  const settingsRef = useRef(settings);
  const sleepEndRef = useRef(false);
  const paragraphIndexRef = useRef(paragraphIndex);

  docRef.current = doc;
  settingsRef.current = settings;
  sleepEndRef.current = sleepEndOfParagraph;
  paragraphIndexRef.current = paragraphIndex;

  // Create persistent Audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      for (const item of cacheRef.current.values()) {
        URL.revokeObjectURL(item.audioUrl);
      }
      cacheRef.current.clear();
    };
  }, []);

  // Sync paragraph index when switching documents
  useEffect(() => {
    stopAllPlayback();
    setParagraphIndex(doc?.currentParagraphIndex || 0);
    setActiveWordIndex(-1);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  // Live speed update without re-synthesizing!
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = settings.rate;
      // Preserve natural pitch when speeding up
      if ('preservesPitch' in audioRef.current) {
        (audioRef.current as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
      }
    }
  }, [settings.rate]);

  // If voice, pitch, or engine changes while playing, re-synthesize current paragraph seamlessly
  const prevVoiceSig = useRef(`${settings.engine}::${settings.voice}::${settings.pitch}`);
  useEffect(() => {
    const sig = `${settings.engine}::${settings.voice}::${settings.pitch}`;
    if (sig !== prevVoiceSig.current) {
      prevVoiceSig.current = sig;
      if (isPlayingRef.current && docRef.current) {
        playParagraph(paragraphIndexRef.current);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.engine, settings.voice, settings.pitch]);

  // Sleep timer countdown
  useEffect(() => {
    if (sleepRemainingSec === null) return;
    if (sleepRemainingSec <= 0) {
      pause();
      setSleepRemainingSec(null);
      return;
    }
    const timer = setInterval(() => {
      setSleepRemainingSec((prev) => {
        if (prev === null) return null;
        if (!isPlayingRef.current) return prev;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepRemainingSec]);

  const stopRaf = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stopAllPlayback = useCallback(() => {
    playSessionRef.current += 1;
    stopRaf();
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  const getOrSynthesize = useCallback(
    async (targetDoc: ListenDocument, index: number, voice: string, pitch: number): Promise<CachedChunk> => {
      const key = makeCacheKey(targetDoc.id, index, voice, pitch);
      const cached = cacheRef.current.get(key);
      if (cached) return cached;

      const existing = inflightRef.current.get(key);
      if (existing) return existing;

      const text = targetDoc.paragraphs[index];
      const promise = synthesizeChunk({
        text,
        voice,
        rate: 1.0, // Always synthesize at 1.0x and use native playbackRate for instant speed switching!
        pitch,
      })
        .then((res) => {
          const entry: CachedChunk = { ...res, key };
          // Keep cache bounded to ~25 chunks to conserve memory
          if (cacheRef.current.size > 25) {
            const firstKey = cacheRef.current.keys().next().value;
            if (firstKey) {
              const evicted = cacheRef.current.get(firstKey);
              if (evicted && audioRef.current?.src !== evicted.audioUrl) {
                URL.revokeObjectURL(evicted.audioUrl);
                cacheRef.current.delete(firstKey);
              }
            }
          }
          cacheRef.current.set(key, entry);
          return entry;
        })
        .finally(() => {
          inflightRef.current.delete(key);
        });

      inflightRef.current.set(key, promise);
      return promise;
    },
    []
  );

  const prefetchUpcoming = useCallback(
    (targetDoc: ListenDocument, fromIndex: number) => {
      const { engine, voice, pitch } = settingsRef.current;
      if (engine !== 'neural') return;
      // Prefetch next 2 paragraphs silently
      for (let offset = 1; offset <= 2; offset++) {
        const nextIdx = fromIndex + offset;
        if (nextIdx < targetDoc.paragraphs.length) {
          getOrSynthesize(targetDoc, nextIdx, voice, pitch).catch(() => {});
        }
      }
    },
    [getOrSynthesize]
  );

  const startWordSyncLoop = useCallback((paragraphText: string) => {
    stopRaf();
    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;

      const ms = audio.currentTime * 1000;
      setCurrentTime(audio.currentTime);
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }

      const bounds = boundariesRef.current;
      if (bounds.length > 0) {
        let activeIdx = -1;
        for (let i = 0; i < bounds.length; i++) {
          if (ms >= bounds[i].offsetMs - 40) {
            activeIdx = i;
          } else {
            break;
          }
        }
        if (activeIdx >= 0) {
          const wordIdx = findWordTokenIndex(paragraphText, activeIdx, bounds);
          setActiveWordIndex(wordIdx);
        }
      } else if (audio.duration > 0) {
        // Smooth proportional estimation if a voice didn't return boundaries
        const tokens = paragraphText.split(/\s+/).filter(Boolean);
        const ratio = Math.min(0.999, Math.max(0, audio.currentTime / audio.duration));
        setActiveWordIndex(Math.floor(ratio * tokens.length));
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const playWithBrowserSpeech = useCallback(
    (targetDoc: ListenDocument, index: number, sessionId: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setError('Browser Speech Synthesis is not supported on this device.');
        stopAllPlayback();
        return;
      }

      window.speechSynthesis.cancel();
      const text = targetDoc.paragraphs[index];
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.min(2.5, Math.max(0.5, settingsRef.current.rate));
      utterance.pitch = 1 + settingsRef.current.pitch / 100;

      const browserVoices = window.speechSynthesis.getVoices();
      const matched = browserVoices.find(
        (v) => v.name === settingsRef.current.voice || v.voiceURI === settingsRef.current.voice
      );
      if (matched) utterance.voice = matched;

      const tokens = text.split(/\s+/).filter(Boolean);
      // Precompute character start positions of each word token
      const tokenStarts: number[] = [];
      let cursor = 0;
      for (const tok of tokens) {
        const pos = text.indexOf(tok, cursor);
        tokenStarts.push(pos >= 0 ? pos : cursor);
        cursor = (pos >= 0 ? pos : cursor) + tok.length;
      }

      utterance.onstart = () => {
        if (playSessionRef.current !== sessionId) return;
        setIsLoading(false);
        isPlayingRef.current = true;
        setIsPlaying(true);
        setActiveWordIndex(0);
      };

      utterance.onboundary = (ev) => {
        if (playSessionRef.current !== sessionId) return;
        if (ev.name === 'word' || typeof ev.charIndex === 'number') {
          let wIdx = 0;
          for (let i = 0; i < tokenStarts.length; i++) {
            if (tokenStarts[i] <= ev.charIndex + 1) wIdx = i;
            else break;
          }
          setActiveWordIndex(wIdx);
        }
      };

      utterance.onend = () => {
        if (playSessionRef.current !== sessionId) return;
        if (sleepEndRef.current) {
          setSleepEndOfParagraph(false);
          stopAllPlayback();
          return;
        }
        if (index + 1 < targetDoc.paragraphs.length) {
          playParagraph(index + 1);
        } else {
          stopAllPlayback();
          setActiveWordIndex(-1);
        }
      };

      utterance.onerror = (ev) => {
        if (playSessionRef.current !== sessionId) return;
        if (ev.error === 'interrupted' || ev.error === 'canceled') return;
        setError(`Browser speech error: ${ev.error}`);
        stopAllPlayback();
      };

      setIsLoading(false);
      isPlayingRef.current = true;
      setIsPlaying(true);
      window.speechSynthesis.speak(utterance);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopAllPlayback]
  );

  const playParagraph = useCallback(
    async (index: number) => {
      const targetDoc = docRef.current;
      if (!targetDoc || index < 0 || index >= targetDoc.paragraphs.length) return;

      const sessionId = ++playSessionRef.current;
      stopRaf();
      if (audioRef.current) audioRef.current.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      setError(null);
      setParagraphIndex(index);
      paragraphIndexRef.current = index;
      setActiveWordIndex(-1);
      setCurrentTime(0);
      setDuration(0);
      onProgressChange?.(targetDoc.id, index);

      const { engine, voice, pitch, rate } = settingsRef.current;

      if (engine === 'browser') {
        playWithBrowserSpeech(targetDoc, index, sessionId);
        return;
      }

      setIsLoading(true);
      isPlayingRef.current = true;
      setIsPlaying(true);

      try {
        const chunk = await getOrSynthesize(targetDoc, index, voice, pitch);
        if (playSessionRef.current !== sessionId) return;

        boundariesRef.current = chunk.wordBoundaries;
        const audio = audioRef.current!;
        audio.src = chunk.audioUrl;
        audio.currentTime = 0;
        audio.playbackRate = rate;
        if ('preservesPitch' in audio) {
          (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
        }

        audio.onloadedmetadata = () => {
          if (playSessionRef.current !== sessionId) return;
          if (Number.isFinite(audio.duration)) setDuration(audio.duration);
        };

        audio.onended = () => {
          if (playSessionRef.current !== sessionId) return;
          stopRaf();
          if (sleepEndRef.current) {
            setSleepEndOfParagraph(false);
            stopAllPlayback();
            return;
          }
          if (index + 1 < targetDoc.paragraphs.length) {
            playParagraph(index + 1);
          } else {
            stopAllPlayback();
            setActiveWordIndex(-1);
          }
        };

        audio.onerror = () => {
          if (playSessionRef.current !== sessionId) return;
          setError('Audio playback error. Retrying with device voice...');
          playWithBrowserSpeech(targetDoc, index, sessionId);
        };

        await audio.play();
        if (playSessionRef.current !== sessionId) return;
        setIsLoading(false);
        startWordSyncLoop(targetDoc.paragraphs[index]);
        prefetchUpcoming(targetDoc, index);
      } catch (err) {
        if (playSessionRef.current !== sessionId) return;
        const msg = err instanceof Error ? err.message : 'Neural TTS failed';
        setError(`Neural voice unavailable (${msg}). Using offline browser voice.`);
        playWithBrowserSpeech(targetDoc, index, sessionId);
      }
    },
    [getOrSynthesize, onProgressChange, playWithBrowserSpeech, prefetchUpcoming, startWordSyncLoop, stopAllPlayback]
  );

  const pause = useCallback(() => {
    stopRaf();
    if (settingsRef.current.engine === 'browser') {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } else if (audioRef.current) {
      audioRef.current.pause();
    }
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  const resumeOrPlay = useCallback(() => {
    const targetDoc = docRef.current;
    if (!targetDoc || !targetDoc.paragraphs.length) return;

    if (
      settingsRef.current.engine === 'neural' &&
      audioRef.current &&
      audioRef.current.src &&
      audioRef.current.currentTime > 0 &&
      !audioRef.current.ended
    ) {
      isPlayingRef.current = true;
      setIsPlaying(true);
      audioRef.current
        .play()
        .then(() => {
          startWordSyncLoop(targetDoc.paragraphs[paragraphIndexRef.current] || '');
        })
        .catch(() => {
          playParagraph(paragraphIndexRef.current);
        });
      return;
    }

    playParagraph(paragraphIndexRef.current);
  }, [playParagraph, startWordSyncLoop]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      pause();
    } else {
      resumeOrPlay();
    }
  }, [pause, resumeOrPlay]);

  const jumpToParagraph = useCallback(
    (index: number, autoPlay = true) => {
      const targetDoc = docRef.current;
      if (!targetDoc) return;
      const clamped = Math.max(0, Math.min(index, targetDoc.paragraphs.length - 1));
      setParagraphIndex(clamped);
      paragraphIndexRef.current = clamped;
      onProgressChange?.(targetDoc.id, clamped);
      if (autoPlay) {
        playParagraph(clamped);
      } else {
        stopAllPlayback();
        setActiveWordIndex(-1);
      }
    },
    [onProgressChange, playParagraph, stopAllPlayback]
  );

  const skipSeconds = useCallback(
    (delta: number) => {
      const targetDoc = docRef.current;
      if (!targetDoc) return;
      const audio = audioRef.current;
      if (settingsRef.current.engine === 'neural' && audio && audio.src && Number.isFinite(audio.duration)) {
        const nextTime = audio.currentTime + delta;
        if (nextTime < 0) {
          if (paragraphIndexRef.current > 0) {
            playParagraph(paragraphIndexRef.current - 1);
          } else {
            audio.currentTime = 0;
          }
        } else if (nextTime >= audio.duration) {
          if (paragraphIndexRef.current + 1 < targetDoc.paragraphs.length) {
            playParagraph(paragraphIndexRef.current + 1);
          }
        } else {
          audio.currentTime = nextTime;
          setCurrentTime(nextTime);
        }
      } else {
        // Browser speech fallback: skip paragraphs
        jumpToParagraph(paragraphIndexRef.current + (delta > 0 ? 1 : -1), isPlayingRef.current);
      }
    },
    [jumpToParagraph, playParagraph]
  );

  const seekCurrentAudio = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration)) {
      const clamped = Math.max(0, Math.min(seconds, audio.duration));
      audio.currentTime = clamped;
      setCurrentTime(clamped);
    }
  }, []);

  const setSleepTimer = useCallback((mode: 'off' | 'eop' | number) => {
    if (mode === 'off') {
      setSleepRemainingSec(null);
      setSleepEndOfParagraph(false);
    } else if (mode === 'eop') {
      setSleepRemainingSec(null);
      setSleepEndOfParagraph(true);
    } else {
      setSleepEndOfParagraph(false);
      setSleepRemainingSec(mode * 60);
    }
  }, []);

  // Media Session API for lock screen & Android notification controls
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !doc) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: doc.title,
        artist: doc.author || 'ListenFlow',
        album: `Paragraph ${paragraphIndex + 1} of ${doc.paragraphs.length}`,
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => resumeOrPlay());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('previoustrack', () =>
        jumpToParagraph(Math.max(0, paragraphIndexRef.current - 1), true)
      );
      navigator.mediaSession.setActionHandler('nexttrack', () =>
        jumpToParagraph(paragraphIndexRef.current + 1, true)
      );
      navigator.mediaSession.setActionHandler('seekbackward', () => skipSeconds(-15));
      navigator.mediaSession.setActionHandler('seekforward', () => skipSeconds(15));
    } catch {
      // Ignore on unsupported browsers
    }
  }, [doc, isPlaying, paragraphIndex, jumpToParagraph, pause, resumeOrPlay, skipSeconds]);

  return {
    isPlaying,
    isLoading,
    error,
    clearError: () => setError(null),
    paragraphIndex,
    activeWordIndex,
    currentTime,
    duration,
    sleepRemainingSec,
    sleepEndOfParagraph,
    togglePlay,
    playParagraph,
    pause,
    jumpToParagraph,
    skipSeconds,
    seekCurrentAudio,
    setSleepTimer,
    stopAllPlayback,
  };
}
