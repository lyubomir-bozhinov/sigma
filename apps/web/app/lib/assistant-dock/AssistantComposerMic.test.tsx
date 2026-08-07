import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantComposerMic } from './AssistantComposerMic';
import type { VoiceInput, VoiceState } from './useVoiceInput';

afterEach(() => cleanup());

const fakeVoice = (state: VoiceState, over: Partial<VoiceInput> = {}): VoiceInput => ({
  state,
  startedAt: null,
  endingSoon: false,
  level: 0.4,
  start: vi.fn(),
  stop: vi.fn(),
  finishAndSend: vi.fn(),
  cancel: vi.fn(),
  ...over,
});

describe('AssistantComposerMic', () => {
  it('idle: an enabled toggle labelled "Гласово въвеждане", aria-pressed=false; click starts', async () => {
    const start = vi.fn();
    render(<AssistantComposerMic voice={fakeVoice({ status: 'idle' }, { start })} />);

    const button = screen.getByRole('button', { name: 'Гласово въвеждане' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('recording: labelled "Спри записа", aria-pressed=true; click stops', async () => {
    const stop = vi.fn();
    render(
      <AssistantComposerMic
        voice={fakeVoice({ status: 'recording' }, { stop, startedAt: 1000 })}
      />,
    );

    const button = screen.getByRole('button', { name: 'Спри записа' });
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(button);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('disables the toggle while transcribing (a transient state)', () => {
    render(<AssistantComposerMic voice={fakeVoice({ status: 'transcribing' })} />);

    expect(screen.getByRole('button', { name: 'Гласово въвеждане' })).toBeDisabled();
  });

  it('recording: shows a discard button that calls cancel (not stop)', async () => {
    const stop = vi.fn();
    const cancel = vi.fn();
    render(
      <AssistantComposerMic
        voice={fakeVoice({ status: 'recording' }, { stop, cancel, startedAt: 1000 })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Откажи записа' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it('recording: shows a finish-&-send button that calls finishAndSend (not stop)', async () => {
    const stop = vi.fn();
    const finishAndSend = vi.fn();
    render(
      <AssistantComposerMic
        voice={fakeVoice({ status: 'recording' }, { stop, finishAndSend, startedAt: 1000 })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Приключи и изпрати' }));
    expect(finishAndSend).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it('idle: no finish-&-send button (recording-only affordance)', () => {
    render(<AssistantComposerMic voice={fakeVoice({ status: 'idle' })} />);

    expect(screen.queryByRole('button', { name: 'Приключи и изпрати' })).not.toBeInTheDocument();
  });

  it('recording: orders the buttons discard → stop → send (stop beside send, discard away from it)', () => {
    const { container } = render(
      <AssistantComposerMic voice={fakeVoice({ status: 'recording' }, { startedAt: 1000 })} />,
    );

    const labels = Array.from(container.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Откажи записа', 'Спри записа', 'Приключи и изпрати']);
  });

  it('recording: the visualizer height tracks the live level via a CSS variable', () => {
    const { container } = render(
      <AssistantComposerMic
        voice={fakeVoice({ status: 'recording' }, { level: 0.8, startedAt: 1000 })}
      />,
    );

    const viz = container.querySelector<HTMLElement>('.assistant-composer__mic-viz');
    // The level is published as the --mic-level custom prop the bars scale from (reactive, not a fixed loop).
    expect(viz?.style.getPropertyValue('--mic-level')).toBe('0.8');
    expect(container.querySelectorAll('.assistant-composer__mic-bar')).toHaveLength(13);
  });

  it('idle: no discard button (cancel is a recording-only affordance)', () => {
    render(<AssistantComposerMic voice={fakeVoice({ status: 'idle' })} />);

    expect(screen.queryByRole('button', { name: 'Откажи записа' })).not.toBeInTheDocument();
  });
});
