PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  season_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  alliance_game_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, alliance_game_id),
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS capture_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  alliance_id INTEGER,
  capture_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY(alliance_id) REFERENCES alliance(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS raw_artifact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_session_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  source_module TEXT,
  source_func TEXT,
  captured_at TEXT NOT NULL,
  sha256 TEXT,
  sensitive_scan_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY(capture_session_id) REFERENCES capture_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS export_job (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER,
  created_at TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  format TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  output_paths_json TEXT NOT NULL DEFAULT '[]',
  request_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  avatar_id TEXT,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(avatar_id)
);

CREATE TABLE IF NOT EXISTS alliance_member_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  alliance_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  avatar_id TEXT NOT NULL,
  avatar_name TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  confidence TEXT NOT NULL DEFAULT 'manual',
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY(alliance_id) REFERENCES alliance(id) ON DELETE CASCADE,
  FOREIGN KEY(player_id) REFERENCES player(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_session_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  alliance_id INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  avatar_id TEXT NOT NULL,
  avatar_name TEXT NOT NULL,
  state TEXT,
  is_online INTEGER NOT NULL DEFAULT 0,
  official_name TEXT,
  profession_name TEXT NOT NULL DEFAULT '',
  profession_id INTEGER NOT NULL DEFAULT 0,
  role_id INTEGER NOT NULL DEFAULT 0,
  legion_name TEXT,
  legion_id INTEGER NOT NULL DEFAULT 0,
  legion_leader INTEGER NOT NULL DEFAULT 0,
  prosperity INTEGER,
  weekly_merit INTEGER,
  weekly_contribution INTEGER,
  season_score INTEGER NOT NULL DEFAULT 0,
  demolition_value INTEGER,
  coordinate_x INTEGER,
  coordinate_y INTEGER,
  last_offline_ts INTEGER NOT NULL DEFAULT 0,
  join_ts INTEGER NOT NULL DEFAULT 0,
  t_feat INTEGER NOT NULL DEFAULT 0,
  t_forage_use INTEGER NOT NULL DEFAULT 0,
  w_forage_use INTEGER NOT NULL DEFAULT 0,
  weekly_statistics_json TEXT NOT NULL DEFAULT '{}',
  is_self INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  raw_artifact_id INTEGER,
  FOREIGN KEY(capture_session_id) REFERENCES capture_session(id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY(alliance_id) REFERENCES alliance(id) ON DELETE CASCADE,
  FOREIGN KEY(raw_artifact_id) REFERENCES raw_artifact(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS union_log_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_session_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  alliance_id INTEGER NOT NULL,
  event_time TEXT NOT NULL,
  log_category TEXT NOT NULL,
  log_section TEXT NOT NULL DEFAULT 'other',
  actor_name TEXT NOT NULL,
  target_name TEXT,
  text TEXT NOT NULL,
  raw_event_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(capture_session_id) REFERENCES capture_session(id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY(alliance_id) REFERENCES alliance(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS building_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_session_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  alliance_id INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  building_name TEXT NOT NULL,
  facility_type TEXT NOT NULL DEFAULT '',
  facility_type_id INTEGER NOT NULL DEFAULT 0,
  role_facility_type INTEGER NOT NULL DEFAULT 0,
  cfg_id INTEGER NOT NULL DEFAULT 0,
  carrier_id TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL,
  state TEXT NOT NULL,
  status_id INTEGER NOT NULL DEFAULT 0,
  coordinate_x INTEGER NOT NULL DEFAULT 0,
  coordinate_y INTEGER NOT NULL DEFAULT 0,
  operator_avatar_id TEXT NOT NULL DEFAULT '',
  operator_name TEXT NOT NULL DEFAULT '',
  benefit INTEGER NOT NULL DEFAULT 0,
  mine_count INTEGER NOT NULL DEFAULT 0,
  max_mine_count INTEGER NOT NULL DEFAULT 0,
  effect TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(capture_session_id) REFERENCES capture_session(id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY(alliance_id) REFERENCES alliance(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS union_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_session_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  alliance_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL DEFAULT 0,
  group_name TEXT NOT NULL DEFAULT '',
  legion_id INTEGER NOT NULL DEFAULT 0,
  legion_name TEXT NOT NULL DEFAULT '',
  member_count INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(capture_session_id) REFERENCES capture_session(id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY(alliance_id) REFERENCES alliance(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS battle_block (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_session_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  alliance_id INTEGER NOT NULL,
  battle_id TEXT,
  battle_code TEXT NOT NULL,
  record_index INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT,
  location TEXT,
  match_type INTEGER,
  end_round INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  winner_side TEXT,
  attacker_json TEXT NOT NULL DEFAULT '{}',
  defender_json TEXT NOT NULL DEFAULT '{}',
  battlefield_environment_json TEXT NOT NULL DEFAULT '{}',
  raw_artifact_id INTEGER,
  UNIQUE(workspace_id, alliance_id, battle_code, record_index),
  FOREIGN KEY(capture_session_id) REFERENCES capture_session(id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY(alliance_id) REFERENCES alliance(id) ON DELETE CASCADE,
  FOREIGN KEY(raw_artifact_id) REFERENCES raw_artifact(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS lineup_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  alliance_id INTEGER,
  player_id INTEGER,
  side TEXT NOT NULL,
  lineup_fingerprint TEXT NOT NULL,
  label TEXT NOT NULL,
  heroes_json TEXT NOT NULL,
  source_battle_id TEXT,
  confidence TEXT NOT NULL DEFAULT 'user_confirmed',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, player_id, lineup_fingerprint, valid_from),
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
  FOREIGN KEY(alliance_id) REFERENCES alliance(id) ON DELETE SET NULL,
  FOREIGN KEY(player_id) REFERENCES player(id) ON DELETE SET NULL
);
