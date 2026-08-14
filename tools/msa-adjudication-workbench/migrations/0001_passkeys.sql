PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  profile_ciphertext TEXT NOT NULL,
  consent_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports_json TEXT NOT NULL,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX idx_passkeys_user_id ON passkeys(user_id);

CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
  user_id TEXT,
  profile_ciphertext TEXT,
  consent_json TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_webauthn_challenges_expiry
  ON webauthn_challenges(expires_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE drafts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  packet_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, packet_id, role)
);
