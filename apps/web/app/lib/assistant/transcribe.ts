// Pure helpers for /assistant/transcribe (voice transcription). No DOM, no bindings — unit-tested in the
// node project. The route composes these with firstPartyRejection + the byte cap + env.AI.run.

/** Workers AI Whisper model — multilingual; called DIRECTLY (no AI Gateway) so audio is never logged. */
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

/** Forced decode language (Bulgarian-first audience). Not a translate flag — Whisper cannot translate to Bulgarian. */
export const TRANSCRIBE_LANGUAGE = 'bg';

// Server body cap (~3 MB): must fit a full 60s clip — base64 inflates the audio ~1.33×, so a 60s
// webm/opus clip is ~1–2.5 MB here. Bounds size, not duration; a tighter cap rejects legit 60s recordings,
// so the account-wide breaker (deferred launch gate) is the real DoW control, not this cap.
export const MAX_TRANSCRIBE_BODY_BYTES = 3 * 1024 * 1024;

/** Transcript length cap — a ~60s clip is short; bounds a pathological model response. */
export const MAX_TRANSCRIPT_CHARS = 2000;

// MediaRecorder only ever emits these containers (webm/opus on Chrome/FF, mp4/m4a on Safari, ogg rarely).
const ALLOWED_AUDIO_MIMES: ReadonlySet<string> = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);

// Control chars (C0/C1) + bidi overrides/isolates that can spoof a transcript's visible order.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Lowercase and drop codec params: `audio/webm;codecs=opus` → `audio/webm`. */
export function normalizeMime(mime: string): string {
  return mime.split(';', 1)[0].trim().toLowerCase();
}

/** Whether the declared media type is one MediaRecorder produces and Whisper accepts. */
export function isAllowedAudioMime(mime: string): boolean {
  return ALLOWED_AUDIO_MIMES.has(normalizeMime(mime));
}

/**
 * Make a Whisper transcript safe to render as a controlled textarea value: strip control + bidi-override
 * chars, collapse whitespace, trim, and cap length. React still escapes it; this defends the visible order.
 */
export function sanitizeTranscript(text: string, maxLen: number = MAX_TRANSCRIPT_CHARS): string {
  return text.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

export type TranscribeBody =
  | { ok: true; audio: string; mime: string }
  | { ok: false; status: number; error: string };

/**
 * Validate the posted JSON `{ audio: <base64>, mime }`. Client-side base64 keeps the Worker free of any
 * decode work (and lets the route reuse firstPartyRejection's application/json CSRF gate).
 */
export function parseTranscribeBody(raw: string): TranscribeBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: 'невалиден JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, status: 400, error: 'липсва аудио' };
  }
  const body = parsed as { audio?: unknown; mime?: unknown };
  if (typeof body.audio !== 'string' || body.audio.length === 0) {
    return { ok: false, status: 400, error: 'липсва аудио' };
  }
  if (typeof body.mime !== 'string' || !isAllowedAudioMime(body.mime)) {
    return { ok: false, status: 415, error: 'неподдържан аудио формат' };
  }
  return { ok: true, audio: body.audio, mime: body.mime };
}
