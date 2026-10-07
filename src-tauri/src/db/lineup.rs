use crate::error::AppResult;
use crate::models::{LineupAnalysisBundle, LineupMatchupInput, UpsertLineupStatRequest};
use chrono::Local;
use rusqlite::{params, Connection};

use super::query::{query_lineup_matchups, query_lineup_stats};
use super::Database;

impl Database {
    pub fn upsert_lineup_stat(&self, request: &UpsertLineupStatRequest) -> AppResult<()> {
        let conn = self.conn();
        let now = Local::now().to_rfc3339();
        upsert_lineup_stat_row(&conn, request, &now)
    }

    pub fn upsert_lineup_stats(&self, requests: &[UpsertLineupStatRequest]) -> AppResult<usize> {
        let mut conn = self.conn();
        let now = Local::now().to_rfc3339();
        let transaction = conn.transaction()?;
        let mut written = 0usize;
        for request in requests {
            upsert_lineup_stat_row(&transaction, request, &now)?;
            written += 1;
        }
        transaction.commit()?;
        Ok(written)
    }

    pub fn upsert_lineup_matchup(&self, input: &LineupMatchupInput) -> AppResult<()> {
        let conn = self.conn();
        let now = Local::now().to_rfc3339();
        upsert_lineup_matchup_row(&conn, input, &now)
    }

    pub fn upsert_lineup_matchups(&self, inputs: &[LineupMatchupInput]) -> AppResult<usize> {
        let mut conn = self.conn();
        let now = Local::now().to_rfc3339();
        let transaction = conn.transaction()?;
        let mut written = 0usize;
        for input in inputs {
            upsert_lineup_matchup_row(&transaction, input, &now)?;
            written += 1;
        }
        transaction.commit()?;
        Ok(written)
    }

    pub fn query_lineup_analysis(
        &self,
        workspace_id: Option<i64>,
    ) -> AppResult<LineupAnalysisBundle> {
        let conn = self.conn();
        let stats = if workspace_id.is_some() {
            query_lineup_stats(&conn, workspace_id)?
        } else {
            query_lineup_stats(&conn, None)?
        };
        let matchups = if workspace_id.is_some() {
            query_lineup_matchups(&conn, workspace_id)?
        } else {
            query_lineup_matchups(&conn, None)?
        };
        Ok(LineupAnalysisBundle { stats, matchups })
    }

    pub fn save_lineup_stat_notes(&self, stat_id: i64, notes: &str) -> AppResult<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE lineup_stat SET notes = ?1 WHERE id = ?2",
            params![notes, stat_id],
        )?;
        Ok(())
    }

    pub fn delete_lineup_stat(&self, stat_id: i64) -> AppResult<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM lineup_stat WHERE id = ?1", params![stat_id])?;
        Ok(())
    }
}

pub(super) fn upsert_lineup_stat_row(
    conn: &Connection,
    request: &UpsertLineupStatRequest,
    now: &str,
) -> AppResult<()> {
    let hero_ids_json = serde_json::to_string(&request.hero_ids)?;
    let hero_levels_json = serde_json::to_string(&request.hero_levels)?;
    conn.execute(
        "INSERT INTO lineup_stat (
            workspace_id, avatar_id, player_name, alliance_name,
            lineup_key, label, formation_id, formation_name,
            hero_ids_json, hero_levels_json, avg_evolution,
            battles, wins, losses, draws,
            attack_battles, defend_battles,
            total_merit, total_origin_troops, total_remaining_troops,
            total_wounded, total_dead,
            total_enemy_origin_troops, total_enemy_remaining_troops,
            total_enemy_wounded, total_enemy_dead,
            loss_exchange_ratio, last_battle_time, notes, observed_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
            ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30
        )
        ON CONFLICT(workspace_id, avatar_id, lineup_key) DO UPDATE SET
            player_name = excluded.player_name,
            alliance_name = excluded.alliance_name,
            label = excluded.label,
            formation_id = excluded.formation_id,
            formation_name = excluded.formation_name,
            hero_ids_json = excluded.hero_ids_json,
            hero_levels_json = excluded.hero_levels_json,
            avg_evolution = excluded.avg_evolution,
            battles = excluded.battles,
            wins = excluded.wins,
            losses = excluded.losses,
            draws = excluded.draws,
            attack_battles = excluded.attack_battles,
            defend_battles = excluded.defend_battles,
            total_merit = excluded.total_merit,
            total_origin_troops = excluded.total_origin_troops,
            total_remaining_troops = excluded.total_remaining_troops,
            total_wounded = excluded.total_wounded,
            total_dead = excluded.total_dead,
            total_enemy_origin_troops = excluded.total_enemy_origin_troops,
            total_enemy_remaining_troops = excluded.total_enemy_remaining_troops,
            total_enemy_wounded = excluded.total_enemy_wounded,
            total_enemy_dead = excluded.total_enemy_dead,
            loss_exchange_ratio = excluded.loss_exchange_ratio,
            last_battle_time = excluded.last_battle_time,
            notes = COALESCE(excluded.notes, lineup_stat.notes),
            observed_at = excluded.observed_at",
        params![
            request.workspace_id,
            request.avatar_id,
            request.player_name,
            request.alliance_name,
            request.lineup_key,
            request.label,
            request.formation_id,
            request.formation_name,
            hero_ids_json,
            hero_levels_json,
            request.avg_evolution,
            request.battles,
            request.wins,
            request.losses,
            request.draws,
            request.attack_battles,
            request.defend_battles,
            request.total_merit,
            request.total_origin_troops,
            request.total_remaining_troops,
            request.total_wounded,
            request.total_dead,
            request.total_enemy_origin_troops,
            request.total_enemy_remaining_troops,
            request.total_enemy_wounded,
            request.total_enemy_dead,
            request.loss_exchange_ratio,
            request.last_battle_time,
            request.notes,
            now,
        ],
    )?;
    Ok(())
}

pub(super) fn upsert_lineup_matchup_row(
    conn: &Connection,
    input: &LineupMatchupInput,
    now: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO lineup_matchup (
            workspace_id, attacker_avatar_id, attacker_player_name,
            attacker_lineup_key, attacker_lineup_label,
            defender_avatar_id, defender_player_name,
            defender_lineup_key, defender_lineup_label,
            outcome, battle_time, battle_code, observed_at,
            match_type, combat_type, scenario_id, end_round, location
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
        ON CONFLICT(workspace_id, battle_code, attacker_lineup_key, defender_lineup_key) DO UPDATE SET
            attacker_avatar_id = excluded.attacker_avatar_id,
            attacker_player_name = excluded.attacker_player_name,
            attacker_lineup_label = excluded.attacker_lineup_label,
            defender_avatar_id = excluded.defender_avatar_id,
            defender_player_name = excluded.defender_player_name,
            defender_lineup_label = excluded.defender_lineup_label,
            outcome = excluded.outcome,
            battle_time = excluded.battle_time,
            observed_at = excluded.observed_at,
            match_type = excluded.match_type,
            combat_type = excluded.combat_type,
            scenario_id = excluded.scenario_id,
            end_round = excluded.end_round,
            location = excluded.location",
        params![
            input.workspace_id,
            input.attacker_avatar_id,
            input.attacker_player_name,
            input.attacker_lineup_key,
            input.attacker_lineup_label,
            input.defender_avatar_id,
            input.defender_player_name,
            input.defender_lineup_key,
            input.defender_lineup_label,
            input.outcome,
            input.battle_time,
            input.battle_code,
            now,
            input.match_type,
            input.combat_type,
            input.scenario_id,
            input.end_round,
            input.location,
        ],
    )?;
    Ok(())
}
