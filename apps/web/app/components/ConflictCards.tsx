import { useId, useRef, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { count, money, plural } from '@sigma/shared';
import type { ConflictContract, ConflictLink, LinkContracts } from '@sigma/api-contract';
import { Chip, ExternalEikLink, ShareBar } from './ui';
import {
  companyProfileHref,
  contractHref,
  contractTimeline,
  contractYear,
  contractYearsLabel,
  contractsCountLabel,
  fundsCellLabel,
  fundsMagnitude,
  hasContemporaneousContracts,
  linkContractsHref,
  officialHref,
  partitionContracts,
  relationLabel,
  temporalLabel,
} from '../lib/conflicts';

// Свързани лица — a ranked, paginated list of declared-ownership CASE-CARDS (not a table). All branching
// lives in ../lib/conflicts (tested); this only emits markup. `omit` drops the redundant party on a
// single-subject page (an office-holder's own page omits the office-holder; a winner's page omits the
// company). Each card carries identity + a signal strip and expands to a lazily-fetched case detail
// (magnitude bar, timeline, contract list) — fetched on demand so the leaderboard payload stays lean.
export function ConflictCards({
  links,
  caption,
  omit,
  startRank = 0,
  totalCount,
}: {
  links: ConflictLink[];
  caption: string;
  omit?: 'official' | 'company';
  // Rank of the row BEFORE the first shown (paginated leaderboards); 0 on unpaginated per-entity views.
  startRank?: number;
  // Total across ALL pages, for aria-setsize (so AT announces global rank though the DOM holds one page).
  // Defaults to the shown count — correct on the unpaginated per-entity views; pass the full count when paginating.
  totalCount?: number;
}) {
  const setSize = totalCount ?? links.length;
  return (
    <ol className="conflict-cards" role="list" aria-label={caption}>
      {links.map((l, i) => (
        <ConflictCard
          key={l.linkKey}
          link={l}
          rank={startRank + i + 1}
          setSize={setSize}
          omit={omit}
        />
      ))}
    </ol>
  );
}

function ConflictCard({
  link: l,
  rank,
  setSize,
  omit,
}: {
  link: ConflictLink;
  rank: number;
  setSize: number;
  omit?: 'official' | 'company';
}) {
  const fetcher = useFetcher<LinkContracts>();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panelId = useId();
  const funds = fundsCellLabel(l);
  const conflict = hasContemporaneousContracts(l);
  const loaded = fetcher.data != null;
  // Guards a double-fetch from a rapid re-toggle before React commits (fetcher.state is a stale closure
  // read), and lets us tell "never opened" (null) from "opened but the load failed" (retry affordance).
  const requested = useRef(false);

  function load() {
    requested.current = true;
    fetcher.load(linkContractsHref(l));
  }
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !requested.current) load(); // lazy-load once; cached by the card thereafter
  }

  // Names the expanded region so several open cards on one page stay distinguishable to screen readers.
  const subject =
    omit === 'official'
      ? l.company
      : omit === 'company'
        ? l.official
        : `${l.official} / ${l.company}`;

  return (
    <li aria-posinset={rank} aria-setsize={setSize}>
      <article
        className={`conflict-card${conflict ? ' has-conflict' : ''}`}
        aria-labelledby={titleId}
      >
        <span className="cc-rank" aria-hidden="true">
          № {rank}
        </span>

        <h3 id={titleId} className="cc-title">
          {omit !== 'official' && <Link to={officialHref(l.officialSlug)}>{l.official}</Link>}
          {omit !== 'official' && omit !== 'company' && (
            <span className="cc-arrow" aria-hidden="true">
              →
            </span>
          )}
          {omit !== 'company' && (
            <>
              <Link to={companyProfileHref(l.eik)}>{l.company}</Link>
              <ExternalEikLink eik={l.eik} />
            </>
          )}
        </h3>

        <div className="cc-interest">
          <span>{relationLabel(l.relation)}</span>
          {l.ownInstitution && <Chip tone="strong">от собствената институция</Chip>}
          {l.contemporaneous && <Chip tone="window">към момента на договор</Chip>}
          {(l.firstDeclaredYear || l.lastDeclaredYear) && (
            <span className="small muted">
              деклариран {contractYearsLabel(l.firstDeclaredYear, l.lastDeclaredYear)} г.
            </span>
          )}
        </div>

        <dl className="cc-stats">
          <div className="cc-stat">
            <dt>Договори</dt>
            <dd>{contractsCountLabel(l)}</dd>
          </div>
          <div className="cc-stat">
            <dt>Публични средства</dt>
            <dd>
              <span className="cc-funds-primary" title="по договори в момент на деклариран дял">
                {funds.primary}
              </span>
              {funds.total && <span className="cc-funds-total">от {funds.total} общо</span>}
            </dd>
          </div>
          <div className="cc-stat">
            <dt>Период</dt>
            <dd>{contractYearsLabel(l.firstContractYear, l.lastContractYear)}</dd>
          </div>
          <div className="cc-stat">
            <dt>Източник</dt>
            <dd>
              {l.sourceUrl ? (
                <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer">
                  декларация
                </a>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
          </div>
        </dl>

        {l.contractCount > 0 && (
          <>
            <div className="cc-footer">
              <button
                type="button"
                className="cc-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={toggle}
              >
                {open ? 'Скрий договорите' : 'Виж договорите'}
                <span className="cc-chevron" aria-hidden="true" />
              </button>
            </div>
            <div className="cc-disclosure" data-open={open}>
              <div className="cc-disclosure-inner">
                <div
                  id={panelId}
                  role="region"
                  aria-label={`Договори — ${subject}`}
                  aria-live="polite"
                  className="cc-panel"
                  inert={!open}
                  data-state={loaded ? 'loaded' : 'loading'}
                >
                  {fetcher.data ? (
                    <CaseDetail link={l} contracts={fetcher.data.contracts} />
                  ) : fetcher.state === 'loading' ? (
                    <p className="muted small m-0">Зареждане на договорите…</p>
                  ) : requested.current ? (
                    <p className="muted small m-0">
                      Договорите не се заредиха.{' '}
                      <button type="button" className="cc-retry" onClick={load}>
                        Опитай отново
                      </button>
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </article>
    </li>
  );
}

// The expanded case, in three headed sub-sections: the magnitude bar (how much of the money moved while the
// stake was declared), a timeline placing each contract against the declared window, and the contract list.
function CaseDetail({ link: l, contracts }: { link: ConflictLink; contracts: ConflictContract[] }) {
  const mag = fundsMagnitude(l);
  const funds = fundsCellLabel(l);
  return (
    <div className="cc-case">
      {mag != null && funds.total && (
        <section className="cc-section">
          <h4 className="cc-section-title">В момент на деклариран дял</h4>
          <div className="case-mag">
            <ShareBar ratio={mag} warn />
            <span className="case-mag-figures">
              <strong>{funds.primary}</strong> от {funds.total} общо
            </span>
          </div>
        </section>
      )}
      <Timeline link={l} contracts={contracts} />
      <ContractList contracts={contracts} />
    </div>
  );
}

// Contracts as dots on a year axis, the declared-stake window as a shaded band. Renders only when at least
// one contract is dated (contractTimeline returns null otherwise) — the list below still covers undated ones.
function Timeline({ link: l, contracts }: { link: ConflictLink; contracts: ConflictContract[] }) {
  const tl = contractTimeline(l, contracts);
  if (!tl) return null;
  const inCount = tl.marks.filter((m) => m.inWindow).length;
  const dated = tl.marks.length;
  // Agree the noun + verb with the count — „1 датиран договор е сключен" vs „17 датирани договора са сключени".
  const datedNoun = plural(dated, 'датиран договор', 'датирани договора');
  const datedVerb = plural(dated, 'е сключен', 'са сключени');
  // Narrow both edges inline: TS loses the narrowing if it's hidden behind an intermediate boolean.
  const ws = tl.windowStartPct;
  const we = tl.windowEndPct;
  const hasBand = ws != null && we != null;
  const bandLeft = ws != null && we != null ? Math.min(ws, we) : 0;
  const bandWidth = ws != null && we != null ? Math.abs(we - ws) : 0;
  const maxStack = tl.marks.reduce((m, k) => Math.max(m, k.stackIndex), 0);
  const singleYear = tl.minYear === tl.maxYear;
  return (
    <section className="cc-section">
      <h4 className="cc-section-title">
        Времева ос · дял {contractYearsLabel(l.firstDeclaredYear, l.lastDeclaredYear)} г. срещу
        договори
      </h4>
      <div
        className="tl-track"
        style={{ height: `${34 + (maxStack + 1) * 14}px` }}
        role="img"
        aria-label={`${count(inCount)} от ${count(dated)} ${datedNoun} ${datedVerb} в периода на декларирания дял`}
      >
        <div className="tl-axis" />
        {hasBand && (
          <div className="tl-band" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
        )}
        {tl.marks.map((m) => (
          <span
            key={`${m.year}-${m.stackIndex}`}
            className={`tl-mark ${m.inWindow ? 'in' : 'out'}`}
            style={{ left: `${m.leftPct}%`, top: `${24 + m.stackIndex * 14}px` }}
            title={String(m.year)}
          />
        ))}
        {singleYear ? (
          <span className="tl-year tl-year-mid">{tl.minYear}</span>
        ) : (
          <>
            <span className="tl-year tl-year-start">{tl.minYear}</span>
            <span className="tl-year tl-year-end">{tl.maxYear}</span>
          </>
        )}
      </div>
      <p className="tl-legend">
        <span className="tl-dot in" aria-hidden="true" /> в периода на дела
        <span className="tl-sep">·</span>
        <span className="tl-dot out" aria-hidden="true" /> извън периода
      </p>
    </section>
  );
}

function ContractList({ contracts }: { contracts: ConflictContract[] }) {
  if (contracts.length === 0)
    return (
      <section className="cc-section">
        <p className="muted small m-0">Няма намерени договори.</p>
      </section>
    );
  const { inConflict, outside } = partitionContracts(contracts);
  return (
    <section className="cc-section">
      {inConflict.length > 0 ? (
        <>
          <h4 className="cc-section-title">
            Договори, сключени в момент на деклариран дял ({count(inConflict.length)})
          </h4>
          <ul className="contract-list">
            {inConflict.map((c, i) => (
              <ContractItem key={c.contractNumber ?? `in-${i}`} c={c} conflict />
            ))}
          </ul>
        </>
      ) : (
        <p className="small muted m-0">Няма договори, сключени в периода на декларирания дял.</p>
      )}
      {outside.length > 0 && (
        <details className="contract-outside">
          <summary className="small muted">Извън периода ({count(outside.length)})</summary>
          <ul className="contract-list">
            {outside.map((c, i) => (
              <ContractItem key={c.contractNumber ?? `out-${i}`} c={c} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ContractItem({ c, conflict = false }: { c: ConflictContract; conflict?: boolean }) {
  return (
    <li className={conflict ? 'contract-item contract-item-conflict' : 'contract-item'}>
      <span className="contract-year">{contractYear(c)}</span>
      <span className="contract-authority">{c.authority || '—'}</span>
      {c.contractKind && <span className="contract-kind">{c.contractKind}</span>}
      <Link to={contractHref(c)} className="contract-link">
        {c.contractNumber ? `№ ${c.contractNumber}` : 'договор'}
      </Link>
      <span className="contract-amt">{money(c.amountEur)}</span>
      {conflict ? (
        <Chip>в момент на дял</Chip>
      ) : (
        <span className="small muted">{temporalLabel(c.temporal)}</span>
      )}
    </li>
  );
}
