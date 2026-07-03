import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
    render(
      <AssistantTranscript messages={[userMessage('1', 'Здравейте')]} phase={null} busy={false} />,
    );

    expect(screen.getByText('Здравейте')).toBeInTheDocument();
  });

  it('renders a report chip for a finished report', () => {
    render(<AssistantTranscript messages={[reportMessage('2')]} phase={null} busy={false} />);

    expect(screen.getByText('Заглавие на справка')).toBeInTheDocument();
  });

  it('does not render a chip for a prose-only message', () => {
    render(
      <AssistantTranscript messages={[userMessage('3', 'само текст')]} phase={null} busy={false} />,
    );

    expect(screen.queryByText('Заглавие на справка')).not.toBeInTheDocument();
  });

  it('shows a failure line when the report could not be composed', () => {
    render(<AssistantTranscript messages={[failedReportMessage('5')]} phase={null} busy={false} />);

    expect(screen.getByText('Справката не можа да бъде съставена.')).toBeInTheDocument();
  });

  it('renders the phase line inside the aria-live log region', () => {
    render(
      <AssistantTranscript messages={[userMessage('6', 'въпрос')]} phase="querying" busy={false} />,
    );

    expect(within(screen.getByRole('log')).getByText('Търся в данните…')).toBeInTheDocument();
  });

  it('renders no phase line when idle', () => {
    render(
      <AssistantTranscript messages={[userMessage('7', 'въпрос')]} phase={null} busy={false} />,
    );

    expect(screen.queryByText('Търся в данните…')).not.toBeInTheDocument();
  });

  it('withholds a failed report result on the streaming message while busy', () => {
    render(
      <AssistantTranscript messages={[failedReportMessage('9')]} phase="composing" busy={true} />,
    );

    expect(screen.getByText('Съставям справка…')).toBeInTheDocument();
    expect(screen.queryByText('Справката не можа да бъде съставена.')).not.toBeInTheDocument();
  });

  // #31 fallback: the model's original emit_report is orphaned at input-available; the settled turn
  // still renders the chip from the output-available part, and #24's filter tags it via the phase line.
  it('renders the chip for a fallback report with an orphaned emit_report part', () => {
    const stuck = message('4c', 'assistant', [
      { type: 'tool-emit_report', state: 'input-available' },
      {
        type: 'tool-emit_report',
        state: 'output-available',
        output: {
          ok: true,
          report: {
            title: 'Справка по наличните данни',
            question: 'q',
            watermark: 'ai-generated',
            blocks: [{ type: 'totals', items: [{ label: 'Сума', value: 100, format: 'money' }] }],
          },
        },
      },
    ]);
    render(<AssistantTranscript messages={[stuck]} phase={null} busy={false} />);

    expect(screen.getByText('Справка по наличните данни')).toBeInTheDocument();
  });

  it('shows the failed report result once the turn settles', () => {
    render(
      <AssistantTranscript messages={[failedReportMessage('10')]} phase={null} busy={false} />,
    );

    expect(screen.getByText('Справката не можа да бъде съставена.')).toBeInTheDocument();
  });

  it('does NOT flash the failure line for an ok:false on the last turn while still busy (retry pending)', () => {
    // A first emit returns ok:false and the loop retries; the failure line must not flash before the
    // successful retry lands. While busy the phase line carries the state instead.
    render(
      <AssistantTranscript messages={[failedReportMessage('5b')]} phase="composing" busy={true} />,
    );

    expect(screen.queryByText('Справката не можа да бъде съставена.')).not.toBeInTheDocument();
  });

  it('still shows the failure line for an earlier settled turn while a new turn streams', () => {
    // An earlier turn that genuinely ended ok:false keeps its failure line even though a later turn is busy.
    render(
      <AssistantTranscript
        messages={[failedReportMessage('5c'), userMessage('5d', 'нов въпрос')]}
        phase="thinking"
        busy={true}
      />,
    );

    expect(screen.getByText('Справката не можа да бъде съставена.')).toBeInTheDocument();
  });

  it('shows the no-answer fallback when a settled turn made tool calls but no report', () => {
    render(<AssistantTranscript messages={[toolOnlyMessage('11')]} phase={null} busy={false} />);

    expect(screen.getByText(NO_ANSWER)).toBeInTheDocument();
  });

  it('does NOT show the fallback while the turn is still streaming', () => {
    render(<AssistantTranscript messages={[toolOnlyMessage('12')]} phase={null} busy={true} />);

    expect(screen.queryByText(NO_ANSWER)).not.toBeInTheDocument();
  });

  it('does NOT show the fallback for a completed report turn', () => {
    render(<AssistantTranscript messages={[reportMessage('13')]} phase={null} busy={false} />);

    expect(screen.queryByText(NO_ANSWER)).not.toBeInTheDocument();
  });
});
