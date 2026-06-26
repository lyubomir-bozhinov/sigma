import { Link } from 'react-router';

interface ReportChipProps {
  title: string;
  leadStat: string | null;
  /** Canonical report URL (`/reports/:id`). Absent until the report route + id land — then „Отвори" shows. */
  href?: string;
}

/**
 * Compact card for a finished report in the chat transcript: title + an „Отвори" link to the full
 * report. Use `projectChip` (report-projection) to build the props from the emit_report tool output.
 */
export const ReportChip = ({ title, leadStat, href }: ReportChipProps) => (
  <article className="report-chip">
    <h3 className="report-chip__title">{title}</h3>
    {leadStat !== null ? <p className="report-chip__stat">{leadStat}</p> : null}
    {href !== undefined ? (
      <Link className="report-chip__open" to={href}>
        Отвори
      </Link>
    ) : null}
  </article>
);
