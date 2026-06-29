import { Link } from 'react-router';
import type { Route } from './+types/reports';

interface ReportSummary {
  id: string;
  title: string;
  question: string;
  createdAt: string;
}

export function meta() {
  return [{ title: 'AI справки — СИГМА' }, { name: 'robots', content: 'noindex' }];
}

export function headers() {
  return { 'Cache-Control': 'no-store' };
}

function keyToId(key: string) {
  return key.replace(/^report\//, '').replace(/\.json$/, '');
}

export async function loader({ context }: Route.LoaderArgs): Promise<{ reports: ReportSummary[]; truncated: boolean }> {
  const bucket = context.cloudflare.env.REPORTS;
  if (!bucket) return { reports: [], truncated: false };

  // include: ['customMetadata'] is required — R2 list() omits metadata fields without it.
  const listed = await bucket.list({ prefix: 'report/', limit: 50, include: ['customMetadata'] }).catch(() => null);
  if (!listed || listed.objects.length === 0) return { reports: [], truncated: false };

  // Separate objects that already carry metadata from those that need a full fetch.
  const hasMetadata = listed.objects.filter((o) => o.customMetadata?.title);
  const needsFetch = listed.objects
    .filter((o) => !o.customMetadata?.title)
    .slice(0, 30); // cap parallel fetches for old reports without stored metadata

  const fromMeta: ReportSummary[] = hasMetadata.map((obj) => ({
    id: keyToId(obj.key),
    title: obj.customMetadata!.title,
    question: obj.customMetadata!.question ?? '',
    createdAt: obj.customMetadata!.createdAt ?? obj.uploaded.toISOString(),
  }));

  const fromJson: ReportSummary[] = (
    await Promise.all(
      needsFetch.map(async (obj) => {
        const id = keyToId(obj.key);
        try {
          const body = await bucket.get(obj.key);
          if (!body) return null;
          const data = (await body.json()) as {
            report?: { title?: string };
            provenance?: { question?: string };
            createdAt?: string;
          };
          return {
            id,
            title: data?.report?.title || id,
            question: data?.provenance?.question ?? '',
            createdAt: data?.createdAt ?? obj.uploaded.toISOString(),
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((r): r is ReportSummary => r !== null);

  const reports = [...fromMeta, ...fromJson].sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0,
  );

  return { reports, truncated: listed.truncated };
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  try {
    return d.toLocaleDateString('bg-BG', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString('bg-BG', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function ReportsIndexPage({ loaderData }: Route.ComponentProps) {
  const { reports, truncated } = loaderData;

  return (
    <main id="main" className="reports-index">
      <header className="reports-index__header">
        <p className="reports-index__eyebrow">AI справки</p>
        <h1 className="reports-index__title">Генерирани справки</h1>
        <p className="reports-index__description">
          Справките са съставени автоматично от езиков модел и не представляват официални документи.
          Проверявайте критични числа от първичен источник.
        </p>
      </header>

      {reports.length === 0 ? (
        <div className="reports-index__empty">
          <p>Няма генерирани справки.</p>
          <p>
            Задайте въпрос в{' '}
            <Link to="/" className="reports-index__empty-link">
              асистента
            </Link>{' '}
            и справката ще се появи тук.
          </p>
        </div>
      ) : (
        <ol className="reports-list">
          {reports.map((r) => (
            <li key={r.id} className="reports-list__item">
              <Link to={`/reports/${r.id}`} className="reports-list__link">
                <span className="reports-list__title">{r.title}</span>
                {r.question && r.question !== r.title && (
                  <span className="reports-list__question">{r.question}</span>
                )}
              </Link>
              <time className="reports-list__date" dateTime={r.createdAt}>
                {fmtDate(r.createdAt)}
                {' · '}
                {fmtTime(r.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
      {truncated && (
        <p className="reports-index__truncated">
          Показани са само последните 50 справки.
        </p>
      )}
    </main>
  );
}
