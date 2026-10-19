CREATE TABLE IF NOT EXISTS event_rank_locks (
  event_id INTEGER PRIMARY KEY, tier TEXT NOT NULL, rank_score INTEGER NOT NULL,
  team_count INTEGER NOT NULL, locked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at INTEGER NOT NULL
);

-- Accounts (cloudflare/account.ts). Sign-in is through Discord; we keep only the
-- Discord user id, display name and avatar hash. Session and login-code tokens
-- are stored as SHA-256 hashes, never in the clear.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY, return_to TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_codes (
  code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
-- The reader's own scouting data (favourites, my team, personal notes, picklists).
CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL
);
-- Scouting groups: people who share picklists and match notes.
CREATE TABLE IF NOT EXISTS scout_groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user ON group_members(user_id);
CREATE TABLE IF NOT EXISTS group_picklists (
  group_id TEXT NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL,
  updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (group_id, event_id)
);
CREATE TABLE IF NOT EXISTS group_notes (
  group_id TEXT NOT NULL, event_id TEXT NOT NULL, target TEXT NOT NULL, body TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (group_id, event_id, target)
);
CREATE TABLE IF NOT EXISTS votes (
  user_id TEXT NOT NULL, target TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (user_id, target)
);
CREATE INDEX IF NOT EXISTS votes_target ON votes(target);
