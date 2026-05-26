import type { ReactNode } from 'react';
import { pct } from '@sigma/shared';

// Small editorial primitives shared across pages. Class definitions live in app.css (ported verbatim
// from the mock); these just emit the markup.

export function Chip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}

export function Flag({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: 'soft' | 'info' | 'neutral';
}) {
  return <span className={`flag${variant ? ` ${variant}` : ''}`}>{children}</span>;
}

// Inline percentage bar. `warn` paints the fill in the accent red (e.g. a dominant share).
export function ShareBar({ ratio, warn }: { ratio: number; warn?: boolean }) {
  const width = `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%`;
  return (
    <span className="share">
      <span className={`share-bar${warn ? ' warn' : ''}`}>
        <i style={{ width }} />
      </span>
      <span className="share-num">{pct(ratio)}</span>
    </span>
  );
}

export function Callout({
  title,
  variant,
  children,
}: {
  title?: ReactNode;
  variant?: 'warning';
  children: ReactNode;
}) {
  return (
    <div className={`callout${variant ? ` ${variant}` : ''}`}>
      {title != null && <h3>{title}</h3>}
      {children}
    </div>
  );
}

// A titled content section (ink-rule h2 + optional hint). The title may carry an <em> accent.
export function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {hint != null && <p className="section-hint">{hint}</p>}
      {children}
    </section>
  );
}

// Inline source/citation line (mono, soft ink).
export function SourceLine({ children }: { children: ReactNode }) {
  return <p className="source">{children}</p>;
}
