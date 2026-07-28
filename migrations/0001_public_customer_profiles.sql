CREATE TABLE IF NOT EXISTS public_customer_profiles (
  customer_code TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_customer_profiles_token
  ON public_customer_profiles (token);
