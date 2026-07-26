ALTER TABLE vps RENAME TO subscriptions;
ALTER TABLE subscriptions RENAME COLUMN category TO note;
ALTER TABLE subscriptions ADD COLUMN category TEXT NOT NULL DEFAULT 'VPS';

DROP INDEX IF EXISTS idx_vps_status_expires;
DROP INDEX IF EXISTS idx_vps_category;

CREATE INDEX IF NOT EXISTS idx_subscriptions_status_expires
  ON subscriptions (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_category
  ON subscriptions (category);
