// Curated data dictionary returned by the describe_schema tool.
// Grounded from packages/db/migrations/0000_init.sql.
// The model reads this before writing SQL — it surfaces enum values, ID conventions,
// and the rollup tables so the model picks the cheapest correct query path.

export const SCHEMA_DICT = `
# SIGMA — Data Dictionary (D1 / SQLite)

## ID conventions
- authorities.id   = 'auth:' || ЕИК
- bidders.id       = 'eik:' || ЕИК  (when valid)  OR  'name:' || normalised_name
- tenders.id       = 't:' || УНП
- contracts.id     = 'c:' || staging_row_id

## Domain tables (primary data)

### authorities
| Column        | Type | Notes |
|---|---|---|
| id            | TEXT PK | 'auth:ЕИК' |
| name          | TEXT | official name |
| bulstat       | TEXT | ЕИК / Булстат |
| region        | TEXT | oblast name |
| type          | TEXT | ЗОП controlled vocab |
| type_group    | TEXT | министерство / община / агенция / болница / образование / държавна компания / друго |
| nuts          | TEXT | NUTS3 code (e.g. BG411) |
| settlement    | TEXT | city/town |

### tenders
| Column         | Type | Notes |
|---|---|---|
| id             | TEXT PK | 't:УНП' |
| source_id      | TEXT | УНП (unique procurement number) |
| title          | TEXT | procurement subject |
| authority_id   | TEXT FK→authorities | |
| cpv_code       | TEXT | CPV code (first 2 digits = sector division) |
| cpv_description| TEXT | human-readable CPV label |
| estimated_value| REAL | |
| currency       | TEXT | default BGN |
| procedure_type | TEXT | raw ЗОП procedure type |
| contract_kind  | TEXT | Доставки / Услуги / Строителство |
| status         | TEXT | 'awarded' / 'published' / 'planned' |
| published_at   | TEXT | ISO date |
| eu_programme   | TEXT | EU funding programme name |

### bidders
| Column        | Type | Notes |
|---|---|---|
| id            | TEXT PK | 'eik:ЕИК' or 'name:...' |
| name          | TEXT | |
| bulstat       | TEXT | raw ЕИК |
| eik_normalized| TEXT | digits-only ЕИК |
| eik_valid     | INT  | 1 = valid 9/13-digit ЕИК |
| is_consortium | INT  | 1 = JV (ДЗЗД / ОБЕДИНЕНИЕ) |
| kind          | TEXT | 'company' / 'consortium' |
| ownership_kind| TEXT | 'state' / 'municipal' / 'mixed' / NULL |
| settlement    | TEXT | seat city |

### contracts
| Column           | Type | Notes |
|---|---|---|
| id               | TEXT PK | 'c:...' |
| tender_id        | TEXT FK→tenders | |
| bidder_id        | TEXT FK→bidders | |
| amount           | REAL | headline value in currency |
| currency         | TEXT | BGN / EUR / USD etc. |
| amount_eur       | REAL | **canonical EUR — SAFE TO SUM; NULL = excluded** |
| signed_at        | TEXT | ISO date |
| eu_funded        | INT  | 1 = EU-funded |
| bids_received    | INT  | 1 = single-offer (risk flag) |
| value_flag       | TEXT | 'ok' / 'review' / 'annex_suspect' / 'value_suspect' |
| date_flag        | TEXT | 'ok' / 'signed_after_publication' |
| annex_count      | INT  | number of amendments |
| current_value_eur| REAL | latest post-annex value in EUR |
| contract_kind    | TEXT | Доставки / Услуги / Строителство |
| winner_size      | TEXT | micro / small / medium / large |

**Always use amount_eur for monetary aggregates** — it is NULL for value_suspect rows which must be excluded.

### amendments
| Column        | Notes |
|---|---|
| unp           | УНП (links to tenders.source_id) |
| contract_number| |
| value_before / value_after / value_delta | REAL |
| published_at  | ISO date |
| description   | TEXT |

## Rollup tables (fast, no heavy aggregation needed)

### home_totals (1 row, id=1)
contracts, value_eur, authorities, bidders, suspect, first_date, last_date, as_of, refreshed_at

### company_totals
bidder_id, name, kind, ownership_kind, eik, eik_valid, settlement, won_eur, contracts, authorities, primary_sector, eu_eur, first_date, last_date

### authority_totals
authority_id, name, type_group, settlement, region, spent_eur, contracts, suppliers, avg_eur, primary_sector, eu_eur, first_date, last_date

### sector_totals
division (2-digit CPV), contracts, value_eur

### flow_pairs
authority_id, bidder_id, authority_name, bidder_name, bidder_kind, won_eur, contracts

### facet_counts
facet ('year'|'procedure'|'eu'), key, contracts, value_eur

## Search
### search_index (FTS5)
kind ('authority'|'company'|'contract'), ref (slug/id), title, ident (ЕИК/УНП), subtitle, amount
Use: SELECT * FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 20

## Reference
### data_freshness
source ('admin'|'ocds'), as_of (ISO date of latest covered contract), rows, refreshed_at

### nuts_regions
nuts3, nuts3_name, nuts2, nuts2_name, nuts1, nuts1_name

### fx_rates
base_currency, rate_date, eur_per_unit

## Key query patterns

-- Total spend per sector (CPV 2-digit division), sorted by value:
SELECT division, contracts, value_eur FROM sector_totals ORDER BY value_eur DESC LIMIT 20;

-- Top companies by won EUR:
SELECT name, won_eur, contracts FROM company_totals ORDER BY won_eur DESC LIMIT 10;

-- Contracts with single offer (risk flag), year 2023:
SELECT c.id, t.title, a.name AS authority, b.name AS bidder, c.amount_eur, c.signed_at
FROM contracts c
JOIN tenders t ON t.id = c.tender_id
JOIN authorities a ON a.id = t.authority_id
JOIN bidders b ON b.id = c.bidder_id
WHERE c.bids_received = 1 AND c.amount_eur IS NOT NULL AND substr(c.signed_at, 1, 4) = '2023'
ORDER BY c.amount_eur DESC LIMIT 20;

-- Top companies by contracts with authorities in a specific city (e.g. Sofia):
-- NOTE: contracts has NO authority_id — the path is contracts → tenders → authorities.
SELECT b.name, b.id AS bidder_id, COUNT(c.id) AS contracts, SUM(c.amount_eur) AS won_eur
FROM contracts c
JOIN tenders t ON t.id = c.tender_id
JOIN authorities a ON a.id = t.authority_id
JOIN bidders b ON b.id = c.bidder_id
WHERE a.settlement = 'София' AND c.amount_eur IS NOT NULL
GROUP BY b.id ORDER BY contracts DESC LIMIT 20;

-- Year-over-year spend trend:
SELECT substr(signed_at, 1, 4) AS year, SUM(amount_eur) AS value_eur, COUNT(*) AS contracts
FROM contracts WHERE amount_eur IS NOT NULL GROUP BY year ORDER BY year;
`.trim();
