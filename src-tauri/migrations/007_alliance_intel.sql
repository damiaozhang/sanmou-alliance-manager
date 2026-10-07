-- 007_alliance_intel.sql
-- 同盟情报（新增域）通用存储。
--
-- 覆盖本轮新增的四个采集域：全服排行榜、全服武将/技能红度普查、赛季战队（备战区队伍）、
-- 主公簿（玩家档案）；并预留同盟建筑快照、同盟历史。这些域的共同特征是
-- **结构多变、字段随赛季演进**，若为每个域建一张宽表，每次协议调整都要改 Rust 结构体 +
-- ts-rs 绑定 + 前端类型，成本远高于收益。
--
-- 因此采用「快照 + 条目」两表：
--   * alliance_intel_snapshot —— 一次采集中的一个"主题"（如「繁荣榜·司仓」这类榜单、
--     某个玩家的红度普查、某支赛季战队），承载可查询的核心指标与原始载荷；
--   * alliance_intel_entry   —— 该主题下的明细行（榜单名次、战队成员、武将红度行），
--     统一暴露 (rank, subject_key, name, union_name, value)，使前端可以用同一张表渲染，
--     各域的差异只在 extra_json 里。
--
-- 保留策略：这两张表是**派生窗口**，可随时整表删除并由下次采集重建
-- （与 P2-2 的 alliance_records 同一定位，不做在线迁移）。

CREATE TABLE IF NOT EXISTS alliance_intel_snapshot (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id      INTEGER NOT NULL,
  capture_session_id INTEGER,
  alliance_id       INTEGER,
  -- server_rank | hero_rating | season_team | player_profile | union_building | union_history
  kind              TEXT    NOT NULL,
  -- 主题键：榜单类型码 / 玩家 pid / 队伍 id / 建筑 id
  subject_key       TEXT    NOT NULL DEFAULT '',
  -- 主题可读名：如「繁荣榜·全职业」「钟会」「备战区战队」
  subject_label     TEXT    NOT NULL DEFAULT '',
  observed_at       TEXT    NOT NULL,
  entry_count       INTEGER NOT NULL DEFAULT 0,
  -- 该主题的核心指标（前端 KPI 用），如 {"selfRank":12,"selfValue":59723}
  metrics_json      TEXT    NOT NULL DEFAULT '{}',
  -- 游戏原始载荷，保留以便协议演进后重新解析而无需重采
  payload_json      TEXT    NOT NULL DEFAULT '{}',
  -- 来源 RPC 函数名，排查用
  source_func       TEXT    NOT NULL DEFAULT '',
  UNIQUE(workspace_id, kind, subject_key, observed_at),
  FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intel_snapshot_kind
    ON alliance_intel_snapshot(workspace_id, kind, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_intel_snapshot_subject
    ON alliance_intel_snapshot(workspace_id, kind, subject_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS alliance_intel_entry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  kind        TEXT    NOT NULL,
  -- 名次（榜单）或序号（战队成员、武将列表）；无顺序语义时为 0
  rank        INTEGER NOT NULL DEFAULT 0,
  -- 行主体键：pid / 武将 id / 技能 id / 建筑 id
  subject_key TEXT    NOT NULL DEFAULT '',
  name        TEXT    NOT NULL DEFAULT '',
  union_name  TEXT    NOT NULL DEFAULT '',
  -- 统一数值列：榜单为榜单值（繁荣/武勋/积分…），红度为红度分
  value       REAL    NOT NULL DEFAULT 0,
  extra_json  TEXT    NOT NULL DEFAULT '{}',
  FOREIGN KEY(snapshot_id) REFERENCES alliance_intel_snapshot(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intel_entry_snapshot
    ON alliance_intel_entry(snapshot_id, rank);

-- 跨榜排名：红度普查要按武将聚合，排行榜要按值取头部
CREATE INDEX IF NOT EXISTS idx_intel_entry_lookup
    ON alliance_intel_entry(workspace_id, kind, subject_key);
