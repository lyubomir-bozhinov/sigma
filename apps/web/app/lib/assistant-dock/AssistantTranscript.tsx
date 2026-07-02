import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import {
  isReportPending,
  isToolTurnWithoutReport,
  projectChip,
  reportOutputFromMessage,
} from './report-projection';
import { addToReportIndex } from './storage';
import { AssistantMessage, messageText } from './AssistantMessage';
import { ReportChip } from './ReportChip';

interface AssistantTranscriptProps {
  messages: UIMessage[];
  /** A turn is still in flight (status 'submitted' | 'streaming') — suppress the settled-turn fallback. */
  busy: boolean;
}

// Shown when a turn SETTLES having made tool calls but produced neither a report nor prose — e.g. the
// model ran out of tool steps before composing an answer. Actionable, so the reader isn't left with a
// blank turn (the root fix is elsewhere; this is the last-resort safety net).
const NO_ANSWER_FALLBACK =
  'Не успях да съставя справка за този въпрос в наличните стъпки. Опитайте по-конкретно — напр. ' +
  'посочете възложител, период или сектор.';

// Slack (px) for "still at the bottom": absorbs sub-pixel rounding and the few px a streamed token adds
// between the scroll event and the re-render. A small constant (~2 lines), not a derived value.
const STICK_THRESHOLD_PX = 40;

/**
 * The scrolling conversation log. Per message it renders the prose (AssistantMessage) and, for a
 * finished report, a ReportChip; a "preparing report" line bridges the gap while the report is composed.
 * `role="log"` + `aria-live="polite"` announce streamed content to screen readers. It keeps the latest
 * content in view while streaming, but only while the reader is already near the bottom — so scrolling
 * up to read history isn't interrupted.
 */
export const AssistantTranscript = ({ messages, busy }: AssistantTranscriptProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Index each settled report so /reports can read from localStorage (spec §5: per-browser, no
  // global enumeration). Runs whenever messages change; deduplication is in addToReportIndex.
  useEffect(() => {
    for (const message of messages) {
      const output = reportOutputFromMessage(message);
      if (output?.ok && output.storedId) {
        addToReportIndex({
          id: output.storedId,
          title: output.report.title,
          question: output.report.question,
          createdAt:
            (message as { createdAt?: Date }).createdAt?.toISOString() ?? new Date().toISOString(),
        });
      }
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A message the visitor just sent always scrolls into view; streamed assistant tokens only follow
    // when the reader was already near the bottom, so scrolling up to read history isn't interrupted.
    const justSent = messages[messages.length - 1]?.role === 'user';
    if (justSent || stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="assistant-transcript"
      role="log"
      aria-live="polite"
      aria-label="Разговор с асистента"
    >
      {messages.map((message, index) => {
        const report = reportOutputFromMessage(message);
        // Only the LAST turn, once settled (not busy), can be the no-answer case — an earlier turn always
        // has a following user message, and a mid-stream turn legitimately has tool calls but no report yet.
        const showNoAnswer =
          !busy &&
          index === messages.length - 1 &&
          message.role === 'assistant' &&
          !report &&
          !isReportPending(message) &&
          isToolTurnWithoutReport(message) &&
          messageText(message) === '';
        return (
          <div key={message.id} className="assistant-turn">
            <AssistantMessage message={message} />
            {report?.ok ? (
              <ReportChip
                {...projectChip(report.report)}
                href={report.storedId ? `/reports/${report.storedId}` : undefined}
              />
            ) : null}
            {/* Suppress the failure line while the last turn is still in flight: a first emit that
                returns ok:false is normally RETRIED (the loop re-forces emit_report) and then
                succeeds, so flashing „не можа да бъде съставена" mid-retry contradicts the report
                that lands a moment later. Only show it once the turn has settled (or for an earlier
                turn that genuinely ended on ok:false). While busy the pending indicator shows instead. */}
            {report && !report.ok && !(busy && index === messages.length - 1) ? (
              <p className="assistant-transcript__error">Справката не можа да бъде съставена.</p>
            ) : null}
            {/* Gate on `busy` + last turn: a fallback-finalized report (server delivers a fresh
                emit_report part) leaves the model's ORIGINAL emit_report part orphaned at
                `input-available`, so isReportPending stays true forever. Once the stream settles
                (status → 'ready' → !busy) the spinner clears; the rendered chip is what remains. */}
            {busy && index === messages.length - 1 && isReportPending(message) ? (
              <p className="assistant-transcript__pending">Подготвям справка…</p>
            ) : null}
            {showNoAnswer ? (
              <p className="assistant-transcript__error">{NO_ANSWER_FALLBACK}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
