import type { UIMessage } from 'ai';

// Concatenate a message's visible text parts. Tool-call and tool-result parts are handled elsewhere;
// here we render only the conversational prose.
//
// The Gemma-based BgGPT model uses text-based tool calling internally: the API gateway sends each
// tool result back to the model as a `<tool_response>JSON</tool_response>` text chunk, and the
// model sometimes echoes that literal string before generating its real reply. Those parts carry no
// value to the reader and break the UI, so they are stripped here rather than being shown raw.
const isToolResponseEcho = (text: string): boolean =>
  text.trimStart().startsWith('<tool_response>');

const textOf = (message: UIMessage): string =>
  (message.parts ?? [])
    .map((part) => {
      if (part.type !== 'text') return '';
      const t = typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '';
      return isToolResponseEcho(t) ? '' : t;
    })
    .join('')
    .trim();

/**
 * One conversational message (user or assistant prose). The text is rendered as plain text — React
 * escapes it and CSS preserves whitespace, so model output can never inject markup (no raw HTML, no
 * `dangerouslySetInnerHTML`). Report cards are rendered separately by the transcript.
 */
export const AssistantMessage = ({ message }: { message: UIMessage }) => {
  const text = textOf(message);
  if (text === '') return null;
  return (
    <div
      className={`assistant-message assistant-message--${message.role}`}
      data-role={message.role}
    >
      <p className="assistant-message__text">{text}</p>
    </div>
  );
};
