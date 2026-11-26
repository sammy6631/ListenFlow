import { EdgeTTS } from '@andresaya/edge-tts';

const FEATURED_SHORT_NAMES = new Set([
  'en-US-AvaMultilingualNeural',
  'en-US-AndrewMultilingualNeural',
  'en-US-EmmaMultilingualNeural',
  'en-US-BrianMultilingualNeural',
  'en-US-AriaNeural',
  'en-US-GuyNeural',
  'en-US-JennyNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
  'en-AU-NatashaNeural',
]);

const FALLBACK_VOICES = [
  {
    shortName: 'en-US-AvaMultilingualNeural',
    friendlyName: 'Microsoft AvaMultilingual Online (Natural) - English (United States)',
    displayName: 'Ava Multilingual',
    locale: 'en-US',
    language: 'English',
    gender: 'Female',
    featured: true,
    engine: 'neural',
  },
  {
    shortName: 'en-US-AndrewMultilingualNeural',
    friendlyName: 'Microsoft AndrewMultilingual Online (Natural) - English (United States)',
    displayName: 'Andrew Multilingual',
    locale: 'en-US',
    language: 'English',
    gender: 'Male',
    featured: true,
    engine: 'neural',
  },
  {
    shortName: 'en-US-AriaNeural',
    friendlyName: 'Microsoft Aria Online (Natural) - English (United States)',
    displayName: 'Aria',
    locale: 'en-US',
    language: 'English',
    gender: 'Female',
    featured: true,
    engine: 'neural',
  },
  {
    shortName: 'en-US-GuyNeural',
    friendlyName: 'Microsoft Guy Online (Natural) - English (United States)',
    displayName: 'Guy',
    locale: 'en-US',
    language: 'English',
    gender: 'Male',
    featured: true,
    engine: 'neural',
  },
  {
    shortName: 'en-GB-SoniaNeural',
    friendlyName: 'Microsoft Sonia Online (Natural) - English (United Kingdom)',
    displayName: 'Sonia (UK)',
    locale: 'en-GB',
    language: 'English',
    gender: 'Female',
    featured: true,
    engine: 'neural',
  },
];

let cachedVoices = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

function formatDisplayName(shortName, locale) {
  const parts = String(shortName || '').split('-');
  const raw = (parts[2] || shortName || 'Voice').replace(/Neural$/, '');
  const spaced = raw.replace(/([a-z])([A-Z])/g, '$1 $2');
  const region = parts[1] ? ` (${parts[1]})` : '';
  return locale?.startsWith('en-US') ? spaced : `${spaced}${region}`;
}

function localeToLanguage(locale) {
  const base = String(locale || 'en').split('-')[0].toLowerCase();
  try {
    return languageNames.of(base) || locale;
  } catch {
    return locale;
  }
}

export async function getNeuralVoices() {
  if (cachedVoices && Date.now() - cachedAt < CACHE_TTL_MS) {
    return { voices: cachedVoices, online: true };
  }

  try {
    const tts = new EdgeTTS({ timeout: 15000 });
    const rawVoices = await tts.getVoices();
    const mapped = rawVoices.map((v) => {
      const shortName = v.ShortName || v.Name;
      const locale = v.Locale || 'en-US';
      return {
        shortName,
        friendlyName: v.FriendlyName || shortName,
        displayName: formatDisplayName(shortName, locale),
        locale,
        language: localeToLanguage(locale),
        gender: v.Gender || '',
        featured: FEATURED_SHORT_NAMES.has(shortName),
        engine: 'neural',
      };
    });

    // Sort featured first, then English, then alphabetical
    mapped.sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      const aEn = a.locale.startsWith('en-');
      const bEn = b.locale.startsWith('en-');
      if (aEn && !bEn) return -1;
      if (!aEn && bEn) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    cachedVoices = mapped;
    cachedAt = Date.now();
    return { voices: mapped, online: true };
  } catch (err) {
    console.warn('[TTS] Could not fetch live Edge voices, returning curated list:', err.message);
    return { voices: FALLBACK_VOICES, online: false };
  }
}

function toEdgeRatePercent(multiplier = 1.0) {
  const clamped = Math.max(0.5, Math.min(3.0, Number(multiplier) || 1.0));
  return Math.round((clamped - 1.0) * 100);
}

function toEdgePitchHz(pitchSlider = 0) {
  const clamped = Math.max(-25, Math.min(25, Number(pitchSlider) || 0));
  return Math.round(clamped * 2); // -50Hz to +50Hz
}

export async function synthesizeSpeech({ text, voice = 'en-US-AvaMultilingualNeural', rate = 1.0, pitch = 0 }) {
  const tts = new EdgeTTS({ timeout: 25000 });
  const result = await tts.generate(text, voice, {
    rate: toEdgeRatePercent(rate),
    pitch: toEdgePitchHz(pitch),
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
  });

  const audioBuffer = Buffer.isBuffer(result.audio) ? result.audio : Buffer.from(result.audio);
  const wordBoundaries = (result.wordBoundaries || []).map((wb) => ({
    text: wb.text || '',
    // Edge TTS reports offset & duration in 100-nanosecond ticks (10,000 ticks = 1 ms)
    offsetMs: Math.round((wb.offset || 0) / 10000),
    durationMs: Math.round((wb.duration || 0) / 10000),
  }));

  return {
    audioBase64: audioBuffer.toString('base64'),
    mimeType: 'audio/mpeg',
    wordBoundaries,
  };
}

export async function synthesizeFullMp3({ paragraphs, voice, rate = 1.0, pitch = 0 }) {
  // Batch paragraphs into ~1800-char segments for fast, reliable full-document MP3 export
  const segments = [];
  let current = '';
  for (const para of paragraphs) {
    const clean = String(para || '').trim();
    if (!clean) continue;
    if ((current + '\n\n' + clean).length <= 1800) {
      current = current ? `${current}\n\n${clean}` : clean;
    } else {
      if (current) segments.push(current);
      current = clean.slice(0, 2000);
    }
  }
  if (current) segments.push(current);

  const buffers = [];
  for (const segment of segments) {
    const tts = new EdgeTTS({ timeout: 30000 });
    const res = await tts.generate(segment, voice, {
      rate: toEdgeRatePercent(rate),
      pitch: toEdgePitchHz(pitch),
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    });
    buffers.push(Buffer.isBuffer(res.audio) ? res.audio : Buffer.from(res.audio));
  }
  return Buffer.concat(buffers);
}
