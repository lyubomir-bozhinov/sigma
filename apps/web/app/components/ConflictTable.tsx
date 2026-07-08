import { useId, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { count, money } from '@sigma/shared';
import type { ConflictContract, ConflictLink, LinkContracts } from '@sigma/api-contract';
import { Chip, ExternalEikLink } from './ui';
import {
  companyProfileHref,
  contractHref,
  contractYear,
  contractYearsLabel,
  contractsCountLabel,
  fundsCellLabel,
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
            <th scope="col" className="num">
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

  return (
    <>
      <tr>
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
              <Chip>от собствената институция</Chip>
            </>
          )}
          {l.contemporaneous && (
            <>
              {' '}
              <Chip>към момента на договор</Chip>
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
          <span className="count-value">{contractsCountLabel(l)}</span>
          {l.contractCount > 0 && (
            <button
              type="button"
              className="row-toggle"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={toggle}
            >
              <span className="row-toggle-icon" aria-hidden="true" />
              {open ? 'скрий договорите' : 'виж договорите'}
            </button>
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
              <ContractList contracts={fetcher.data?.contracts ?? []} />
            )}
          </td>
        </tr>
      )}
    </>
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
