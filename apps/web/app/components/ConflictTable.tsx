import { useId, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { count, money } from '@sigma/shared';
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

// Declarative table of declared ownership links. All branching lives in ../lib/conflicts (tested); this
// only emits markup. `omit` drops the redundant column on a single-subject page (an office-holder's own
// page omits the office-holder column; a winner's page omits the company column). Responsive card layout
// via `tbl-cards` + data-label, matching the company/authority tables. The „Договори"/„Публични средства"
// columns show the CONTEMPORANEOUS split (contracts signed during the declared stake), and each row can
// expand to the actual contract list — fetched on demand so the leaderboard payload stays lean.
export function ConflictTable({
  links,
  caption,
  omit,
  startRank = 0,
}: {
  links: ConflictLink[];
  caption: string;
  omit?: 'official' | 'company';
  // Rank of the row BEFORE the first shown (paginated leaderboards); 0 on unpaginated per-entity views.
  startRank?: number;
}) {
  // #, интерес, Договори, Публични средства, Период, Източник = 6, plus официал + компания unless omitted.
  const columnCount = 8 - (omit ? 1 : 0);
  return (
    <div className="table-wrap tbl-cards">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            {omit !== 'official' && <th scope="col">Длъжностно лице</th>}
            {omit !== 'company' && <th scope="col">Компания</th>}
            <th scope="col">Деклариран интерес</th>
            <th scope="col" className="num">
              Договори
            </th>
            <th scope="col" className="num funds-head">
              Публични средства (€)
            </th>
            <th scope="col">Период</th>
            <th scope="col">Източник</th>
          </tr>
        </thead>
        <tbody>
          {links.map((l, i) => (
            <ConflictRow
              key={l.linkKey}
              link={l}
              rank={startRank + i + 1}
              omit={omit}
              columnCount={columnCount}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConflictRow({
  link: l,
  rank,
  omit,
  columnCount,
}: {
  link: ConflictLink;
  rank: number;
  omit?: 'official' | 'company';
  columnCount: number;
}) {
  const fetcher = useFetcher<LinkContracts>();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const funds = fundsCellLabel(l);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Lazy-load once: the contract list is fetched the first time the row is opened, then cached by the row.
    if (next && fetcher.state === 'idle' && !fetcher.data) fetcher.load(linkContractsHref(l));
  }

  const conflict = hasContemporaneousContracts(l);

  return (
    <>
      <tr className={conflict ? 'has-conflict' : undefined}>
        <td className="rank cell-rank" data-label="#">
          {rank}
        </td>
        {omit !== 'official' && (
          <td className="cell-title" data-label="Длъжностно лице">
            <Link to={officialHref(l.officialSlug)}>{l.official}</Link>
          </td>
        )}
        {omit !== 'company' && (
          <td className="cell-title" data-label="Компания">
            <Link to={companyProfileHref(l.eik)}>{l.company}</Link>
            <ExternalEikLink eik={l.eik} />
          </td>
        )}
        <td className="cell-prose" data-label="Деклариран интерес">
          {relationLabel(l.relation)}
          {l.ownInstitution && (
            <>
              {' '}
              <Chip tone="strong">от собствената институция</Chip>
            </>
          )}
          {l.contemporaneous && (
            <>
              {' '}
              <Chip tone="window">към момента на договор</Chip>
            </>
          )}
          {(l.firstDeclaredYear || l.lastDeclaredYear) && (
            <>
              {' '}
              <div className="small muted">
                деклариран {contractYearsLabel(l.firstDeclaredYear, l.lastDeclaredYear)} г.
              </div>
            </>
          )}
        </td>
        <td className="num cell-count" data-label="Договори">
          {l.contractCount > 0 ? (
            <button
              type="button"
              className="count-toggle"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={open ? 'Скрий договорите' : 'Виж договорите'}
              onClick={toggle}
            >
              <span className="count-value">{contractsCountLabel(l)}</span>
              <span className="row-toggle-icon" aria-hidden="true" />
            </button>
          ) : (
            <span className="count-value">{contractsCountLabel(l)}</span>
          )}
        </td>
        <td className="money" data-label="Публични средства (€)">
          {funds.total ? (
            <span className="funds-split">
              <span className="funds-primary" title="по договори в момент на деклариран дял">
                {funds.primary}
              </span>
              <span className="small muted">от {funds.total} общо</span>
            </span>
          ) : (
            funds.primary
          )}
        </td>
        <td data-label="Период">{contractYearsLabel(l.firstContractYear, l.lastContractYear)}</td>
        <td data-label="Източник">
          {l.sourceUrl ? (
            <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer">
              декларация
            </a>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="row-detail">
          <td className="cell-detail" colSpan={columnCount} id={panelId}>
            {fetcher.state === 'loading' && !fetcher.data ? (
              <p className="muted small m-0">Зареждане на договорите…</p>
            ) : (
              <CaseDetail link={l} contracts={fetcher.data?.contracts ?? []} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// The expanded case: a magnitude bar (how much of the money moved while the stake was declared) and a
// timeline that places each contract against the declared-stake window, above the in-window/outside list.
function CaseDetail({ link: l, contracts }: { link: ConflictLink; contracts: ConflictContract[] }) {
  const mag = fundsMagnitude(l);
  const funds = fundsCellLabel(l);
  return (
    <div className="case-detail">
      {mag != null && funds.total && (
        <div className="case-mag">
          <span className="case-mag-label">В момент на деклариран дял</span>
          <ShareBar ratio={mag} warn />
          <span className="case-mag-figures">
            <strong>{funds.primary}</strong> от {funds.total} общо
          </span>
        </div>
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
  // Narrow both edges inline: TS loses the narrowing if it's hidden behind an intermediate boolean.
  const ws = tl.windowStartPct;
  const we = tl.windowEndPct;
  const hasBand = ws != null && we != null;
  const bandLeft = ws != null && we != null ? Math.min(ws, we) : 0;
  const bandWidth = ws != null && we != null ? Math.abs(we - ws) : 0;
  const maxStack = tl.marks.reduce((m, k) => Math.max(m, k.stackIndex), 0);
  const singleYear = tl.minYear === tl.maxYear;
  return (
    <div className="tl">
      <p className="tl-title">
        Времева ос · дял {contractYearsLabel(l.firstDeclaredYear, l.lastDeclaredYear)} г. срещу
        договори
      </p>
      <div
        className="tl-track"
        style={{ height: `${34 + (maxStack + 1) * 14}px` }}
        role="img"
        aria-label={`${count(inCount)} от ${count(tl.marks.length)} датирани договора са сключени в периода на декларирания дял`}
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
    </div>
  );
}

function ContractList({ contracts }: { contracts: ConflictContract[] }) {
  if (contracts.length === 0) return <p className="muted small m-0">Няма намерени договори.</p>;
  const { inConflict, outside } = partitionContracts(contracts);
  return (
    <div className="contract-detail">
      {inConflict.length > 0 ? (
        <>
          <p className="small m-0">
            <strong>
              Договори, сключени в момент на деклариран дял ({count(inConflict.length)})
            </strong>
          </p>
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
    </div>
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
