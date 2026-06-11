# ETL pipeline

Status: storage.eop.bg is the single source for the procurement ETL. The old procurement feeds from
data.egov.bg are retired.

## Source model

Each daily bucket is addressed as:

```text
https://storage.eop.bg/open-data-YYYY-MM-DD/
```

The bucket is listed with the S3/ListBucket XML response and keys are classified by filename. A
published bucket contains four JSON files:

1. plain contracts JSON
2. plain tenders JSON
3. plain annexes JSON
4. one full OCDS 1.1 release package

The plain JSON files are the base. They populate the existing `raw_contracts`,
`raw_tenders`, and `raw_amendments` staging tables with `source` values like
`eop:contracts:YYYY-MM-DD`, `eop:tenders:YYYY-MM-DD`, and `eop:annexes:YYYY-MM-DD`.

The in-bucket OCDS file enriches that base. It populates:

- `raw_contracts` and `raw_amendments` with `source = 'ocds:YYYY-MM-DD'`
- `raw_ocds_parties` for party address and contact fields
- `raw_ocds_award_suppliers` for all suppliers on each award
- `raw_ocds_lots` for per-lot OCDS values

OCDS `ocid` is provenance only. It is not the public procurement UNP and is not used as a UNP join
key.

### Source history

The earlier admin CAIS EOP export and the data.egov.bg procurement portal/OCDS feeds are historical
only. They were useful for proving coverage, source quirks, and normalization rules, but are
superseded for procurement by the storage.eop.bg single source.

Retired procurement loaders should not be treated as current sources. `scripts/load-ocds.mjs` remains
only as a compatibility wrapper; the separate Trade Register loader is a different company-ownership
dataset and is outside this procurement pipeline.

### ROP deliberate gap

The procurement domain intentionally follows the CAIS EOP-era open data. Legacy pre-CAIS ROP rows
were previously observed through the portal CSV as thin, procedure-poor records, mostly around 2020
with a tail into later years. We deliberately do not backfill those legacy ROP contracts: the product
scope depends on CAIS EOP procedure fields, lot grain, CPV, estimates, and enrichment that the thin
legacy rows do not carry.

If full legacy ROP coverage ever becomes a product requirement, treat it as a separate historical
backfill with explicit thin-row semantics, not as part of the current storage.eop.bg refresh path.

## Shared logic

The OCDS release mappers live in `@sigma/ingest` and are shared by CLI and Worker code:

- contracts
- amendments
- parties
- award suppliers
- lots
- bucket key classification
- catch-up window calculation

The CLI loader (`scripts/load-eop.mjs`) reads both the base plain JSON files and the in-bucket OCDS
file. The old `scripts/load-ocds.mjs` entrypoint is a compatibility wrapper and no longer talks to
data.egov.bg.

## Backfill and refresh

Initial backfill and daily refresh use the same staging tables, mappers, and SQL. They differ by date
window and derive mode:

- large or first-run catch-up: CLI window plus full derive
- small steady-state refresh: gap-aware window plus slice derive

`scripts/import.mjs --catchup` detects loaded bucket coverage from `raw_contracts` source-tag
dates for `eop:%` and `ocds:%`. It uses `published_at` only as a fallback for loaded rows, and uses
`data_freshness.as_of` only when there are zero loaded EOP/OCDS staging rows. This prevents signed-date
metrics from masking missing bucket coverage.

`--derive=full` runs amendment rollup, FX, NUTS, full normalize, and precompute. `--derive=slice` runs
the scoped refresh SQL. The default catch-up logic chooses full derive for large gaps and slice derive
for small gaps.

`--plan-only` prints the resolved catch-up plan and exits without loading or deriving.

## Domain derive

`normalize-raw.sql` performs a full rebuild from staging:

- EOP base rows win.
- OCDS contract rows fill only genuinely new contract numbers not present in EOP.
- parties enrich authority and bidder address, NUTS, settlement, contact email, and contact phone by
  EIK.
- lots receive OCDS per-lot `value_amount` and `value_currency` only when the safe bridge exists:
  `raw_ocds_lots.tender_id` -> `raw_tenders.tender_id` -> UNP -> domain lot id.

`refresh-slice.sql` is idempotent for the refreshed window. It derives new EOP base rows into `c:e:*`
refresh ids and OCDS rows into `c:o:*` refresh ids, then refreshes affected rollups and search rows.
A later full normalize rebases those rows into the normal `c:*` id space.

### Dedup & identity

- **Contract identity:** one domain contract per accepted staging row. A procurement is keyed by UNP
  (`tenders.source_id`) when the base tender data carries one. OCDS `ocid` is a surrogate identifier,
  not the public UNP, and must never be joined as `ocid = UNP`.
