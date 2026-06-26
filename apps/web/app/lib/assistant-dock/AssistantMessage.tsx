import { lazy, Suspense } from 'react';
import type { UIMessage } from 'ai';

// Concatenate a message's text parts. Non-text parts (tool calls, etc.) are handled elsewhere in the
// transcript; here we only render the conversational prose.
const textOf = (message: UIMessage): string =>
  (message.parts ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');

// Lazy-load react-markdown so Vite excludes it from the SSR/Workers bundle — it pulls in Node.js
// built-ins (tty) that don't exist in workerd. The dock never renders on the server anyway
// (AssistantDock gates on `mounted`), so the dynamic chunk is client-only.
const MarkdownRenderer = lazy(() =>
  import('./MarkdownRenderer').then((m) => ({ default: m.MarkdownRenderer })),
);

/**
 * One conversational message (user or assistant prose). User messages are plain text; assistant
 * messages are rendered as markdown (GFM tables, bold, code, lists) via react-markdown. No raw HTML
 * is ever emitted — react-markdown converts markdown to React elements only.
 */
export const AssistantMessage = ({ message }: { message: UIMessage }) => {
  const text = textOf(message);
  if (text === '') return null;

  if (message.role === 'user') {
    return (
      <div className="assistant-message assistant-message--user" data-role="user">
        <p className="assistant-message__text">{text}</p>
      </div>
    );
  }

  return (
    <div className="assistant-message assistant-message--assistant" data-role="assistant">
      <div className="assistant-message__md">
        <Suspense fallback={<p className="assistant-message__text">{text}</p>}>
          <MarkdownRenderer>{text}</MarkdownRenderer>
        </Suspense>
      </div>
    </div>
  );
};
