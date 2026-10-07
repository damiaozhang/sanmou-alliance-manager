# -*- coding: utf-8 -*-
"""
Reporter module - Generate battle reports in multiple formats:
txt, json, markdown, csv
"""
import csv
import io
from datetime import datetime
from typing import Optional

class Reporter:
    """Battle report generator with multiple output formats"""
    
    def __init__(self):
        self.lineup_override = None
        self.hero_label_map = {}
    
    def generate_text(self, parser) -> Optional[str]:
        """Generate text-format battle report with full statistics"""
        if not parser.events:
            return None
            
        lines = [
            "=" * 60,
            "  三国谋定天下 — 明文战报 (v2.1)",
            f"  时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 60,
            ""
        ]
        
        lineup = self.lineup_override or parser.get_lineup()
        using_ocr_lineup = self._uses_ocr_lineup(lineup)
        if lineup:
            lines.extend(self._render_lineup(lineup))
            lines.append("")
            
        if parser.heroes and not using_ocr_lineup:
            lines.append(f"  参战武将: {', '.join(self._label_hero(hero) for hero in sorted(parser.heroes))}")
        if parser.skills and not using_ocr_lineup:
            lines.append(f"  涉及战法: {', '.join(sorted(parser.skills))}")
        if hasattr(parser, 'treatises') and parser.treatises and not using_ocr_lineup:
            lines.append(f"  韬略: {', '.join(sorted(parser.treatises))}")
        if parser.formations and not using_ocr_lineup:
            lines.append(f"  布阵: {', '.join(sorted(parser.formations))}")
        if not using_ocr_lineup:
            lines.append("")
        
        deploy = parser.get_deploy_summary()
        if any(deploy.values()):
            lines.extend(self._render_deploy_summary(deploy))
        
        deploy_events = [e for e in parser.events if e.get("phase") == "deploy"]
        if deploy_events:
            lines.extend([
                "-" * 60,
                "  【布阵阶段】",
                "-" * 60,
                ""
            ])
            prev_line = None
            for e in deploy_events:
                line = self._format_event(e)
                if line and line != prev_line:
                    lines.append(f"  {line}")
                    prev_line = line
            lines.append("")
            
        combat_events = [e for e in parser.events if e.get("phase") == "combat"]
        if combat_events:
            lines.extend([
                "-" * 60,
                "  【战斗记录】",
                "-" * 60,
                ""
            ])
            
            rounds = self._group_combat_rounds(combat_events)
                
            for ri, rnd in enumerate(rounds, 1):
                lines.append(f"── 第 {ri} 回合 ──")
                prev_line = None
                for e in rnd:
                    line = self._format_combat_event(e)
                    if line and line != prev_line:
                        lines.append(f"  {line}")
                        prev_line = line
                lines.append("")
                
        ocr_hero_stats = self.get_lineup_hero_stats(lineup)
        if ocr_hero_stats:
            lines.extend(self._render_ocr_hero_stats(ocr_hero_stats))

        hero_stats = parser.get_hero_stats()
        if hero_stats:
            lines.extend(self._render_hero_stats(hero_stats, has_ocr_stats=bool(ocr_hero_stats)))
            
        buff_data = parser.get_buff_summary()
        if buff_data.get("timeline"):
            lines.extend(self._render_buff_timeline(buff_data["timeline"]))
            
        lines.extend([
            "-" * 60,
            "  战报结束",
            "-" * 60
        ])
        
        return "\n".join(lines)
    
    def generate_markdown(self, parser) -> Optional[str]:
        """Generate markdown-format battle report"""
        if not parser.events:
            return None
            
        lines = [
            "# 三国谋定天下 — 战报 (v2.1)",
            "",
            f"**时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            ""
        ]
        
        lineup = self.lineup_override or parser.get_lineup()
        using_ocr_lineup = self._uses_ocr_lineup(lineup)
        if lineup:
            lines.extend(self._render_lineup_md(lineup))
            lines.append("")
        
        if parser.heroes and not using_ocr_lineup:
            lines.append(f"**参战武将**: {', '.join(self._label_hero(hero) for hero in sorted(parser.heroes))}")
        if parser.skills and not using_ocr_lineup:
            lines.append(f"**涉及战法**: {', '.join(sorted(parser.skills))}")
        if hasattr(parser, 'treatises') and parser.treatises and not using_ocr_lineup:
            lines.append(f"**韬略**: {', '.join(sorted(parser.treatises))}")
        if not using_ocr_lineup:
            lines.append("")
        
        deploy = parser.get_deploy_summary()
        if any(deploy.values()):
            lines.extend(self._render_deploy_summary_md(deploy))
        
        ocr_hero_stats = self.get_lineup_hero_stats(lineup)
        if ocr_hero_stats:
            lines.extend(self._render_ocr_hero_stats_md(ocr_hero_stats))

        hero_stats = parser.get_hero_stats()
        if hero_stats:
            lines.extend([
                "## Frida 事件观察统计（已去重/非总量校准）" if ocr_hero_stats else "## 数据统计",
                "",
                "| 武将 | 来源伤害 | 承受伤害 | 来源治疗 | 受疗 | 发动 | 未发动 |",
                "|------|----------|----------|----------|------|------|--------|",
            ])
            for hero, stats in sorted(hero_stats.items()):
                lines.append(
                    f"| {hero} | {stats.get('damage_dealt', 0)} | {stats.get('damage_taken', 0)} | "
                    f"{stats.get('heal_done', 0)} | {stats.get('heal_received', 0)} | "
                    f"{stats.get('skill_cast_count', 0)} | {stats.get('skill_fail_count', 0)} |"
                )
            lines.append("")
        
        deploy_events = [e for e in parser.events if e.get("phase") == "deploy"]
        if deploy_events:
            lines.extend([
                "## 布阵阶段",
                ""
            ])
            prev_line = None
            for e in deploy_events:
                line = self._format_event(e)
                if line and line != prev_line:
                    lines.append(f"- {line}")
                    prev_line = line
            lines.append("")
            
        combat_events = [e for e in parser.events if e.get("phase") == "combat"]
        if combat_events:
            lines.extend([
                "## 战斗记录",
                ""
            ])
            
            rounds = self._group_combat_rounds(combat_events)
                
            for ri, rnd in enumerate(rounds, 1):
                lines.append(f"### 第 {ri} 回合")
                lines.append("")
                prev_line = None
                for e in rnd:
                    line = self._format_combat_event(e)
                    if line and line != prev_line:
                        lines.append(f"- {line}")
                        prev_line = line
                lines.append("")
                
        buff_data = parser.get_buff_summary()
        if buff_data.get("timeline"):
            lines.extend(self._render_buff_timeline_md(buff_data["timeline"]))
                
        lines.append("---")
        lines.append("*Generated by Battle Grabber v2.1*")
        
        return "\n".join(lines)
        
    def generate_csv(self, parser) -> Optional[str]:
        """Generate CSV-format battle report for spreadsheet analysis"""
        if not parser.events:
            return None
            
        output = io.StringIO()
        writer = csv.writer(output, lineterminator='\n')
        
        lineup = self.lineup_override or parser.get_lineup()
        ocr_hero_stats = self.get_lineup_hero_stats(lineup)
        if ocr_hero_stats:
            writer.writerow(["=== OCR 武将战法合计 ==="])
            writer.writerow(["武将", "队伍", "杀敌", "治疗", "释放次数", "战法行数", "来源"])
            for hero, stats in sorted(ocr_hero_stats.items()):
                writer.writerow([
                    stats.get("name", hero),
                    stats.get("team", ""),
                    stats["damage_dealt"],
                    stats["heal_done"],
                    stats["skill_casts"],
                    stats["tactic_count"],
                    stats["source"],
                ])
            writer.writerow([])

        hero_stats = parser.get_hero_stats()
        if hero_stats:
            writer.writerow(["=== Frida 事件观察统计（已去重/非总量校准） ==="] if ocr_hero_stats else ["=== 武将统计 ==="])
            writer.writerow(["武将", "来源伤害", "承受伤害", "来源治疗", "受疗", "发动次数", "未发动次数", "使用战法", "施加Buff"])
            for hero, stats in sorted(hero_stats.items()):
                writer.writerow([
                    hero,
                    stats.get("damage_dealt", 0),
                    stats.get("damage_taken", 0),
                    stats.get("heal_done", 0),
                    stats.get("heal_received", 0),
                    stats.get("skill_cast_count", 0),
                    stats.get("skill_fail_count", 0),
                    "; ".join(stats.get("skills_used", [])),
                    "; ".join(stats.get("buffs_applied", []))
                ])
            writer.writerow([])
        
        structured = parser.get_structured_data()
        if structured:
            writer.writerow(["=== 事件明细 ==="])
            writer.writerow(["序号", "阶段", "类型", "角色", "目标", "战法", "Buff", "伤害", "治疗", "原始文本"])
            for seq, evt in enumerate(structured):
                writer.writerow([
                    seq,
                    evt.get("phase", ""),
                    evt.get("type", ""),
                    evt.get("actor", ""),
                    evt.get("target", ""),
                    evt.get("skill", ""),
                    evt.get("buff", ""),
                    evt.get("dmg", ""),
                    evt.get("heal", ""),
                    evt.get("raw", "")
                ])
        
        return output.getvalue()

    def _group_combat_rounds(self, combat_events: list) -> list:
        """Group combat events by action-order markers.

        The game emits "行动顺序判断完毕" before each round's actions. Treating it
        as the end of a round creates an empty first round, so it is a separator.
        """
        rounds = []
        current_round = []
        for event in combat_events:
            if event.get("type") == "order_done":
                if current_round:
                    if len(rounds) < 8:
                        rounds.append(current_round)
                    else:
                        rounds[-1].extend(current_round)
                    current_round = []
                continue
            current_round.append(event)
        if current_round:
            if len(rounds) < 8:
                rounds.append(current_round)
            else:
                rounds[-1].extend(current_round)
        return rounds

    def _label_hero(self, hero: str) -> str:
        label = self.hero_label_map.get(hero, "")
        if not label:
            return hero
        return f"{hero}({label})"

    def _uses_ocr_lineup(self, lineup: dict) -> bool:
        return any(team.get("source") == "ocr_detail" for team in (lineup or {}).values())

    def _safe_int(self, value, default: int = 0) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return default

    def get_lineup_hero_stats(self, lineup: dict) -> dict:
        """Aggregate official OCR detail tactic rows by hero.

        These totals come from the settlement panel OCR and are separate from
        parser.get_hero_stats(), which is only the parsed Frida text stream.
        """
        result = {}
        name_counts = {}
        for team in (lineup or {}).values():
            if team.get("source") != "ocr_detail":
                continue
            for hero in team.get("heroes", []):
                name = hero.get("name", "")
                if name:
                    name_counts[name] = name_counts.get(name, 0) + 1

        for team_key, team in (lineup or {}).items():
            if team.get("source") != "ocr_detail":
                continue
            team_label = team.get("label") or team_key
            for hero in team.get("heroes", []):
                name = hero.get("name", "")
                if not name:
                    continue
                stat_key = f"{team_label}:{name}" if name_counts.get(name, 0) > 1 else name
                row = result.setdefault(stat_key, {
                    "name": name,
                    "team": team_label,
                    "damage_dealt": 0,
                    "heal_done": 0,
                    "skill_casts": 0,
                    "tactic_count": 0,
                    "tactic_cast_counts": {},
                    "source": "lineup.ocr_detail.tactics",
                })
                for tactic in hero.get("tactics", []):
                    tactic_name = tactic.get("name", "")
                    tactic_count = self._safe_int(tactic.get("count"))
                    row["damage_dealt"] += self._safe_int(tactic.get("damage"))
                    row["heal_done"] += self._safe_int(tactic.get("heal"))
                    row["skill_casts"] += tactic_count
                    row["tactic_count"] += 1
                    if tactic_name:
                        row["tactic_cast_counts"][tactic_name] = row["tactic_cast_counts"].get(tactic_name, 0) + tactic_count
        return result

    def compare_hero_stats(self, frida_stats: dict, ocr_stats: dict) -> dict:
        frida_damage = sum(self._safe_int(s.get("damage_dealt")) for s in (frida_stats or {}).values())
        frida_damage_taken = sum(self._safe_int(s.get("damage_taken")) for s in (frida_stats or {}).values())
        frida_heal = sum(self._safe_int(s.get("heal_done")) for s in (frida_stats or {}).values())
        frida_heal_received = sum(self._safe_int(s.get("heal_received")) for s in (frida_stats or {}).values())
        frida_skill_casts = sum(self._safe_int(s.get("skill_cast_count")) for s in (frida_stats or {}).values())
        frida_skill_fails = sum(self._safe_int(s.get("skill_fail_count")) for s in (frida_stats or {}).values())
        frida_ocr_tactic_skill_casts = 0
        ocr_damage = sum(self._safe_int(s.get("damage_dealt")) for s in (ocr_stats or {}).values())
        ocr_heal = sum(self._safe_int(s.get("heal_done")) for s in (ocr_stats or {}).values())
        ocr_skill_casts = sum(self._safe_int(s.get("skill_casts")) for s in (ocr_stats or {}).values())
        for stat_key, ocr_row in (ocr_stats or {}).items():
            frida_row = (frida_stats or {}).get(stat_key)
            if not frida_row:
                frida_row = (frida_stats or {}).get(ocr_row.get("name", ""))
            if not frida_row:
                continue
            frida_counts = frida_row.get("skill_cast_counts") or {}
            for tactic_name in (ocr_row.get("tactic_cast_counts") or {}).keys():
                frida_ocr_tactic_skill_casts += self._safe_int(frida_counts.get(tactic_name))
        return {
            "frida_damage_dealt": frida_damage,
            "frida_damage_taken": frida_damage_taken,
            "ocr_damage_dealt": ocr_damage,
            "damage_capture_rate": round(frida_damage / ocr_damage, 6) if ocr_damage else None,
            "frida_heal_done": frida_heal,
            "frida_heal_received": frida_heal_received,
            "ocr_heal_done": ocr_heal,
            "heal_capture_rate": round(frida_heal / ocr_heal, 6) if ocr_heal else None,
            "heal_received_vs_ocr_done_rate": round(frida_heal_received / ocr_heal, 6) if ocr_heal else None,
            "frida_skill_casts": frida_skill_casts,
            "frida_ocr_tactic_skill_casts": frida_ocr_tactic_skill_casts,
            "frida_skill_fails": frida_skill_fails,
            "ocr_skill_casts": ocr_skill_casts,
            "skill_cast_capture_rate": round(frida_skill_casts / ocr_skill_casts, 6) if ocr_skill_casts else None,
            "ocr_tactic_skill_cast_capture_rate": round(frida_ocr_tactic_skill_casts / ocr_skill_casts, 6) if ocr_skill_casts else None,
            "note": "frida_damage_dealt is source-attributed parsed damage; frida_heal_received is receiver-side text and is not equivalent to OCR heal_done.",
        }

    def _format_tactic(self, tactic: dict) -> str:
        name = tactic.get("name", "")
        parts = [
            f"释放 {tactic.get('count', 0)}",
            f"杀敌 {tactic.get('damage', 0)}",
            f"治疗 {tactic.get('heal', 0)}",
        ]
        return f"{name}：" + "，".join(parts)

    def _annotate_raw(self, raw: str) -> str:
        text = raw or ""
        if not text or not self.hero_label_map:
            return text

        def repl(match):
            name = match.group(1)
            return f"[{self._label_hero(name)}]"

        import re
        return re.sub(r"\[([^\[\]]+)\]", repl, text)
        
    def _render_lineup(self, lineup: dict) -> list:
        """Render attacker/defender lineup sections"""
        using_ocr = self._uses_ocr_lineup(lineup)
        title = "  【OCR 详情阵容】" if using_ocr else "  【攻守阵容】"
        lines = [
            "=" * 60,
            title,
            "=" * 60,
        ]
        
        for team_key, team in lineup.items():
            label = team.get("label", team_key)
            lines.append(f"\n  ■ {label}" if using_ocr else f"\n  ■ {label} ({team_key})")

            if team.get("player"):
                lines.append(f"    玩家: {team['player']}")
            if team.get("alliance"):
                lines.append(f"    同盟: {team['alliance']}")
            
            if team.get("formation"):
                lines.append(f"    阵型: 【{team['formation']}】")
                
            supply = team.get("supply")
            if isinstance(supply, dict) and supply:
                lines.append(f"    补给: {supply['supply']} (伤害降低{supply['penalty']}%)")
            elif supply:
                lines.append(f"    补给: {supply}")

            if team.get("troops"):
                lines.append(f"    兵力: {team['troops']}")
            if team.get("battle_damage") not in ("", None):
                lines.append(f"    战损: {team['battle_damage']}")
                
            country = team.get("country")
            if country:
                lines.append(f"    国家: {country.get('country', '')} +{country.get('bonus', '')}%")
                
            if team.get("has_tech"):
                lines.append("    建筑科技: 已激活")
            if team.get("has_troop_buff"):
                lines.append("    兵种强化: 已激活")
                
            for hero in team.get("heroes", []):
                lines.append(f"\n    [{hero['name']}]")
                if "redness" in hero:
                    lines.append(f"      红度: {hero.get('redness', 0)}")
                if hero.get("status"):
                    lines.append(f"      状态: {hero['status']}")
                if hero.get("troops"):
                    lines.append(f"      兵力变化: {hero['troops']}")
                if hero.get("tactics"):
                    lines.append("      战法:")
                    for tactic in hero.get("tactics", []):
                        lines.append(f"        - {self._format_tactic(tactic)}")
                elif hero.get("skills"):
                    lines.append(f"      战法: {', '.join(hero['skills'])}")
                if hero.get("treatises"):
                    lines.append(f"      韬略: {', '.join(hero['treatises'])}")
                if hero.get("equip"):
                    lines.append(f"      装备: {hero['equip']}")
                if hero.get("horse"):
                    lines.append(f"      马匹: {hero['horse']}")
                    
        return lines

    def _render_deploy_summary(self, deploy: dict) -> list:
        """Render deploy summary for text format"""
        lines = [
            "-" * 60,
            "  【布阵统计】",
            "-" * 60,
        ]
        
        if deploy.get("formations"):
            for team, formation in deploy["formations"].items():
                lines.append(f"  {team}队 阵型: 【{formation}】")
                
        if deploy.get("supply"):
            for team, info in deploy["supply"].items():
                lines.append(f"  {team}队 补给: {info['supply']} (伤害降低{info['penalty']}%)")
                
        if deploy.get("country_buffs"):
            for team, info in deploy["country_buffs"].items():
                lines.append(f"  {team}队 国家加成: {info['country']} +{info['bonus']}%")
                
        if deploy.get("troop_buffs"):
            lines.append(f"  兵种强化: {', '.join(deploy['troop_buffs'])}")
            
        if deploy.get("tech_buff"):
            lines.append("  建筑科技强化: 已激活")
            
        if deploy.get("team_buffs"):
            for team, buffs in deploy["team_buffs"].items():
                lines.append(f"  {team}队 强化: {', '.join(buffs)}")
                
        if deploy.get("initial_equip"):
            lines.append("  装备效果:")
            for eq in deploy["initial_equip"]:
                lines.append(f"    [{eq['actor']}] {eq['equip']}")
                
        if deploy.get("initial_horse"):
            lines.append("  马匹效果:")
            for ho in deploy["initial_horse"]:
                lines.append(f"    [{ho['actor']}] {ho['horse']}")
                
        lines.append("")
        return lines
        
    def _render_lineup_md(self, lineup: dict) -> list:
        """Render attacker/defender lineup sections in markdown"""
        using_ocr = self._uses_ocr_lineup(lineup)
        heading = "## OCR 详情阵容" if using_ocr else "## 攻守阵容"
        lines = [
            heading,
            ""
        ]
        
        for team_key, team in lineup.items():
            label = team.get("label", team_key)
            lines.append(f"### {label}" if using_ocr else f"### {label} ({team_key})")
            lines.append("")

            if team.get("player"):
                lines.append(f"- **玩家**: {team['player']}")
            if team.get("alliance"):
                lines.append(f"- **同盟**: {team['alliance']}")
            
            if team.get("formation"):
                lines.append(f"- **阵型**: 【{team['formation']}】")
                
            supply = team.get("supply")
            if isinstance(supply, dict) and supply:
                lines.append(f"- **补给**: {supply['supply']} (伤害降低{supply['penalty']}%)")
            elif supply:
                lines.append(f"- **补给**: {supply}")

            if team.get("troops"):
                lines.append(f"- **兵力**: {team['troops']}")
            if team.get("battle_damage") not in ("", None):
                lines.append(f"- **战损**: {team['battle_damage']}")
                
            country = team.get("country")
            if country:
                lines.append(f"- **国家**: {country.get('country', '')} +{country.get('bonus', '')}%")
                
            if team.get("has_tech"):
                lines.append("- **建筑科技**: 已激活")
            if team.get("has_troop_buff"):
                lines.append("- **兵种强化**: 已激活")
                
            lines.append("")
            lines.append("| 武将 | 红度 | 状态 | 兵力变化 | 战法 | 韬略 | 装备 | 马匹 |")
            lines.append("|------|------|------|----------|------|------|------|------|")
            for hero in team.get("heroes", []):
                skills = "<br>".join(self._format_tactic(tactic) for tactic in hero.get("tactics", []))
                if not skills:
                    skills = ", ".join(hero.get("skills", []))
                treatises = ", ".join(hero.get("treatises", []))
                equip = hero.get("equip", "")
                horse = hero.get("horse", "")
                status = hero.get("status", "")
                troops = hero.get("troops", "")
                redness = hero.get("redness", "")
                lines.append(f"| {hero['name']} | {redness} | {status} | {troops} | {skills} | {treatises} | {equip} | {horse} |")
            lines.append("")
            
        return lines

    def _render_deploy_summary_md(self, deploy: dict) -> list:
        """Render deploy summary for markdown format"""
        lines = [
            "## 布阵统计",
            ""
        ]
        
        if deploy.get("formations"):
            for team, formation in deploy["formations"].items():
                lines.append(f"- **{team}队** 阵型: 【{formation}】")
                
        if deploy.get("supply"):
            for team, info in deploy["supply"].items():
                lines.append(f"- **{team}队** 补给: {info['supply']} (伤害降低{info['penalty']}%)")
                
        if deploy.get("country_buffs"):
            for team, info in deploy["country_buffs"].items():
                lines.append(f"- **{team}队** 国家加成: {info['country']} +{info['bonus']}%")
                
        if deploy.get("troop_buffs"):
            lines.append(f"- 兵种强化: {', '.join(deploy['troop_buffs'])}")
            
        if deploy.get("tech_buff"):
            lines.append("- 建筑科技强化: 已激活")
            
        lines.append("")
        return lines
        
    def _render_ocr_hero_stats(self, ocr_hero_stats: dict) -> list:
        """Render OCR settlement-panel tactic totals by hero."""
        lines = [
            "-" * 60,
            "  【OCR 武将战法合计（推荐作校准真值）】",
            "-" * 60,
            f"  {'武将':<10} {'队伍':<8} {'杀敌':>8} {'治疗':>8} {'释放':>8}",
            f"  {'-'*10} {'-'*8} {'-'*8} {'-'*8} {'-'*8}",
        ]
        for hero, stats in sorted(ocr_hero_stats.items()):
            lines.append(
                f"  {stats.get('name', hero):<10} {stats.get('team', ''):<8} "
                f"{stats['damage_dealt']:>8} {stats['heal_done']:>8} {stats['skill_casts']:>8}"
            )
        lines.append("")
        return lines

    def _render_ocr_hero_stats_md(self, ocr_hero_stats: dict) -> list:
        lines = [
            "## OCR 武将战法合计（推荐作校准真值）",
            "",
            "| 武将 | 队伍 | 杀敌 | 治疗 | 释放次数 |",
            "|------|------|------|------|----------|",
        ]
        for hero, stats in sorted(ocr_hero_stats.items()):
            lines.append(
                f"| {stats.get('name', hero)} | {stats.get('team', '')} | {stats['damage_dealt']} | "
                f"{stats['heal_done']} | {stats['skill_casts']} |"
            )
        lines.append("")
        return lines

    def _render_hero_stats(self, hero_stats: dict, has_ocr_stats: bool = False) -> list:
        """Render hero statistics section"""
        title = "  【Frida 事件观察统计（已去重/非总量校准）】" if has_ocr_stats else "  【武将数据】"
        lines = [
            "-" * 60,
            title,
            "-" * 60,
            f"  {'武将':<10} {'来源伤害':>8} {'承受伤害':>8} {'来源治疗':>8} {'受疗':>8} {'发动':>6} {'未发动':>6}",
            f"  {'-'*10} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*6} {'-'*6}",
        ]
        for hero, stats in sorted(hero_stats.items()):
            lines.append(
                f"  {self._label_hero(hero):<10} {stats.get('damage_dealt', 0):>8} "
                f"{stats.get('damage_taken', 0):>8} {stats.get('heal_done', 0):>8} "
                f"{stats.get('heal_received', 0):>8} {stats.get('skill_cast_count', 0):>6} "
                f"{stats.get('skill_fail_count', 0):>6}"
            )
        lines.append("")
        return lines
        
    def _render_buff_timeline(self, timeline: list) -> list:
        """Render buff lifecycle timeline for text format"""
        if not timeline:
            return []
            
        status_labels = {
            "applied": "施加",
            "stacked": "叠加",
            "full": "满层触发",
            "expired": "消失",
            "refreshed": "刷新"
        }
        
        lines = [
            "-" * 60,
            "  【Buff 追踪】",
            "-" * 60,
        ]
        
        current_hero = None
        for entry in timeline:
            hero = entry["hero"]
            buff = entry["buff"]
            status = entry["status"]
            stacks = entry["stacks"]
            if hero != current_hero:
                if current_hero:
                    lines.append("")
                lines.append(f"  [{self._label_hero(hero)}]")
                current_hero = hero
            label = status_labels.get(status, status)
            lines.append(f"    {buff}: {label} ({stacks}层)")
            
        lines.append("")
        return lines
        
    def _render_buff_timeline_md(self, timeline: list) -> list:
        """Render buff lifecycle timeline for markdown format"""
        if not timeline:
            return []
            
        status_labels = {
            "applied": "施加",
            "stacked": "叠加",
            "full": "满层触发",
            "expired": "消失",
            "refreshed": "刷新"
        }
        
        lines = [
            "## Buff 追踪",
            ""
        ]
        
        current_hero = None
        for entry in timeline:
            hero = entry["hero"]
            buff = entry["buff"]
            status = entry["status"]
            stacks = entry["stacks"]
            if hero != current_hero:
                lines.append(f"### {self._label_hero(hero)}")
                lines.append("")
                current_hero = hero
            label = status_labels.get(status, status)
            lines.append(f"- {buff}: {label} ({stacks}层)")
            
        lines.append("")
        return lines
    
    def _format_event(self, e: dict) -> Optional[str]:
        """Format a single deploy-phase event"""
        t = e.get("type", "info")
        raw_first = {
            "attr_up", "attr_down", "pct_change", "skill_cast", "bond_effect",
            "bond_effect2", "buff_apply", "team_buff", "country_buff",
            "troop_buff", "tech_buff", "formation", "supply", "equip",
            "horse", "evade", "treatise", "info"
        }
        if t in raw_first and e.get("raw"):
            return self._annotate_raw(e.get("raw", ""))
        formatters = {
            "supply": lambda: f"{e['team']}队补给{e['supply']}，伤害降低{e['penalty']}%",
            "formation": lambda: f"{e['team']}队布阵【{e['formation']}】",
            "country_buff": lambda: f"{e['team']}队获得【{e['country']}】加成，属性+{e['bonus']}%",
            "troop_buff": lambda: f"{e['team']}队获得兵种加成",
            "tech_buff": lambda: f"{e['team']}队获得建筑科技强化",
            "team_buff": lambda: f"{e['team']}队获得【{e['buff']}】强化",
            "buff_apply": lambda: f"{e['actor']} 施加「{e['buff']}」",
            "skill_cast": lambda: f"{e['actor']} 发动【{e['skill']}】",
            "treatise": lambda: f"{e['actor']} 获得韬略【{e['skill']}】",
            "bond_effect": lambda: f"{e['actor']} 执行【{e['skill']}】→「{e['effect']}」",
            "bond_effect2": lambda: f"{e['actor']} 执行「{e['effect']}」",
            "equip": lambda: f"{e['actor']} 装备【{e['equip']}】触发",
            "horse": lambda: f"{e['actor']} 马匹【{e['horse']}】触发",
            "evade": lambda: f"{e['actor']} 规避 {e['source']} 的伤害",
            "attr_up": lambda: f"{e['actor']} {e['attr']} +{e['change']} = {e['total']}",
            "attr_down": lambda: f"{e['actor']} {e['attr']} {e['change']} = {e['total']}",
            "pct_change": lambda: f"{e['actor']} {e['attr']} {e['change']}% = {e['total']}%",
            "order_done": lambda: "── 布阵完毕，战斗开始 ──",
            "info": lambda: e.get("raw", "")
        }
        return formatters.get(t, lambda: None)()
    
    def _format_combat_event(self, e: dict) -> Optional[str]:
        """Format a single combat-phase event"""
        t = e.get("type", "info")
        if t == "order_done":
            return None
        if t == "turn_start" and e.get("raw"):
            return f"▸ {self._annotate_raw(e.get('raw', ''))}"
        if e.get("raw"):
            return self._annotate_raw(e.get("raw", ""))
        formatters = {
            "skill_exec": lambda: f"{e['actor']} 执行【{e['skill']}】·「{e.get('effect','')}」",
            "dmg_skill": lambda: f"{e['target']} 受到 {e['actor']}【{e['skill']}】伤害 -{e['dmg']} (剩{e['remain']})",
            "damage": lambda: f"{e['actor']} 损失兵力 -{e['dmg']} (剩{e['remain']})",
            "heal": lambda: f"{e['actor']} 恢复兵力 +{e['heal']} (共{e['remain']})",
            "attack": lambda: f"{e['actor']} → {e['target']} 普通攻击",
            "buff": lambda: f"{e['actor']} 施加「{e['buff']}」",
            "buff_end": lambda: f"{e['actor']} 「{e['buff']}」消失",
            "buff_refresh": lambda: f"{e['actor']} 「{e['buff']}」刷新",
            "attr_up": lambda: f"{e['actor']} {e['attr']} +{e['change']} = {e['total']}",
            "attr_down": lambda: f"{e['actor']} {e['attr']} {e['change']} = {e['total']}",
            "pct_change": lambda: f"{e['actor']} {e['attr']} {e['change']}% = {e['total']}%",
            "state": lambda: f"{e['actor']} {e['stacks']}层{e['name']} (伤害+{e['bonus']}%)",
            "counter": lambda: f"{e['actor']} → {e['target']} 反击",
            "crit": lambda: "!! 会心 !! 伤害×150%",
            "turn_start": lambda: f"▸ {e['actor']} 行动",
            "skill_fail": lambda: f"{e['actor']} 发动【{e['skill']}】失败",
            "trigger_fail": lambda: f"{e['actor']} 触发【{e['skill']}】·「{e['effect']}」失败",
            "defeated": lambda: f"!! {e.get('actor','未知')} 溃灭 !!" if "actor" in e else "!! 溃灭 !!",
            "resist": lambda: f"{e['actor']} 消耗{e['count']}次抵御",
            "share_dmg": lambda: f"{e['actor']} 分摊伤害",
            "equip": lambda: f"{e['actor']} 装备【{e['equip']}】触发",
            "horse": lambda: f"{e['actor']} 马匹【{e['horse']}】触发",
            "evade": lambda: f"{e['actor']} 规避 {e['source']} 的伤害",
            "treatise": lambda: f"{e['actor']} 获得韬略【{e['skill']}】",
            "stack": lambda: e.get("raw", ""),
            "info": lambda: e.get("raw", "")
        }
        return formatters.get(t, lambda: None)()
