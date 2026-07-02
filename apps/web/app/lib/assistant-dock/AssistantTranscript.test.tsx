import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { AssistantTranscript } from './AssistantTranscript';

afterEach(() => {
  cleanup();
});

// Minimal hand-built messages — the SDK's UIMessage part union is stricter than these fixtures need,
// so the cast crosses that boundary in one place.
const message = (id: string, role: 'user' | 'assistant', parts: unknown[]): UIMessage =>
  ({ id, role, parts }) as unknown as UIMessage;

const userMessage = (id: string, text: string) => message(id, 'user', [{ type: 'text', text }]);

const reportMessage = (id: string) =>
  message(id, 'assistant', [
    { type: 'text', text: 'Ето справката:' },
    {
      type: 'tool-emit_report',
      state: 'output-available',
      output: {
        ok: true,
        report: {
          title: 'Заглавие на справка',
          question: 'q',
          watermark: 'ai-generated',
          blocks: [{ type: 'totals', items: [{ label: 'Сума', value: 100, format: 'money' }] }],
        },
      },
    },
  ]);

const pendingMessage = (id: string) =>
  message(id, 'assistant', [{ type: 'tool-emit_report', state: 'input-available' }]);

const failedReportMessage = (id: string) =>
  message(id, 'assistant', [
    { type: 'tool-emit_report', state: 'output-available', output: { ok: false, errors: ['x'] } },
  ]);

// A turn that ran tool calls (run_sql) but never emitted a report — the "out of steps" case.
const toolOnlyMessage = (id: string) =>
  message(id, 'assistant', [
    { type: 'tool-run_sql', state: 'output-available', output: 'R1 (колони: …) — 100 ред(а)' },
  ]);

const NO_ANSWER = /Не успях да съставя справка за този въпрос/;

describe('AssistantTranscript', () => {
  it('renders message prose', () => {
    render(<AssistantTranscript messages={[userMessage('1', 'Здравейте')]} busy={false} />);

    expect(screen.getByText('Здравейте')).toBeInTheDocument();
  });

  it('renders a report chip for a finished report', () => {
    render(<AssistantTranscript messages={[reportMessage('2')]} busy={false} />);

    expect(screen.getByText('Заглавие на справка')).toBeInTheDocument();
  });

  it('does not render a chip for a prose-only message', () => {
    render(<AssistantTranscript messages={[userMessage('3', 'само текст')]} busy={false} />);

    expect(screen.queryByText('Заглавие на справка')).not.toBeInTheDocument();
  });

  it('shows a preparing indicator while a report is being composed', () => {
    render(<AssistantTranscript messages={[pendingMessage('4')]} busy={true} />);

    expect(screen.getByText('Подготвям справка…')).toBeInTheDocument();
  });

  it('shows a failure line when the report could not be composed', () => {
    render(<AssistantTranscript messages={[failedReportMessage('5')]} busy={false} />);

    expect(screen.getByText('Справката не можа да бъде съставена.')).toBeInTheDocument();
  });

  it('shows the no-answer fallback when a settled turn made tool calls but no report', () => {
    render(<AssistantTranscript messages={[toolOnlyMessage('6')]} busy={false} />);

    expect(screen.getByText(NO_ANSWER)).toBeInTheDocument();
  });

  it('does NOT show the fallback while the turn is still streaming', () => {
    render(<AssistantTranscript messages={[toolOnlyMessage('7')]} busy={true} />);

    expect(screen.queryByText(NO_ANSWER)).not.toBeInTheDocument();
  });

  it('does NOT show the fallback for a completed report turn', () => {
    render(<AssistantTranscript messages={[reportMessage('8')]} busy={false} />);

    expect(screen.queryByText(NO_ANSWER)).not.toBeInTheDocument();
  });
});
