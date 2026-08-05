import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { AssistantComposerMic } from './AssistantComposerMic';
import { micStatusText } from './errors';
import { useVoiceInput } from './useVoiceInput';

interface AssistantComposerProps {
  /** Submit a (trimmed, non-empty) message. */
  onSend: (text: string) => void;
  /** Cancel the in-flight turn. */
  onStop: () => void;
  /** A turn is in flight (status 'submitted' | 'streaming') — disable input, swap Send for Stop. */
  busy: boolean;
}

// The transcript-ready cue (a11y contract): announced + visible so the user knows the voice text is in the
// box and how to send it — voice never auto-sends.
const TRANSCRIPT_READY =
  'Готово. Текстът е в полето за съобщение - прегледайте го и натиснете Изпрати.';

// Append dictated text with exactly one separator — no double space when the draft already ends in whitespace.
export const appendTranscript = (prev: string, next: string): string =>
  prev === '' ? next : /\s$/.test(prev) ? `${prev}${next}` : `${prev} ${next}`;

// Icon-first controls (house SVGs, no icon lib) — the accessible name lives on the button's aria-label,
// so the icon-only affordance is fully reachable by AT and keeps the test contract ("Изпрати"/"Спри"/…).
const SEND_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M12 4 5 11h4v7h6v-7h4z" />
  </svg>
);
const STOP_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
  </svg>
);
// An eraser (not a ✕) — deliberately distinct from the header's stroked close ✕ so "wipe the dictated
// draft" never reads as "put the assistant away"; the two controls sit only rows apart in the dock.
const CLEAR_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M16.24 3.56 21.19 8.5a1.9 1.9 0 0 1 0 2.84L12 20.53a3.35 3.35 0 0 1-4.75 0L2.81 16.1a1.9 1.9 0 0 1 0-2.84L13.16 3.56a1.9 1.9 0 0 1 3.08 0ZM4.22 15.58l3.54 3.53a1.35 1.35 0 0 0 2.83 0l3.53-3.53-4.95-4.95Z"
    />
  </svg>
);

/**
 * The message input. Owns its own textarea value (the chat hook owns the message list, not the draft).
 * Enter sends; Shift+Enter inserts a newline. Voice input records a clip, transcribes it, and appends the
 * text to the draft — editable, never auto-sent; the textarea stays usable through every mic state so a
 * user who can't type is never trapped.
 */
export const AssistantComposer = ({ onSend, onStop, busy }: AssistantComposerProps) => {
  const [text, setText] = useState('');
  const [transcriptReady, setTranscriptReady] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A finished transcript appends to the draft (with a separating space). Focus deliberately STAYS on the
  // mic button — moving it to the textarea would cut off the screen-reader announcement (a11y contract).
  const handleTranscript = useCallback((transcript: string) => {
    setText((prev) => appendTranscript(prev, transcript));
    setTranscriptReady(true);
  }, []);
  const voice = useVoiceInput(handleTranscript);

  // Wipe the whole draft in one action — easier than select-all-delete for motor/cognitive users who
  // dislike a dictated result and want to restart rather than edit it word by word.
  const clearDraft = useCallback(() => {
    setText('');
    setTranscriptReady(false);
    inputRef.current?.focus();
  }, []);

  // The composer-level status line: the active voice state, or (once idle) the transcript-ready cue.
  const voiceStatus =
    voice.state.status === 'idle'
      ? transcriptReady
        ? TRANSCRIPT_READY
        : ''
      : micStatusText(voice);

  // Grow the textarea to fit its content (capped by the CSS max-height), and shrink back when cleared.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // One source of truth for "can this draft be sent" — reused by submit, the Send button, and Clear.
  const trimmed = text.trim();
  const canSend = !busy && trimmed !== '';

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setText('');
    setTranscriptReady(false);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className="assistant-composer" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor={inputId}>
        Съобщение до асистента
      </label>
      {/* One rounded surface holds the input and its controls (like ChatGPT/Claude): the accent focus
          ring is on the box via :focus-within, so tabbing into the textarea lights the whole control. */}
      <div className="assistant-composer__box">
        <textarea
          ref={inputRef}
          id={inputId}
          className="assistant-composer__input"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setTranscriptReady(false); // editing dismisses the "ready" cue
          }}
          onKeyDown={onKeyDown}
          placeholder="Напишете въпрос…"
          rows={1}
          disabled={busy}
        />
        {/* Right-aligned control cluster: the optional Clear grows in on the LEFT, so mic and the primary
            Send/Stop stay adjacent and never shift (no layout hop when Clear mounts). Clear appears only
            after a voice transcript lands — its purpose is restarting a bad dictation; typists use ⌘A⌫. */}
        <div className="assistant-composer__actions">
          {transcriptReady && !busy ? (
            <button
              type="button"
              className="assistant-composer__clear"
              onClick={clearDraft}
              aria-label="Изчисти"
            >
              {CLEAR_ICON}
            </button>
          ) : null}
          <AssistantComposerMic voice={voice} />
          {busy ? (
            <button
              type="button"
              className="assistant-composer__stop"
              onClick={onStop}
              aria-label="Спри"
            >
              {STOP_ICON}
            </button>
          ) : (
            <button
              type="submit"
              className="assistant-composer__send"
              disabled={!canSend}
              aria-label="Изпрати"
            >
              {SEND_ICON}
            </button>
          )}
        </div>
      </div>
      <p className="assistant-composer__mic-status" role="status" aria-live="polite">
        {voiceStatus}
      </p>
    </form>
  );
};
