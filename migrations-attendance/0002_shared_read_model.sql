-- Confirmed read copies only. Chip operations remain in Google Sheets.
CREATE TABLE IF NOT EXISTS read_model_blobs (
  digest TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS read_model_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  manifest TEXT NOT NULL DEFAULT '{}',
  revision TEXT NOT NULL DEFAULT '',
  source_updated_at TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT '',
  business_date TEXT NOT NULL DEFAULT '',
  invalidation_epoch INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 1,
  published_at TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO read_model_state (id) VALUES (1);

-- These are synchronization barriers, not chip transactions or balances.
CREATE TABLE IF NOT EXISTS read_model_pending_writes (
  request_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  started_at TEXT NOT NULL
);
