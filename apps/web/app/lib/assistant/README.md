# AI асистент — имплементация

Наша имплементация на [`docs/spec/ai-assistant.md`](../../../../../docs/spec/ai-assistant.md),
включително хардунирането от **§9** (PR #79). Backend-ът на асистента е **опроводен от край до край в
кода**: чистите тествани модули → tool registry → agent loop → ресурс route-а `/assistant/chat`.
Остават потребителските части (dock UI, renderer на справките и `/reports/:id`, глас) и provisioning-ът
(`BGGPT_API_KEY` + bindings) — виж „Какво остава".

## Какво има (имплементирано)

| Файл                        | Роля                                                          | Спец.        | Проверка  |
| --------------------------- | ------------------------------------------------------------- | ------------ | --------- |
| `report-schema.ts`          | Block речник + **сървърно обвързване на стойностите**         | §4, §9.1, §7 | unit      |
| `sql-guard.ts`              | Read-only структурен guard + LIMIT + byte cap                 | §7, §9.4     | unit      |
| `describe-schema.ts`        | Куриран речник на данните с капаните                          | §9.2         | unit      |
| `rag.ts`                    | Vectorize + Workers AI RAG (grounding + semantic search)      | _добавка_    | unit      |
| `system-prompt.ts`          | emit-report политика, values-by-reference, data-trust, скелет | §4/§7/§9.10  | unit      |
| `tool-results.ts`           | D1 редове → хендълнат `QueryResult`                           | §7           | unit      |
| `eop-fetch.ts`              | `eop_fetch` — валидация + fixed base (no SSRF) + cap          | §9.7         | unit      |
| `source-link.ts`            | Официални линкове (ЦАИС ЕОП) за цитиране                      | §3           | unit      |
| `emit-report-schema.ts`     | Структурна валидация + model-facing JSON Schema               | §4           | unit      |
| `render-format.ts`          | format-by-hint + entity-ref линкове                           | §4           | unit      |
| `tools.ts`                  | Tool registry (SDK-агностичен) + `finalizeReport`             | §2/§3        | unit      |
| `agent.ts`                  | Vercel AI SDK glue: BgGPT през AI Gateway + `streamText`      | §2/§9.5      | typecheck |
| `routes/assistant.chat.tsx` | Stateless chat ресурс route                                   | §2/§5        | typecheck |

**Проверено:** `pnpm --filter web typecheck` → 0; **115 теста** преминават; `pnpm audit --audit-level=high`
чист; Prettier чист. Чистите модули са unit-тествани и deploy-независими; agent loop-ът и route-ът са
typecheck-проверени, но **не са runtime-проверени** (няма `BGGPT_API_KEY` / облачни bindings в тази среда).

## Ключово решение: стойностите се владеят от сървъра (§9.1)

Сърцето на интегритета. Моделът **не пише числа** — `emit_report` блоковете _референцират_ хендъли към
резултатни множества, които сървърът реално е изпълнил, а `bindReport()` пре-свързва реалните стойности.
Таблиците взимат редовете изцяло от резултата, така че моделът не може да инжектира измислен ред или да
напише „12 млрд." вместо „1,2 млрд." — векторът за клевета от
[architecture.md](../../../../../docs/architecture.md) §3. Само `text`/`callout` носят авторска проза и
са markdown-санитизирани (без raw HTML → затваря stored-XSS на публичния `/reports/:id`).

## RAG — добавка спрямо спецификацията

Спецификацията е **text→SQL агент с инструменти, БЕЗ векторно извличане.** RAG е добавен нарочно на двете
места с най-голяма полза при слаб 27B: (1) **grounding на схемата** — извлича най-релевантните trap-правила
и примерни заявки за конкретния въпрос в системния prompt (retrieval-augmented формата на §9.2); (2)
**`semantic_search`** — допълва FTS за парафрази/синоними. Пада обратно до статичния `describeSchema()`,
ако се реши, че RAG е извън v1.

## Какво остава

- **Provisioning (deploy-time):** `BGGPT_API_KEY` (secret), Vectorize индекс `sigma-assistant`, R2 кофа
  `sigma-reports`, еднократно индексиране на схема-корпуса (`indexSchemaCorpus`).
- **Фаза 2 — потребителски слой:** глобален dock (`useChat`); renderer `emit_report` → компонентите на
  сайта + нов `timeseries`; `/reports/:id`, chat карти, индекс `/reports`; воден знак „AI-генерирано,
  неофициално" + показан въпрос (§9.12); достъпни таблици-алтернативи за SVG блоковете (§9.6).
- **Фаза 3:** глас (`/assistant/transcribe` → Whisper).
- **Втвърдяване:** AST guard (`node-sql-parser`) над структурния (§9.4); HMAC-подпис на сървърните
  съобщения (§9.3); memoize `(sql_hash, freshness)` + дедуп на справки (§9.8); golden-report CI (§9.9);
  launch gate (Turnstile + Rate Limiting + circuit-breaker).
