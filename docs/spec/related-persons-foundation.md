# Спецификация: „Свързани лица" — data foundation (declared interests + ownership)

- **Status:** draft for review
- **Created:** 2026-07-03
- **Owner:** lb
- **Issues:** unblocks #60 (свързани лица), #128 (cartel heuristics), continues #34 (closed parent vision)
- **Depends on:** the ETL pipeline (`normalize-raw.sql` → `precompute.sql` → `ship-domain`) and the integrity gate

## 1. Why this exists

Sigma today models **one leg** of public money: spending. `authorities → contracts → bidders`, keyed by ЕИК. It is blind to **who is behind a bidder ЕИК** and **whether those people are connected to the officials who direct the spend**. That blindness is exactly what #34 named as the core corruption question and what #60/#128 stalled on.

The block was always data, not code. The graph (#50), the flag primitives (#127), the provenance discipline, and the null placeholders (`ConsortiumParticipant.eik`/`resolvedSlug` in `packages/api-contract`, `details.ts:172`) are already in place, waiting on two data domains:

- **Ownership** (company → real people) — from Търговски регистър. Bulk access is not available to us; **public data only**.
- **Interests / power** (officials → declared companies, family, assets) — from the CACBG declaration register (`register.cacbg.bg`), which **is** freely public.

This spec builds the foundation from **public data only** — the reproducibility is the point: anyone can re-derive it, which is what makes the linkage defensible rather than an accusation from privileged state data.

## 2. Scope

### In scope
- Ingest **CACBG declarations** → officials, declared company stakes, declared family holdings.
- Ingest **political-party financing / donations** (Сметна палата) — *source to be confirmed (Phase-1 discovery)*.
- **Targeted TR owner enrichment** — per-ЕИК public lookups, run only for the bounded set of companies that already matter (bidders + resolved declared companies).
- A **matching layer** resolving declared/donor company `name + town` → Sigma bidder ЕИК, with confidence tiers and provenance.
- Wire the resolved data into existing surfaces (#60 placeholders, network graph, #128 shared-owner heuristic, a „Декларирани връзки" panel).

### Out of scope (documented as blocked, not forgotten)
- **Loser-dependent cartel heuristics** — coordinated co-bidding, cover bidding, true winner-rotation. All need per-bidder offer lines (who bid and lost). No public source publishes them (`0000_init.sql`: "intentionally NO `bids` table"). Recovering them via OCR/LLM parsing of published комисия protocols is a **separate, later spike**, not part of this foundation.
- **Регистър на действителните собственици** (ЗМИП/AML beneficial owners) — highest value for hidden ownership, but public access is restricted post-CJEU (2022). Parked until access is confirmed.
- Full-corpus production hardening beyond what each phase's proof-gate requires.

### Buildable on public data (what survives)
Ownership links (via TR targeted + declared stakes), consortium co-participation (already in data), geographic market-splitting (winner + region), and weak **winner-only** rotation.

## 3. Data sources

### 3.1 CACBG declarations — CONFIRMED (inspected 2026-07-03)

`register.cacbg.bg/<year>/` is a JS-driven register over static data:

- `index.html` (1.4 KB shell) + `../core2.js` (loads `<year>/list.xml`; a `/core.php` backend serves search).
- **`list.xml`** (2025 ≈ 4.8 MB): hierarchy `root → MainCategory → Category[Name] → Institution[Name] → Person[Name] → Position[Name] → Declaration{Sent, xmlFile, Title}`. **15,925 persons / 34,862 declarations for 2025.** Historical years back to 2017.
  - Categories are high-signal, e.g. `Народни представители`, `Министър-председател … министри и заместник-министри`, `Кметове …`, and critically **„Лицата, упълномощени по реда на ЗОП … да организират и провеждат процедурите … и да сключват договорите"** — the people who run procurement and sign contracts.
- Each `xmlFile` is an **individual declaration XML** (≈ 45 KB), table-based (`Table/Row/Cell`, ~21 tables), with metadata: `Name`, `Position`, `Address`, `Spouse`, `Children`, `Year`, `DeclarationType`, `ControlHash`. **`EGN` is present as a tag but stripped (empty) in the public export.**
- **Company holdings** appear as rows in the holdings table(s). Confirmed shape (real row):
  ```
  1 | дружествени дялове | 100% | "ДЕМИР АГРО" ЕООД | Шумен | 100 | Айлин Нуридин Пехливанова | възмездно
  # | type               | stake | company name (+form) | town  | value | holder            | mode
  ```
- **No ЕИК on companies.** Company identity is `name + town + legal-form` only. → the ЕИК mapping is the crux (§5).

Extraction approach: fetch `list.xml` per year → iterate declaration xmlFiles → parse `Table/Row/Cell`. Structured, deterministic, **no OCR**. Cert note: the host serves a broken TLS chain — the loader must handle it explicitly (pinned CA / deliberate `-k`-equivalent), never a silent global TLS bypass.

### 3.2 Party financing / donations — DISCOVERY (Phase 1)

Same publisher (Сметна палата), likely a comparable static-data register. **URL and shape unverified** — no assumption is baked into the schema until confirmed. Phase-1 task: locate the source, characterise its format, and confirm it carries `donor (name/ЕИК) → party → amount → date`.

### 3.3 Targeted TR owner enrichment — DISCOVERY (Phase 1)

Per-ЕИК public lookup on the Търговски регистър portal, run **only** for the bounded set (bidders + resolved declared companies) — thousands of lookups, not the full ~900k-company register. Rate-limited enrichment loop. Phase-1 task: confirm the per-company endpoint/format and the fields recoverable publicly (управители, съдружници, капитал). ЕГН of persons is expected masked → owner identity is name-based, same as CACBG.

## 4. Data model

New domain tables, built by `normalize-raw.sql` from transient staging (`work-staging-schema.sql`), served alongside the existing domain. All node ids follow the repo's typed-prefix convention.

| Table | Grain (one row =) | Source | Key fields |
|---|---|---|---|
| `persons` | one natural person | all | `id` (`p:` + normalized-name key), `full_name`, `name_normalized`, `birth_year?`, `first_seen` |
| `declarations` | one CACBG declaration | CACBG | `id`, `person_id`, `year`, `position`, `institution`, `category`, `xml_file`, `control_hash`, `source_url`, `sent` |
| `declared_interests` | one holding row | CACBG | `id`, `declaration_id`, `kind` (дялове/акции/…), `stake_pct`, `company_name_raw`, `company_town`, `value`, `holder_name`, `holder_relation` (self/spouse/child), `acquisition_mode` |
| `party_donations` | one donation | party-fin | `id`, `donor_name`, `donor_kind` (person/company), `donor_eik?`, `party_name`, `amount`, `date`, `source_url` |
| `company_owners` | one owner/manager record | TR targeted | `company_eik`, `person_name`, `role` (owner/manager/BO), `stake_pct?`, `source_url`, `fetched_at` |
| `interest_links` | one **resolved** edge | Phase-2 matcher | `subject_person_id`, `company_eik`, `bidder_id`, `contract_id?`, `authority_id?`, `link_kind`, `match_method`, `confidence`, `provenance` (json) |

**Person identity:** no ЕГН, so `persons` keys on normalized name (+ `birth_year` when derivable). Merge **conservatively** — homonyms are flagged for review, never silently unified. The conflict join lives on the *company* side, which is the strong (ЕИК-resolvable) side; person ambiguity does not corrupt it.

**`interest_links` is a precomputed rollup** (built in `precompute.sql`, like `flow_pairs`), not a request-time join — D1 meters rows read, and this is the table the graph/panels/#128 consume.

## 5. Matching layer (the crux)

Resolve declared/donor `company name + town` → Sigma `bidders` (which carry `name`, `settlement`, `eik_normalized`, plus the accent/case-folded Cyrillic FTS index). We only ever resolve against the bidder set (companies that won public money), not the full register — that bounds the false-positive surface.

**Method:** normalize the raw name (strip/canonicalize quotes + legal-form token `ЕООД/ООД/АД/ЕТ/ДЗЗД`), FTS-match the core name, then score candidates by name similarity + `town == settlement` + legal-form agreement.

**Confidence tiers:**
- **Tier A** — normalized core name + town + legal form align on a single candidate → asserted link.
- **Tier B** — name matches but town/form partial, or multiple candidates → **human-review queue**, not asserted.
- **Tier C** — weak/ambiguous → held, never surfaced as a claim.

**Provenance (every link):** `source_url` (declaration xmlFile / donation record), the raw declared strings, matched `bidder_id`, `match_method`, `confidence`. The UI shows the receipts inline so a reader verifies in one click and draws their own conclusion.

**Headline metric (Phase-2 gate):** count of ЛЗВПД holding a declared stake in a company that won public contracts — and the subset where the company won **from the official's own institution** with **temporal overlap** (declaration `year` vs `contract.signed_at`).

## 6. Phases and proof-gates

### Phase 1 — Ingestion proof
Scrapers + parsers for the three sources → staging → the `persons/declarations/declared_interests/party_donations/company_owners` tables.
- **Gate:** N records ingested across sources; schema validated; **idempotent re-import** (natural-keyed, re-run yields no drift). Party-financing + TR source shapes confirmed. Loaders have real tests (adversarial: malformed XML, empty holdings, missing town, TLS quirk).

### Phase 2 — Matching proof
The resolver → `interest_links`.
- **Gate:** measured **match rate** and a **false-positive audit** on a hand-labelled sample; the headline conflict count (§5) with worked examples; the resolver at 100% coverage with sensitivity tests. This is the **go/no-go** for the whole thesis — if resolution is too noisy to be defensible, we stop here before building UI.

### Phase 3 — Integration proof
Wire the data into what already exists, in the fork worktree, cherry-picking any in-flight commit we need to build against (e.g. #144's force-directed graph), verified on the **fork's ephemeral deployed env**.
- Fill `ConsortiumParticipant.eik`/`resolvedSlug` (#60); extend `NetworkNode.kind` to `'person'` + typed edges; feed #128's shared-owner heuristic; add a „Декларирани връзки" panel on company/authority/contract profiles.
- **Gate:** the graph/#60/#128 consume the new data correctly on a live ephemeral deploy; privacy masking holds on all output formats (incl. `.json`/`.csv`/`.data`).

## 7. Architecture fit

Rides the existing ETL exactly — no new infra:
`load-cacbg.mjs` / `load-party-fin.mjs` / `enrich-tr-owners.mjs` → `work-staging-schema.sql` staging → `normalize-raw.sql` (domain tables) → `precompute.sql` (`interest_links` rollup) → `ship-domain` → **`assertIntegrity`**. A new source is precisely why the publication-boundary gate matters; this foundation should not go live on a path that writes before it validates.

**Workspace / delivery:** isolated fork worktree off synced `main`; cherry-pick specific upstream commits when needed; verify on the fork's ephemeral env. Product still lands upstream via PR when a phase is proven.

## 8. Guardrails (non-negotiable)

- **Public-by-law facts vs inference.** Declarations are public by statute → restating a declared fact with a source link is defensible. The **link** (the inference) is tiered, hedged, appealable — „модел за проверка, не обвинение" (#34).
- **Family data.** `holder_relation = spouse/child` are natural persons → apply Sigma's existing mask/noindex policy (#173) to non-official family names in public output, on **every** format (#184 `.data` lesson).
- **Self-reported ≠ complete.** A *declared* absence is not proof of no conflict. The tool shows declared/derivable links, never claims completeness — stated on the methodology page.
- **False positives are the risk.** Name-match is the failure mode → nothing auto-asserted above Tier A, Tier B goes to human review, resolver gets adversarial self-tests. Accuracy defects block merge.
- **No silent TLS bypass.** The CACBG cert-chain issue is handled explicitly and scoped to that host.

## 9. Open questions / risks

1. **Party-financing source** — existence/shape unknown (Phase-1 discovery). May not be structured; could reduce that source's scope.
2. **TR public per-company data** — how much ownership is publicly recoverable per ЕИК, and at what rate limit.
3. **Match rate unknown until Phase 2** — the whole thesis rests on the §5 number. Phase 2 is deliberately the gate before UI.
4. **Person disambiguation across years/sources** — conservative merge may under-link (same person seen as two); acceptable for v1 (favors false-negatives over false-accusations).
5. **Historical depth** — how many CACBG years to ingest (2017→2025) vs latest only; affects temporal-overlap coverage.
