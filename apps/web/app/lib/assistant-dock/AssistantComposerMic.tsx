import type { CSSProperties } from 'react';
import type { VoiceInput } from './useVoiceInput';
import { useElapsedSeconds } from './useElapsedSeconds';

interface AssistantComposerMicProps {
  voice: VoiceInput;
}

/** Elapsed recording seconds → a short `0:SS` clock (capped at the 60s recording limit). */
const formatElapsedTime = (seconds: number): string =>
  `0:${String(Math.min(seconds, 60)).padStart(2, '0')}`;

const MIC_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
    />
  </svg>
);
const STOP_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <rect x="4" y="4" width="16" height="16" rx="2.5" fill="currentColor" />
  </svg>
);
// Discard glyph for "cancel recording" — a bin, deliberately not an ✕ (the header close) or the eraser
// (Clear), so three different "undo-ish" controls never share one symbol.
const CANCEL_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z"
    />
  </svg>
);
// "Finish & send" glyph — a paper-plane, distinct from the composer's arrow-up Send and from the
// stop/cancel controls: one press ends the recording and sends the transcript directly.
const SEND_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z" />
  </svg>
);
// Per-bar height coefficients (13 bars): a symmetric mound so the level-scaled meter reads as an
// equalizer, not one flat block. Each bar's height = --mic-level × its coefficient (see assistant.css).
const BAR_COEFFICIENTS = [0.35, 0.5, 0.65, 0.8, 0.95, 1, 0.9, 1, 0.95, 0.8, 0.65, 0.5, 0.35];

/**
 * The mic toggle: aria-pressed / name / icon change with state. While recording it shows a live,
 * amplitude-reactive equalizer (driven by `voice.level`), an elapsed timer, and a discard ("cancel")
 * button beside it. The composer owns the status live-region; this stays just the inline controls.
 */
export const AssistantComposerMic = ({ voice }: AssistantComposerMicProps) => {
  const { state, startedAt, level, start, stop, finishAndSend, cancel } = voice;
  const seconds = useElapsedSeconds(startedAt); // local tick — re-renders only the mic, not the composer
  const recording = state.status === 'recording';
  const busy = state.status === 'requesting' || state.status === 'transcribing';

  return (
    <div className="assistant-composer__mic-group">
      <button
        type="button"
        className="assistant-composer__mic"
        aria-label={recording ? 'Спри записа' : 'Гласово въвеждане'}
        aria-pressed={recording}
        disabled={busy}
        onClick={() => (recording ? stop() : start())}
      >
        {recording ? STOP_ICON : MIC_ICON}
      </button>
      {recording ? (
        <span className="assistant-composer__mic-timer" aria-hidden="true">
          {formatElapsedTime(seconds)}
        </span>
      ) : null}
      {recording ? (
        <span
          className="assistant-composer__mic-viz"
          aria-hidden="true"
          style={{ '--mic-level': level } as CSSProperties}
        >
          {BAR_COEFFICIENTS.map((coef, index) => (
            <span
              key={index}
              className="assistant-composer__mic-bar"
              style={{ '--bar-coef': coef } as CSSProperties}
            />
          ))}
        </span>
      ) : null}
      {recording ? (
        <button
          type="button"
          className="assistant-composer__mic-cancel"
          aria-label="Откажи записа"
          onClick={() => cancel()}
        >
          {CANCEL_ICON}
        </button>
      ) : null}
      {recording ? (
        <button
          type="button"
          className="assistant-composer__mic-send"
          aria-label="Приключи и изпрати"
          onClick={() => finishAndSend()}
        >
          {SEND_ICON}
        </button>
      ) : null}
    </div>
  );
};
