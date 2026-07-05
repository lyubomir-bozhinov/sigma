-- Свързани лица (related-persons / conflict-of-interest) domain — CACBG declarations resolved to
-- contract winners. See docs/spec/related-persons-foundation.md and docs/adr/0001..0009.
--
-- Publish rule = certainty 1.0: a link is 'published' only when the resolution is deterministic
-- (single normalized key → single valid ЕИК in the winner set, publish_tier A|B; ADR-0003). Ambiguous
-- links stay 'held'. Every link carries full provenance. Third-party people live in a separate,
-- internal-only table (ADR-0004) and are never joined into the published surface.

-- Public officials who filed declarations. No national person id (ЕГН is stripped, ADR-0004), so a
-- person is keyed by normalized name; the rare namesake collision is documented, not silently merged.
CREATE TABLE persons (
  id           TEXT PRIMARY KEY,            -- 'person:' || companyNameKey-style normalized full name
  name         TEXT NOT NULL,               -- declarant full name as filed
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per filed declaration (natural key xml_file + control_hash makes re-import idempotent).
CREATE TABLE declarations (
  id            TEXT PRIMARY KEY,           -- 'decl:' || xml_file
  person_id     TEXT NOT NULL REFERENCES persons(id),
  xml_file      TEXT NOT NULL,
  control_hash  TEXT,                       -- source integrity hash; re-import key with xml_file
  folder_year   TEXT NOT NULL,              -- register folder (publication year)
  declared_year TEXT,                       -- year the declaration itself reports (NOT the folder; off-by-one)
  template      TEXT NOT NULL,              -- 'assets' | 'interests'
  category      TEXT,                       -- CACBG category (e.g. Народни представители)
  institution   TEXT,                       -- the body the official serves in
  position      TEXT,                       -- declared position
  source_url    TEXT NOT NULL,              -- register.cacbg.bg/<folder>/<xml_file> — provenance
  UNIQUE (xml_file, control_hash)
);

-- One row per company-bearing declared interest (the declarant's OWN interests only; ADR-0004/0007).
CREATE TABLE declared_interests (
  id             TEXT PRIMARY KEY,          -- 'di:' || decl id || ':' || ordinal
  declaration_id TEXT NOT NULL REFERENCES declarations(id),
  entity_raw     TEXT NOT NULL,             -- company name exactly as declared
  entity_key     TEXT NOT NULL,             -- companyNameKey(entity_raw) — the deterministic match key
  kind           TEXT NOT NULL,             -- shares | participation | management | sole_trader
  detail         TEXT,                      -- stake % / role (управител, член на УС) / ЕТ subject
  timing         TEXT NOT NULL DEFAULT 'annual', -- annual | current | prior (appointment-relative)
  seat           TEXT                       -- declared седалище (asset decls only; sparse)
);
CREATE INDEX idx_declared_interests_key ON declared_interests(entity_key);
CREATE INDEX idx_declared_interests_decl ON declared_interests(declaration_id);

-- The resolved match: a person↔winner ЕИК link, aggregated across that person's declarations (annual
-- re-filings collapse to one link). Per-row evidence stays in declared_interests, joinable by person +
-- entity_key. `link_key` is the stable natural key the suppression list and re-imports key on.
CREATE TABLE interest_links (
  id                TEXT PRIMARY KEY,       -- 'il:' || link_key
  link_key          TEXT NOT NULL UNIQUE,   -- person_id || '|' || eik  (suppression + idempotent re-import)
  person_id         TEXT NOT NULL REFERENCES persons(id),
  bidder_id         TEXT NOT NULL REFERENCES bidders(id),
  eik               TEXT NOT NULL,          -- eik_normalized of the matched winner
  entity_key        TEXT NOT NULL,          -- the normalized declared name that resolved
  match_method      TEXT NOT NULL DEFAULT 'exact_name_key',
  matcher_version   TEXT NOT NULL,          -- companyNameKey/classify version — reproducibility
  publish_tier      TEXT NOT NULL,          -- A_seat | B_distinctive | C_hold (ADR-0003/0009)
  relation          TEXT NOT NULL,          -- owns | manages | owns+manages (control) — ADR-0008
  contemporaneous   INTEGER NOT NULL DEFAULT 0,
  own_institution   TEXT NOT NULL DEFAULT 'none', -- exact (deterministic) | locality (heuristic) | none
  evidence_count    INTEGER NOT NULL DEFAULT 1,   -- # declared_interests supporting this link
  first_declared_year TEXT,
  last_declared_year  TEXT,
  status            TEXT NOT NULL DEFAULT 'held', -- published | held | suppressed
  verified_by       TEXT,
  verified_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_interest_links_eik ON interest_links(eik);
CREATE INDEX idx_interest_links_status ON interest_links(status);
CREATE INDEX idx_interest_links_person ON interest_links(person_id);

-- Contested/corrected links that MUST stay removed across refreshes (ADR-0001 correction path).
CREATE TABLE link_suppressions (
  link_key      TEXT PRIMARY KEY,           -- matches interest_links.link_key
  reason        TEXT NOT NULL,
  suppressed_by TEXT NOT NULL,
  suppressed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Declared THIRD-PARTY people (interests tables 21/22). PII → INTERNAL only (ADR-0004): never joined
-- into published surfaces; masked on every output format. Feeds only the internal свързани-лица graph.
CREATE TABLE related_persons_internal (
  id             TEXT PRIMARY KEY,          -- 'rp:' || decl id || ':' || ordinal
  declaration_id TEXT NOT NULL REFERENCES declarations(id),
  related_name   TEXT NOT NULL,             -- third-party name — masked at every surface
  related_kind   TEXT NOT NULL,             -- related_person | related_contract
  info           TEXT,                      -- declared area/subject
  timing         TEXT NOT NULL DEFAULT 'current'
);
