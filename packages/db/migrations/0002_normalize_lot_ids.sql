-- Reconcile contracts.lot_id with lots.id.
--
-- The OCDS contract feed stored lot ids as 'LOT-000N' while the tender feed (which builds the lots
-- table) numbers them N. So ~76k lot-scoped contracts never linked to their lot row: the „Обособени
-- позиции" table showed „няма сключен договор" for them and never highlighted the current position,
-- and the header read „обособена позиция LOT-0002". Canonical form is 'lot:UNP:N'.
--
-- lots.id is already numeric (no change needed). normalize-egov.sql now builds BOTH sides this way for
-- fresh imports; this migration heals the rows already in the database. See
-- docs/value-flags-and-inflation.md (lot-id reconciliation).
UPDATE contracts
SET lot_id =
  'lot:' || substr(tender_id, 3) || ':' ||
  CAST(REPLACE(substr(lot_id, length('lot:' || substr(tender_id, 3) || ':') + 1), 'LOT-', '') AS INTEGER)
WHERE lot_id LIKE 'lot:%:LOT-%';
