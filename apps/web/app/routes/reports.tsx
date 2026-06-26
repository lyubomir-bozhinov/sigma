// /reports — index of AI-generated reports stored in this browser's localStorage transcript.
// SSR renders an empty shell; the client fills it on mount (server is stateless per spec §5).

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { loadTranscript } from '../lib/assistant-dock/storage';
import { reportOutputFromMessage } from '../lib/assistant-dock/report-projection';

interface ReportRef {
  id: string;   // UIMessage.id — used as /reports/:id param
  title: string;
}

function extractReportRefs(): ReportRef[] {
  const messages = loadTranscript();
  const refs: ReportRef[] = [];
  const seen = new Set<string>();

  // Newest first (reverse iteration), deduplicated by message id.
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'assistant') continue;
    const output = reportOutputFromMessage(message);
    if (!output?.ok) continue;
    if (!seen.has(message.id)) {
      seen.add(message.id);
      refs.push({ id: message.id, title: output.report.title });
    }
  }

  return refs;
}

function ReportsClient() {
  const [refs, setRefs] = useState<ReportRef[]>([]);

  useEffect(() => {
    setRefs(extractReportRefs());
  }, []);

  if (refs.length === 0) {
    return (
      <p className="muted">
        Нямате генерирани справки в този браузър. Задайте въпрос на AI асистента, за да създадете
        първата си справка.
      </p>
    );
  }

  return (
    <div className="table-wrap tbl-cards reports-index">
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Справка</th>
          </tr>
        </thead>
        <tbody>
          {refs.map((r, i) => (
            <tr key={r.id}>
              <td className="rank cell-rank" data-label="#">{i + 1}</td>
              <td className="cell-title" data-label="Справка">
                <Link to={`/reports/${r.id}`}>{r.title}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function meta() {
  return [
    { title: 'Моите справки — СИГМА' },
    { name: 'robots', content: 'noindex' },
  ];
}

export default function ReportsIndex() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main id="main">
      <PageHeader
        kicker="AI Асистент"
        title="Моите справки"
        lede="Справки, генерирани от AI асистента в този браузър."
      />
      {mounted ? <ReportsClient /> : null}
    </main>
  );
}
