import { Link } from 'react-router';
import { count, moneyBare } from '@sigma/shared';
import type { ConflictLink } from '@sigma/api-contract';
import { Chip, ExternalEikLink } from './ui';
import {
  companyProfileHref,
  contractYearsLabel,
  officialHref,
  relationLabel,
} from '../lib/conflicts';

// Declarative table of declared ownership links. All branching lives in ../lib/conflicts (tested); this
// only emits markup. `omit` drops the redundant column on a single-subject page (an office-holder's own
// page omits the office-holder column; a winner's page omits the company column). Responsive card layout
// via `tbl-cards` + data-label, matching the company/authority tables.
export function ConflictTable({
  links,
  caption,
  omit,
}: {
  links: ConflictLink[];
  caption: string;
  omit?: 'official' | 'company';
}) {
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
            <tr key={l.linkKey}>
              <td className="rank cell-rank" data-label="#">
                {i + 1}
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
              <td data-label="Деклариран интерес">
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
              <td className="money" data-label="Договори">
                {count(l.contractCount)}
              </td>
              <td className="money" data-label="Публични средства (€)">
                {moneyBare(l.contractValueEur)}
              </td>
              <td data-label="Период">
                {contractYearsLabel(l.firstContractYear, l.lastContractYear)}
              </td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
