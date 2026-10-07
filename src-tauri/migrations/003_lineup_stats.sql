CREATE TABLE IF NOT EXISTS lineup_stat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  avatar_id TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT '',
  alliance_name TEXT NOT NULL DEFAULT '',
  lineup_key TEXT NOT NULL,
  label TEXT NOT NULL,
  formation_id TEXT NOT NULL DEFAULT '',
  formation_name TEXT NOT NULL DEFAULT '',
  hero_ids_json TEXT NOT NULL DEFAULT '[]',
  hero_levels_json TEXT NOT NULL DEFAULT '[]',
  avg_evolution REAL NOT NULL DEFAULT 0,
  battles INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  attack_battles INTEGER NOT NULL DEFAULT 0,
  defend_battles INTEGER NOT NULL DEFAULT 0,
  total_merit INTEGER NOT NULL DEFAULT 0,
  total_origin_troops INTEGER NOT NULL DEFAULT 0,
  total_remaining_troops INTEGER NOT NULL DEFAULT 0,
  total_wounded INTEGER NOT NULL DEFAULT 0,
  total_dead INTEGER NOT NULL DEFAULT 0,
  total_enemy_origin_troops INTEGER NOT NULL DEFAULT 0,
  total_enemy_remaining_troops INTEGER NOT NULL DEFAULT 0,
  total_enemy_wounded INTEGER NOT NULL DEFAULT 0,
  total_enemy_dead INTEGER NOT NULL DEFAULT 0,
  loss_exchange_ratio REAL NOT NULL DEFAULT 0,
  last_battle_time TEXT NOT NULL DEFAULT '',
  notes TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE(workspace_id, avatar_id, lineup_key),
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lineup_matchup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  attacker_avatar_id TEXT NOT NULL,
  attacker_player_name TEXT NOT NULL DEFAULT '',
  attacker_lineup_key TEXT NOT NULL,
  attacker_lineup_label TEXT NOT NULL DEFAULT '',
  defender_avatar_id TEXT NOT NULL,
  defender_player_name TEXT NOT NULL DEFAULT '',
  defender_lineup_key TEXT NOT NULL,
  defender_lineup_label TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'unknown',
  battle_time TEXT NOT NULL DEFAULT '',
  battle_code TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  UNIQUE(workspace_id, battle_code, attacker_lineup_key, defender_lineup_key),
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lineup_stat_workspace_avatar ON lineup_stat(workspace_id, avatar_id);
CREATE INDEX IF NOT EXISTS idx_lineup_stat_workspace_key ON lineup_stat(workspace_id, lineup_key);
CREATE INDEX IF NOT EXISTS idx_lineup_stat_last_battle ON lineup_stat(workspace_id, last_battle_time DESC);
CREATE INDEX IF NOT EXISTS idx_lineup_matchup_workspace ON lineup_matchup(workspace_id, attacker_lineup_key, defender_lineup_key);
CREATE INDEX IF NOT EXISTS idx_lineup_matchup_attacker ON lineup_matchup(workspace_id, attacker_avatar_id);
CREATE INDEX IF NOT EXISTS idx_lineup_matchup_defender ON lineup_matchup(workspace_id, defender_avatar_id);
