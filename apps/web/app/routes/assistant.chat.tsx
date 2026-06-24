// Resource route — no default export (no UI).
// POST /assistant/chat — streaming AI chat endpoint.
//
// Uses Vercel AI SDK (ai + @ai-sdk/openai) pointed at BgGPT's OpenAI-compatible API.
// Tools: describe_schema, run_sql, search_entities, get_company, get_authority,
//        get_contract, emit_report.
// Security: SQL guard (sql-guard.ts), per-IP rate limit, read-only D1 access,
//           Zod-validated emit_report (invalid output → model retries).

import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import type { Route } from './+types/assistant.chat';
import { guardSql, truncateResult } from '../lib/assistant/sql-guard';
import { SCHEMA_DICT } from '../lib/assistant/schema-dict';
import { SYSTEM_PROMPT } from '../lib/assistant/system-prompt';
import { ReportArtifactSchema } from '../lib/assistant/report-schema';
import type { StoredReport } from '../lib/assistant/report-schema';

const BGGPT_BASE_URL = 'https://api.bggpt.ai/v1';
const MODEL_ID = 'bggpt-gemma-3-27b-fp8';

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;

  // ── Per-IP rate limit ────────────────────────────────────────────────────
  if (env.CHAT_RATE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.CHAT_RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return new Response(JSON.stringify({ error: 'Твърде много заявки. Опитайте след малко.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Parse request body ───────────────────────────────────────────────────
  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (!Array.isArray(body?.messages)) {
    return new Response('messages array required', { status: 400 });
  }

  const apiKey = env.BGGPT_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'AI асистентът не е конфигуриран на тази среда.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const maxSteps = Math.min(12, parseInt(env.ASSISTANT_MAX_STEPS ?? '6', 10));

  // ── BgGPT provider ───────────────────────────────────────────────────────
  const bggpt = createOpenAI({
    baseURL: BGGPT_BASE_URL,
    apiKey,
  });

  // ── Tools ────────────────────────────────────────────────────────────────

  const tools = {
    describe_schema: tool({
      description:
        'Returns the SIGMA database schema dictionary — tables, columns, ID conventions, key enum values, rollup tables, and example SQL. Call this before writing SQL.',
      parameters: z.object({}),
      execute: async () => SCHEMA_DICT,
    }),

    run_sql: tool({
      description:
        'Execute a read-only SELECT query on the D1 database. Use describe_schema first. Only SELECT / WITH…SELECT is allowed. LIMIT is enforced automatically.',
      parameters: z.object({
        sql: z.string().describe('A single SELECT or WITH…SELECT statement.'),
      }),
      execute: async ({ sql }) => {
        const guard = guardSql(sql);
        if (!guard.ok) return { error: guard.reason };

        try {
          const { results } = await env.DB.prepare(guard.sql).all();
          const { rows, truncated } = truncateResult(results ?? []);
          return {
            rows,
            rowCount: rows.length,
            truncated,
            sql: guard.sql,
          };
        } catch (err) {
          return { error: String(err instanceof Error ? err.message : err) };
        }
      },
    }),

    search_entities: tool({
      description:
        'Full-text search (FTS5) over authority names, company names, ЕИК, contract subjects, and УНП. Returns up to 20 matching entities.',
      parameters: z.object({
        q: z.string().describe('Search term (Cyrillic or Latin)'),
        kind: z
          .enum(['authority', 'company', 'contract'])
          .optional()
          .describe('Filter by entity kind'),
      }),
      execute: async ({ q, kind }) => {
        const where = kind ? `kind = '${kind}' AND search_index MATCH ?` : 'search_index MATCH ?';
        try {
          const { results } = await env.DB.prepare(
            `SELECT kind, ref, title, ident, subtitle, amount FROM search_index WHERE ${where} ORDER BY rank LIMIT 20`,
          )
            .bind(q)
            .all<{ kind: string; ref: string; title: string; ident: string; subtitle: string; amount: string }>();
          return { results: results ?? [] };
        } catch (err) {
          return { error: String(err instanceof Error ? err.message : err) };
        }
      },
    }),

    get_company: tool({
      description: 'Fetch headline data for a company by ЕИК or bidder slug (eik_normalized).',
      parameters: z.object({ eik: z.string().describe('9 or 13-digit ЕИК') }),
      execute: async ({ eik }) => {
        const row = await env.DB.prepare(
          `SELECT b.id, b.name, b.kind, b.ownership_kind, b.settlement,
                  ct.won_eur, ct.contracts, ct.authorities, ct.primary_sector, ct.eu_eur,
                  ct.first_date, ct.last_date
           FROM bidders b
           LEFT JOIN company_totals ct ON ct.bidder_id = b.id
           WHERE b.eik_normalized = ? OR b.bulstat = ?
           LIMIT 1`,
        )
          .bind(eik, eik)
          .first();
        return row ?? { error: 'Not found' };
      },
    }),

    get_authority: tool({
      description: 'Fetch headline data for an authority by ЕИК / bulstat.',
      parameters: z.object({ eik: z.string().describe('Authority ЕИК') }),
      execute: async ({ eik }) => {
        const row = await env.DB.prepare(
          `SELECT a.id, a.name, a.type_group, a.region, a.settlement,
                  at2.spent_eur, at2.contracts, at2.suppliers, at2.primary_sector, at2.eu_eur,
                  at2.first_date, at2.last_date
           FROM authorities a
           LEFT JOIN authority_totals at2 ON at2.authority_id = a.id
           WHERE a.bulstat = ?
           LIMIT 1`,
        )
          .bind(eik)
          .first();
        return row ?? { error: 'Not found' };
      },
    }),

    get_contract: tool({
      description: 'Fetch detail for a contract by УНП or contract id.',
      parameters: z.object({ id: z.string().describe('УНП (e.g. 00156714-2022-0001) or contract id (c:...)') }),
      execute: async ({ id }) => {
        const row = await env.DB.prepare(
          `SELECT c.id, t.title, t.source_id AS unp, a.name AS authority, b.name AS bidder,
                  c.amount_eur, c.currency, c.signed_at, c.bids_received, c.eu_funded,
                  c.value_flag, c.annex_count, c.current_value_eur
           FROM contracts c
           JOIN tenders t ON t.id = c.tender_id
           JOIN authorities a ON a.id = t.authority_id
           JOIN bidders b ON b.id = c.bidder_id
           WHERE c.id = ? OR t.source_id = ?
           LIMIT 1`,
        )
          .bind(id, id)
          .first();
        return row ?? { error: 'Not found' };
      },
    }),

    emit_report: tool({
      description:
        'Finalise and persist a report artifact. Call this once you have gathered all data. Returns {id, title} — the /reports/:id URL is /reports/{id}.',
      parameters: ReportArtifactSchema,
      execute: async (artifact, { messages }) => {
        const id = crypto.randomUUID().replace(/-/g, '');
        const promptSummary = messages
          .filter((m) => m.role === 'user')
          .slice(-1)[0]
          ?.content?.slice(0, 200) as string | undefined;

        const stored: StoredReport = {
          ...artifact,
          id,
          generatedAt: new Date().toISOString(),
          promptSummary,
        };

        if (env.REPORT_STORE) {
          await env.REPORT_STORE.put(`${id}.json`, JSON.stringify(stored), {
            httpMetadata: { contentType: 'application/json' },
          });
        }

        return { id, title: artifact.title, url: `/reports/${id}` };
      },
    }),
  };

  // ── Stream ───────────────────────────────────────────────────────────────
  const result = streamText({
    model: bggpt(MODEL_ID),
    system: SYSTEM_PROMPT,
    messages: body.messages as Parameters<typeof streamText>[0]['messages'],
    tools,
    maxSteps,
    temperature: 0.2,
  });

  return result.toDataStreamResponse();
}