- **Cross-feed key:** `contract_number` is the practical bridge between the plain base feed and the
  in-bucket OCDS release package. Where both feeds mention the same contract number, the plain base
  row wins and the OCDS contract row is ignored for domain contract insertion.
- **Base wins:** EOP rows are the system of record. OCDS rows are accepted only when they represent a
  genuinely new `contract_number` absent from EOP staging/domain rows in that derive.
- **Synthetic tenders:** a contract whose UNP has no tender-export parent gets a synthetic tender so
  FK integrity is preserved. OCDS-only rows use the same rule defensively, with parent authority and
  bidder guards.
- **Lot grain:** the tenders feed has one tender header plus one row per lot. Domain lots preserve
  that lot grain. OCDS per-lot values are copied only through the safe `tender.id` -> base tender id
  -> UNP -> lot path, never through `ocid`.
- **Recipient identity:** bidders are keyed by valid EIK where present; otherwise by normalized name.
  This avoids collapsing withheld or missing-EIK contractors into one node while still retaining named
  recipients. OCDS award suppliers mark consortium structure; `supplier_count > 1` is a consortium
  signal and member rows are retained in `raw_ocds_award_suppliers`.

### Currency

The procurement data spans the BGN to EUR switch: 2020-2025 contract amounts are recorded in BGN,
2026 amounts are recorded in EUR, and a small number of contracts use other currencies such as USD,
CHF, GBP, TRY, SEK, or CZK. `normalize-raw.sql` keeps each row's native recorded value on
`contracts.amount` and `contracts.currency`, then derives canonical `contracts.amount_eur` for safe
aggregation.

Conversion rules are unchanged:

- BGN converts to EUR at the fixed peg: divide by `1.95583`.
- EUR is kept as-is.
- Foreign currencies convert at the ECB reference rate for the contract signing date. Rates are stored
  in `fx_rates` and loaded by `scripts/load-fx.mjs`.

Rows converted through an FX lookup carry row-level provenance: `fx_converted = 1` and `fx_rate` is
stored on the contract, so `amount * fx_rate = amount_eur` can be audited without another join.
`amount_eur` is the canonical aggregation column. Display in leva is derived as
`amount_eur * 1.95583`.

### Data quality

Source value errors are handled non-destructively: staging stays raw, while `normalize-raw.sql`
derives `value_flag` and `amount_eur` on domain contracts.

- **Value errors:** roughly 213 source rows have signed or amended values at least 100x the
  procurement estimate. Raw-cell inspection showed dropped decimal commas at source, and portal
  cross-checks showed the same wrong values, so they are upstream errors rather than loader artifacts
  and cannot be reliably recovered.
- **`value_suspect`:** the signed value itself is at least 100x the estimate. The row is kept and
  flagged, but excluded from `amount_eur`.
- **`annex_suspect`:** an amendment pushes `current_value` to an implausible value or negative value
  while the signing value is sane. The contract falls back to the signing value for `amount_eur`.
- **`review`:** a gray-zone 10x-100x value. The row is kept, flagged, and included.
- **Recipient identity:** bidder identity uses valid EIK first and normalized name otherwise, avoiding
  the old collapse of withheld-EIK recipients while retaining contractors with names but no valid EIK.
- **Foreign currency:** non-BGN/non-EUR contracts keep raw `amount`/`currency` and derive
  `amount_eur` using signing-date FX rates with `fx_converted` and `fx_rate` provenance.
- **Minor issues:** out-of-range dates, zero-value contracts, rare negative values, and duplicate
  `(UNP, contract_number)` pairs are surfaced or flagged rather than silently corrected. Most duplicate
  keys are real multi-lot or source-shape artifacts.

## Worker refresh

`apps/etl` is the small-window on-platform refresh. It reads storage.eop.bg only. It:

1. detects the latest loaded bucket date from D1;
2. computes a lookback catch-up window;
3. caps large gaps to a recent Worker-safe window and logs a warning;
4. lists daily buckets;
5. stages the in-bucket OCDS enrichment with shared mappers and staging upserts;
6. runs `refresh-slice.sql`.

Current Worker limitation: it stages only the in-bucket OCDS file. The plain base JSON coercion still
lives in the CLI loader and must be extracted into shared Worker-safe helpers before the Worker also
stages base contracts, tenders, and annexes. Large backfills remain CLI-only by design.

## Schema

The repo is pre-production and uses a single fresh-start schema file:

```text
packages/db/migrations/0000_init.sql
```

Relevant storage.eop additions include contact fields on authorities and bidders, `raw_ocds_lots`,
and value fields on `lots`.
