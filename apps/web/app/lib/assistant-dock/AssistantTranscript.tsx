import { lazy, Suspense, useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import { isReportPending, reportOutputFromMessage } from './report-projection';
import { AssistantMessage } from './AssistantMessage';

// Lazy-load so chart/formatting deps stay out of the SSR Worker bundle.
const InlineDockReport = lazy(() =>
  import('./InlineDockReport').then((m) => ({ default: m.InlineDockReport })),
);

interface AssistantTranscriptProps {
  messages: UIMessage[];
}

// Slack (px) for "still at the bottom": absorbs sub-pixel rounding and the few px a streamed token adds
// between the scroll event and the re-render. A small constant (~2 lines), not a derived value.
const STICK_THRESHOLD_PX = 40;

export const AssistantTranscript = ({ messages }: AssistantTranscriptProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

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
      {messages.map((message) => {
        const output = reportOutputFromMessage(message);
        return (
          <div key={message.id} className="assistant-turn">
            <AssistantMessage message={message} />

            {output?.ok ? (
              <Suspense fallback={<p className="assistant-transcript__pending">Зареждане на справка…</p>}>
                <InlineDockReport report={output.report} href={`/reports/${message.id}`} />
              </Suspense>
            ) : null}

            {output && !output.ok ? (
              <p className="assistant-transcript__error">Справката не можа да бъде съставена.</p>
            ) : null}

            {isReportPending(message) ? (
              <p className="assistant-transcript__pending">Подготвям справка…</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
