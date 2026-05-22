-- Sigma — switch the canonical money column to EUR + add foreign-currency conversion.
--
-- 0007 introduced a canonical BGN column (amount_bgn). Bulgaria is in the eurozone, so the
-- canonical analytical currency is EUR: rename the column, and convert the foreign-currency
-- contracts (USD/CHF/GBP/TRY/SEK/CZK) at the ECB reference rate on the contract's SIGNING DATE
-- (frankfurter.app → fx_rates, loaded by scripts/load-fx.mjs). scripts/normalize-egov.sql fills
-- amount_eur: BGN at the fixed peg (÷ 1.95583), EUR as-is, foreign × fx_rates; NULL for
-- value_suspect rows (and any foreign row missing a rate). fx_converted = 1 marks the foreign rows,
-- whose EUR value carries FX-date uncertainty. Display in лева is amount_eur × 1.95583.

ALTER TABLE contracts RENAME COLUMN amount_bgn TO amount_eur;
ALTER TABLE contracts ADD COLUMN fx_converted INTEGER NOT NULL DEFAULT 0; -- 1 = converted from a foreign currency at the signing-date rate
ALTER TABLE contracts ADD COLUMN fx_rate REAL;                            -- the rate applied for foreign rows (EUR per 1 unit of `currency`); NULL for BGN/EUR. So amount * fx_rate = amount_eur, on the row, auditable without joining fx_rates.

-- ECB euro reference rates for the signing dates of foreign-currency contracts (loaded by
-- scripts/load-fx.mjs via frankfurter.app). eur_per_unit = EUR for 1 unit of base_currency.
CREATE TABLE IF NOT EXISTS fx_rates (
  base_currency TEXT NOT NULL,        -- 'USD', 'CHF', …
  rate_date     TEXT NOT NULL,        -- the contract date we priced (ISO)
  eur_per_unit  REAL NOT NULL,        -- 1 base_currency = eur_per_unit EUR
  source        TEXT NOT NULL,        -- 'ecb:frankfurter'
  fetched_at    TEXT NOT NULL,
  PRIMARY KEY (base_currency, rate_date)
);
