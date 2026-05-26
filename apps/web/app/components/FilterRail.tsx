import { Form, Link, useSubmit } from 'react-router';
import { count as fmtCount } from '@sigma/shared';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterGroup {
  key: string; // URL param name (also the input `name`)
  label: string;
  type: 'checkbox' | 'radio';
  options: FilterOption[];
  selected: string[];
  open?: boolean;
  allLabel?: string; // radio groups: the „Всички" (clear) option label
  more?: { href: string; label: string };
}

// Sticky filter rail. Filters live in the URL (shareable). A `<Form method="get">` auto-submits on
// change when JS is on (instant filtering) and still works via the visible button without JS. The
// current `sort` is preserved through a hidden field; `cursor`/`page` are intentionally omitted so a
// new filter resets to page 1.
export function FilterRail({
  groups,
  sort,
  clearHref,
  csvHref,
}: {
  groups: FilterGroup[];
  sort: string;
  clearHref: string;
  csvHref?: string;
}) {
  const submit = useSubmit();
  return (
    <aside aria-label="Филтри">
      <Form method="get" onChange={(e) => submit(e.currentTarget)}>
        <input type="hidden" name="sort" value={sort} />
        {groups.map((g) => (
          <details className="filter-group" key={g.key} open={g.open}>
            <summary>{g.label}</summary>
            {g.type === 'radio' && (
              <label className="check">
                <input
                  type="radio"
                  name={g.key}
                  value=""
                  checked={g.selected.length === 0}
                  onChange={() => {}}
                />{' '}
                {g.allLabel ?? 'Всички'}
              </label>
            )}
            {g.options.map((o) => (
              <label className="check" key={o.value}>
                <input
                  type={g.type}
                  name={g.key}
                  value={o.value}
                  checked={g.selected.includes(o.value)}
                  onChange={() => {}}
                />{' '}
                {o.label}
                {o.count != null && <span className="muted small">{fmtCount(o.count)}</span>}
              </label>
            ))}
            {g.more && (
              <p className="small muted" style={{ marginTop: 'var(--s-2)' }}>
                <Link to={g.more.href}>{g.more.label} →</Link>
              </p>
            )}
          </details>
        ))}
        <noscript>
          <button type="submit" className="filter-apply">
            Покажи резултатите
          </button>
        </noscript>
        <p className="small muted" style={{ marginTop: 'var(--s-4)' }}>
          <Link to={clearHref}>Изчисти филтрите</Link>
          {csvHref && (
            <>
              {' · '}
              <a href={csvHref}>Изтегли CSV</a>
            </>
          )}
        </p>
      </Form>
    </aside>
  );
}
