import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Link } from 'react-router';
import type { Message, ToolInvocation } from '@ai-sdk/react';
import { sanitizeMarkdown } from '../lib/sanitize-markdown';

const STORAGE_KEY = 'sigma:chat';

// Example prompts shown in the empty state.
const EXAMPLE_PROMPTS = [
  'Покажи най-рисковите поръчки в строителството за 2023',
  'Топ 10 компании по спечелени обществени поръчки',
  'Тенденция на разходите по година от 2020 до 2024',
  'Единствена оферта — колко договора и каква стойност?',
];

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

// ── Report card ───────────────────────────────────────────────────────────────

interface ReportResult { id: string; title: string; url: string }

function ReportCard({ result }: { result: ReportResult }) {
  const href = result.url ?? `/reports/${result.id}`;
  return (
    <div className="chat-report-card">
      <span className="chat-report-card__tag">AI Справка</span>
      <p className="chat-report-card__title">{result.title}</p>
      <Link to={href} className="chat-report-card__open">
        Отвори справката →
      </Link>
    </div>
  );
}

// ── Message part renderer ─────────────────────────────────────────────────────

function ToolInvocationPart({ inv }: { inv: ToolInvocation }) {
  if (inv.toolName === 'emit_report') {
    if (inv.state === 'result' && inv.result) {
      return <ReportCard result={inv.result as ReportResult} />;
    }
    return <p className="chat-dock__thinking muted">Генерира справка…</p>;
  }
  // For other tools, show a subtle in-progress indicator while pending.
  if (inv.state === 'call' || inv.state === 'partial-call') {
    const labels: Record<string, string> = {
      run_sql: 'Изпълнява заявка…',
      describe_schema: 'Чете схемата…',
      search_entities: 'Търси…',
      get_company: 'Зарежда компания…',
      get_authority: 'Зарежда институция…',
      get_contract: 'Зарежда договор…',
    };
    return (
      <p className="chat-dock__thinking muted">{labels[inv.toolName] ?? `${inv.toolName}…`}</p>
    );
  }
  return null;
}

function AssistantMessage({ message }: { message: Message }) {
  const parts = message.parts ?? [];
  if (parts.length === 0) {
    // Fallback: render raw content (no parts in transcript — e.g. loaded from localStorage).
    return (
      <div
        className="chat-dock__msg-body"
        dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(message.content) }}
      />
    );
  }
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text) {
          return (
            <div
              key={i}
              className="chat-dock__msg-body"
              dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(part.text) }}
            />
          );
        }
        if (part.type === 'tool-invocation') {
          return <ToolInvocationPart key={i} inv={part.toolInvocation} />;
        }
        return null;
      })}
    </>
  );
}

// ── Main dock (client-only) ───────────────────────────────────────────────────

function ChatDockClient() {
  const initialMessages = loadMessages();
  const { messages, input, handleInputChange, handleSubmit, status, setInput } = useChat({
    api: '/assistant/chat',
    initialMessages,
  });
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const isLoading = status === 'streaming' || status === 'submitted';

  function fillPrompt(prompt: string) {
    setInput(prompt);
  }

  return (
    <div className="chat-dock" data-open={open || undefined}>
      <button
        type="button"
        className="chat-dock__toggle"
        aria-label={open ? 'Затвори асистент' : 'Отвори AI асистент'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '✕' : '💬'}
      </button>

      <div
        className="chat-dock__panel"
        role="complementary"
        aria-label="AI асистент"
        hidden={!open}
      >
        <header className="chat-dock__header">
          <span className="chat-dock__title">AI асистент</span>
          <span className="chat-dock__subtitle muted">BgGPT · неофициално</span>
        </header>

        <div className="chat-dock__messages" aria-live="polite" aria-atomic="false">
          {messages.length === 0 && (
            <div className="chat-dock__empty">
              <p className="muted">Задай въпрос за договори, компании или институции.</p>
              <ul className="chat-dock__examples">
                {EXAMPLE_PROMPTS.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className="chat-dock__example-btn"
                      onClick={() => fillPrompt(p)}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {messages.map((m) => (
            <article
              key={m.id}
              className={`chat-dock__msg chat-dock__msg--${m.role}`}
              aria-label={m.role === 'user' ? 'Ти' : 'Асистент'}
            >
              {m.role === 'assistant' ? (
                <AssistantMessage message={m} />
              ) : (
                <p className="chat-dock__msg-body">{m.content}</p>
              )}
            </article>
          ))}

          {isLoading && (
            <p className="chat-dock__thinking muted" aria-live="polite">
              Мисли…
            </p>
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>

        <form className="chat-dock__form" onSubmit={handleSubmit}>
          <label htmlFor="chat-input" className="sr-only">
            Съобщение
          </label>
          <input
            id="chat-input"
            className="chat-dock__input"
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Въпрос…"
            disabled={isLoading}
            autoComplete="off"
          />
          <button
            type="submit"
            className="chat-dock__send"
            disabled={isLoading || !input.trim()}
            aria-label="Изпрати"
          >
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}

export function ChatDock() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <ChatDockClient />;
}
