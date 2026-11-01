CREATE TABLE IF NOT EXISTS event_rank_locks (
  event_id INTEGER PRIMARY KEY, tier TEXT NOT NULL, rank_score INTEGER NOT NULL,
  team_count INTEGER NOT NULL, locked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at INTEGER NOT NULL
);

-- Settings the apps read at launch. One row per platform ('ios', 'android'),
-- holding a JSON object that overrides the worker's built-in defaults. Kept in
-- the database rather than in the worker source so that changing a season id or
-- posting a notice is an UPDATE, not a deploy - and never an App Store release.
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
