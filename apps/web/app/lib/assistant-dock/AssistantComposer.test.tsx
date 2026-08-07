import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantComposer, appendTranscript } from './AssistantComposer';

// Drive the voice hook deterministically: capture the composer's onTranscript so a test can land a
// transcript without a real mic (jsdom has no getUserMedia/MediaRecorder). State stays 'idle' so the
// mic renders in its resting form — exactly what these composer-layout tests need.
const voiceMock = vi.hoisted(() => ({ latest: null as ((text: string) => void) | null }));
vi.mock('./useVoiceInput', () => ({
  useVoiceInput: (onTranscript: (text: string) => void) => {
    voiceMock.latest = onTranscript;
    return {
      state: { status: 'idle' as const },
      startedAt: null,
      endingSoon: false,
      start: () => {},
      stop: () => {},
    };
  },
}));

/** Simulate a finished voice transcript landing in the draft (sets text + the transcript-ready cue). */
const landTranscript = (text: string) => act(() => voiceMock.latest?.(text));

afterEach(() => {
  cleanup();
  voiceMock.latest = null;
});

const noop = () => {};

describe('AssistantComposer', () => {
  it('sends the trimmed text on Enter and clears the field', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<AssistantComposer onSend={onSend} onStop={noop} busy={false} />);
    const input = screen.getByLabelText('Съобщение до асистента');

    await user.type(input, '  здравей  {Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('здравей');
    expect(input).toHaveValue('');
  });

  it('inserts a newline on Shift+Enter without sending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<AssistantComposer onSend={onSend} onStop={noop} busy={false} />);
    const input = screen.getByLabelText('Съобщение до асистента');

    await user.type(input, 'ред1{Shift>}{Enter}{/Shift}ред2');

    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue('ред1\nред2');
  });

  it('marks send inert but keeps it focusable when the field is empty', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);
    const send = screen.getByRole('button', { name: 'Изпрати' });

    // aria-disabled, NOT the disabled attr — the control stays in the tab order so a keyboard/AT user
    // can still discover it (WCAG: don't remove the primary action from focus just because it's inert).
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).not.toBeDisabled();
    send.focus();
    expect(send).toHaveFocus();
  });

  it('does not send from an empty draft even though Send is reachable', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<AssistantComposer onSend={onSend} onStop={noop} busy={false} />);

    await user.click(screen.getByRole('button', { name: 'Изпрати' }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('makes the input read-only (not disabled) while busy', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={true} />);
    const input = screen.getByLabelText('Съобщение до асистента');

    // readOnly + aria-disabled blocks edits while keeping the textarea focusable, so Enter-to-send
    // never drops the keyboard user to <body>. The disabled attr would eject focus.
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveAttribute('aria-disabled', 'true');
    expect(input).not.toBeDisabled();
  });

  it('keeps focus in the textarea when the turn goes busy after send', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const { rerender } = render(<AssistantComposer onSend={onSend} onStop={noop} busy={false} />);
    const input = screen.getByLabelText('Съобщение до асистента');

    await user.type(input, 'въпрос{Enter}');
    expect(onSend).toHaveBeenCalledWith('въпрос');

    // The parent flips busy=true for the in-flight turn — focus must stay in the composer.
    rerender(<AssistantComposer onSend={onSend} onStop={noop} busy={true} />);
    expect(input).toHaveFocus();
  });

  it('moves focus to Stop when the turn goes busy while Send held focus', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const { rerender } = render(<AssistantComposer onSend={onSend} onStop={noop} busy={false} />);

    // Activate via the Send button (mouse or keyboard on Send) rather than Enter-in-textarea, so focus is
    // on Send when it unmounts into Stop. Without focus redirection it would fall to <body>.
    await user.type(screen.getByLabelText('Съобщение до асистента'), 'въпрос');
    const send = screen.getByRole('button', { name: 'Изпрати' });
    send.focus();
    await user.click(send);

    rerender(<AssistantComposer onSend={onSend} onStop={noop} busy={true} />);
    expect(screen.getByRole('button', { name: 'Спри' })).toHaveFocus();
  });

  it('shows the Stop button while busy', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={true} />);

    expect(screen.getByRole('button', { name: 'Спри' })).toBeInTheDocument();
  });

  it('hides the Send button while busy', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={true} />);

    expect(screen.queryByRole('button', { name: 'Изпрати' })).not.toBeInTheDocument();
  });

  it('calls onStop when Stop is clicked', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<AssistantComposer onSend={noop} onStop={onStop} busy={true} />);

    await user.click(screen.getByRole('button', { name: 'Спри' }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('renders an enabled mic toggle with an accessible name', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);

    const mic = screen.getByRole('button', { name: 'Гласово въвеждане' });
    expect(mic).toBeEnabled();
    expect(mic).toHaveAttribute('aria-pressed', 'false');
  });

  it('exposes a polite status region for voice announcements', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);

    // Distinct from the transcript's log region; empty at rest but present so aria-live can announce.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('hides the Clear button while the draft is empty', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);

    expect(screen.queryByRole('button', { name: 'Изчисти' })).not.toBeInTheDocument();
  });

  it('does not show Clear for a typed draft (only after a voice transcript)', async () => {
    const user = userEvent.setup();
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);

    // Typists have ⌘A⌫; Clear exists to restart a bad dictation, so typing alone must not surface it.
    await user.type(screen.getByLabelText('Съобщение до асистента'), 'ръчно написан текст');

    expect(screen.queryByRole('button', { name: 'Изчисти' })).not.toBeInTheDocument();
  });

  it('shows Clear once a voice transcript lands and empties the draft on click', async () => {
    const user = userEvent.setup();
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);
    const input = screen.getByLabelText('Съобщение до асистента');

    landTranscript('транскрибиран текст');
    expect(input).toHaveValue('транскрибиран текст');

    await user.click(screen.getByRole('button', { name: 'Изчисти' }));

    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Изчисти' })).not.toBeInTheDocument();
  });

  it('keeps the textarea usable when NOT in a chat turn (never a dead mic)', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);

    // Voice state must never disable the textarea — a user who can't use the mic can always type.
    expect(screen.getByLabelText('Съобщение до асистента')).toBeEnabled();
  });

  it('wraps the input and controls in a single focus-within box', () => {
    const { container } = render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);
    const box = container.querySelector('.assistant-composer__box');

    // The unified surface must contain both the textarea and its control row (one accent focus ring).
    expect(box).not.toBeNull();
    expect(box?.querySelector('.assistant-composer__input')).not.toBeNull();
    expect(box?.querySelector('.assistant-composer__actions')).not.toBeNull();
  });

  it('renders Send as an icon-only button (name via aria-label, glyph via svg)', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);
    const send = screen.getByRole('button', { name: 'Изпрати' });

    // Icon-first: accessible name comes from aria-label, so there is no visible text label.
    expect(send).toHaveTextContent('');
    expect(send.querySelector('svg')).not.toBeNull();
  });

  it('renders Stop as an icon-only button', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={true} />);
    const stop = screen.getByRole('button', { name: 'Спри' });

    expect(stop).toHaveTextContent('');
    expect(stop.querySelector('svg')).not.toBeNull();
  });

  it('renders Clear as an icon-only button', () => {
    render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);
    landTranscript('глас');
    const clear = screen.getByRole('button', { name: 'Изчисти' });

    expect(clear).toHaveTextContent('');
    expect(clear.querySelector('svg')).not.toBeNull();
  });

  it('orders the cluster Clear → mic → Send so mic and Send stay adjacent', () => {
    const { container } = render(<AssistantComposer onSend={noop} onStop={noop} busy={false} />);
    landTranscript('глас'); // Clear only exists after a transcript

    const actions = container.querySelector('.assistant-composer__actions');
    const labels = Array.from(actions?.querySelectorAll('button') ?? []).map((b) =>
      b.getAttribute('aria-label'),
    );

    // Clear grows in on the left; mic and Send remain the last two, always adjacent (no layout hop).
    expect(labels).toEqual(['Изчисти', 'Гласово въвеждане', 'Изпрати']);
  });
});

describe('appendTranscript', () => {
  it('returns the transcript alone when the draft is empty', () => {
    expect(appendTranscript('', 'здравей')).toBe('здравей');
  });

  it('joins with a single space when the draft has no trailing whitespace', () => {
    expect(appendTranscript('купи', 'хляб')).toBe('купи хляб');
  });

  it('adds no extra space when the draft already ends in a space', () => {
    expect(appendTranscript('купи ', 'хляб')).toBe('купи хляб');
  });

  it('appends directly after a trailing newline', () => {
    expect(appendTranscript('ред1\n', 'ред2')).toBe('ред1\nред2');
  });
});
