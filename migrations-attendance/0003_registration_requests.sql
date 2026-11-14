-- Request coordination only. Customer creation and chip balances stay in Sheets.
CREATE TABLE IF NOT EXISTS registration_requests (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'saved')),
  customer_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_registration
  ON registration_requests (status) WHERE status = 'pending';
