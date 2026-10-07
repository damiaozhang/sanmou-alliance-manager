# -*- coding: utf-8 -*-
"""
Parser module - Battle event parsing with pre-compiled regex, state machine,
buff lifecycle tracking, deploy summary, and structured output
"""
import re
from enum import Enum
from typing import Optional, Any
from collections import defaultdict

class BattlePhase(Enum):
    DEPLOY = "deploy"
    COMBAT = "combat"
    UNKNOWN = "unknown"

class BuffStatus(Enum):
    APPLIED = "applied"
    STACKED = "stacked"
    FULL = "full"
    EXPIRED = "expired"
    REFRESHED = "refreshed"

class BuffTracker:
    """Track buff lifecycle per hero"""
    
    def __init__(self):
        self.buffs = defaultdict(dict)
        self.history = []
        
    def apply(self, hero: str, buff_name: str):
        if buff_name not in self.buffs[hero]:
            self.buffs[hero][buff_name] = {"stacks": 1, "status": BuffStatus.APPLIED}
        else:
            entry = self.buffs[hero][buff_name]
            entry["stacks"] += 1
            entry["status"] = BuffStatus.STACKED
            if entry["stacks"] >= 8:
                entry["status"] = BuffStatus.FULL
        
        self.history.append((hero, buff_name, self.buffs[hero][buff_name]["status"].value,
                             self.buffs[hero][buff_name]["stacks"]))
        
    def remove(self, hero: str, buff_name: str):
        if hero in self.buffs and buff_name in self.buffs[hero]:
            entry = self.buffs[hero][buff_name]
            entry["status"] = BuffStatus.EXPIRED
            self.history.append((hero, buff_name, "expired", entry["stacks"]))
            del self.buffs[hero][buff_name]
            
    def refresh(self, hero: str, buff_name: str):
        if hero in self.buffs and buff_name in self.buffs[hero]:
            self.buffs[hero][buff_name]["status"] = BuffStatus.REFRESHED
            self.history.append((hero, buff_name, "refreshed", self.buffs[hero][buff_name]["stacks"]))
            
    def get_summary(self) -> list[dict]:
        result = []
        for hero, buffs in self.buffs.items():
            for name, info in buffs.items():
                result.append({
                    "hero": hero,
                    "buff": name,
                    "stacks": info["stacks"],
                    "status": info["status"].value
                })
        return result
        
    def get_timeline(self) -> list[tuple]:
        return self.history
        
    def to_dict(self) -> dict:
        return {
            "active": {hero: {name: info["stacks"] for name, info in buffs.items()}
                       for hero, buffs in self.buffs.items()},
            "timeline": [{"hero": h, "buff": b, "status": s, "stacks": n} 
                         for h, b, s, n in self.history]
        }

class DeploySummary:
    """Aggregated deploy-phase statistics"""
    
    def __init__(self):
        self.supply = {}
        self.formations = {}
        self.troop_buffs = []
        self.country_buffs = {}
        self.tech_buff = False
        self.team_buffs = {}
        self.initial_equip = []
        self.initial_horse = []
        
    def record_supply(self, team: str, supply: str, penalty: str):
        self.supply[team] = {"supply": int(supply), "penalty": int(penalty)}
        
    def record_formation(self, team: str, formation: str):
        self.formations[team] = formation
        
    def record_country_buff(self, team: str, country: str, bonus: str):
        self.country_buffs[team] = {"country": country, "bonus": int(bonus)}
        
    def record_troop_buff(self, team: str):
        if team and team not in self.troop_buffs:
            self.troop_buffs.append(team)
        
    def record_tech_buff(self, team: str):
        self.tech_buff = True
        
    def record_team_buff(self, team: str, buff: str):
        if team not in self.team_buffs:
            self.team_buffs[team] = []
        if buff and buff not in self.team_buffs[team]:
            self.team_buffs[team].append(buff)
        
    def record_equip(self, actor: str, equip: str):
        item = {"actor": actor, "equip": equip}
        if actor and equip and item not in self.initial_equip:
            self.initial_equip.append(item)
        
    def record_horse(self, actor: str, horse: str):
        item = {"actor": actor, "horse": horse}
        if actor and horse and item not in self.initial_horse:
            self.initial_horse.append(item)
        
    def to_dict(self) -> dict:
        return {
            "supply": self.supply,
            "formations": self.formations,
            "troop_buffs": self.troop_buffs,
            "country_buffs": self.country_buffs,
            "tech_buff": self.tech_buff,
            "team_buffs": self.team_buffs,
            "initial_equip": self.initial_equip,
            "initial_horse": self.initial_horse
        }

class Parser:
    """Battle report parser with state machine and pre-compiled regex"""
    CAST_DEDUPE_SEQ_WINDOW = 200
    
    COMBAT_KEYWORDS = [
        '发动战法', '发动普通攻击', '执行技能', '开始行动',
        '损失了兵力', '恢复了兵力', '消耗', '会心', '奇谋', '反击',
        '因几率未触发', '因几率未发动'
    ]
    
    COMBAT_PHASE_PATTERNS = [
        (re.compile(r'^\[(.+?)\]\u7531\u4e8e\[(.+?)\]\u3010(.+?)\u3011\u7684\u300c(.+?)\u300d\u6548\u679c[,\uff0c]\u635f\u5931\u4e86\u5175\u529b(\d+)\((\d+)\)'),
         {"type": "dmg_skill", "fields": {"target": 1, "actor": 2, "skill": 3, "effect": 4, "dmg": 5, "remain": 6}}),

        (re.compile(r'^\[(.+?)\]\u7531\u4e8e\[(.+?)\]\u7684\u3010(.+?)\u3011\u7684\u4f24\u5bb3[,\uff0c]\u635f\u5931\u4e86\u5175\u529b(\d+)\((\d+)\)'),
         {"type": "dmg_skill", "fields": {"target": 1, "actor": 2, "skill": 3, "dmg": 4, "remain": 5}}),

        (re.compile(r'^\[(.+?)\]\u7531\u4e8e\[(.+?)\]\u3010(.+?)\u3011\u7684\u300c(.+?)\u300d\u6548\u679c[,\uff0c]\u6062\u590d\u4e86\u5175\u529b(\d+)\((\d+)\)'),
         {"type": "heal_skill", "fields": {"target": 1, "actor": 2, "skill": 3, "effect": 4, "heal": 5, "remain": 6}}),

        (re.compile(r'^\[(.+?)\]\u7531\u4e8e\[(.+?)\]\u7684\u3010(.+?)\u3011\u7684\u6cbb\u7597[,\uff0c]\u6062\u590d\u4e86\u5175\u529b(\d+)\((\d+)\)'),
         {"type": "heal_skill", "fields": {"target": 1, "actor": 2, "skill": 3, "heal": 4, "remain": 5}}),

        (re.compile(r'\[(.+?)\]执行技能【(.+?)】的【(.+?)】效果'),
         {"type": "skill_exec", "fields": {"actor": 1, "skill": 2, "effect": 3}}),
        
        (re.compile(r'\[(.+?)\]受到\[(.+?)\]的【(.+?)】.+?损失了兵力.*?(\d+).*?\((\d+)\)'),
         {"type": "dmg_skill", "fields": {"target": 1, "actor": 2, "skill": 3, "dmg": 4, "remain": 5}}),
        
        (re.compile(r'\[(.+?)\]恢复了兵力.*?(\d+).*?\((\d+)\)'),
         {"type": "heal", "fields": {"actor": 1, "heal": 2, "remain": 3}}),
        
        (re.compile(r'\[(.+?)\]损失了兵力.*?(\d+).*?\((\d+)\)'),
         {"type": "damage", "fields": {"actor": 1, "dmg": 2, "remain": 3}}),
        
        (re.compile(r'\[(.+?)\]对\[(.+?)\]发动普通攻击'),
         {"type": "attack", "fields": {"actor": 1, "target": 2}}),
        
        (re.compile(r'\[(.+?)\]受到【(.+?)】效果施加'),
         {"type": "buff", "fields": {"actor": 1, "buff": 2}}),
        
        (re.compile(r'\[(.+?)\]的【(.+?)】效果已消失'),
         {"type": "buff_end", "fields": {"actor": 1, "buff": 2}}),
        
        (re.compile(r'\[(.+?)\]的【(.+?)】效果已刷新'),
         {"type": "buff_refresh", "fields": {"actor": 1, "buff": 2}}),
        
        (re.compile(r'\[(.+?)\]的【(.+?)】(?:增加|提升)([\d.]+)\(([\d.]+)\)'),
         {"type": "attr_up", "fields": {"actor": 1, "attr": 2, "change": 3, "total": 4}}),
        
        (re.compile(r'\[(.+?)\]的【(.+?)】降低([\d.]+)\(([\d.-]+)\)'),
         {"type": "attr_down", "fields": {"actor": 1, "attr": 2, "change": 3, "total": 4}}),
        
        (re.compile(r'\[(.+?)\]受到(\d+)层(.+?)，.*?伤害提升(\d+)%'),
         {"type": "state", "fields": {"actor": 1, "stacks": 2, "name": 3, "bonus": 4}}),
        
        (re.compile(r'\[(.+?)\]对\[(.+?)\]发动反击'),
         {"type": "counter", "fields": {"actor": 1, "target": 2}}),
        
        (re.compile(r'\[(.+?)\]队获得【阵型[——一]+(.+?)】强化效果'),
         {"type": "formation", "fields": {"team": 1, "formation": 2}}),
        
        (re.compile(r'\[(.+?)\]队获得【(.+?)】强化效果[，,]\s*属性提升(\d+)%'),
         {"type": "country_buff", "fields": {"team": 1, "country": 2, "bonus": 3}}),
        
        (re.compile(r'\[(.+?)\]队获得兵种强化效果'),
         {"type": "troop_buff", "fields": {"team": 1}}),
        
        (re.compile(r'\[(.+?)\]队当前补给值为(\d+)[，,]造成伤害降低(\d+)%'),
         {"type": "supply", "fields": {"team": 1, "supply": 2, "penalty": 3}}),
        
        (re.compile(r'\[(.+?)\]的「(.+?)」效果已施加'),
         {"type": "buff_apply", "fields": {"actor": 1, "buff": 2}}),
        
        (re.compile(r'\[(.+?)\]发动战法【(.+?)】'),
         {"type": "skill_cast", "fields": {"actor": 1, "skill": 2}}),
        
        (re.compile(r'\[(.+?)\]兵力为0'),
         {"type": "defeated", "fields": {"actor": 1}}),
        
        (re.compile(r'\[(.+?)\]执行来自【(.+?)】的「(.+?)」效果'),
         {"type": "bond_effect", "fields": {"actor": 1, "skill": 2, "effect": 3}}),
        
        (re.compile(r'\[(.+?)\]执行来自「(.+?)」效果'),
         {"type": "bond_effect2", "fields": {"actor": 1, "effect": 2}}),
        
        (re.compile(r'\[(.+?)\]执行【装备-(.+?)】效果'),
         {"type": "equip", "fields": {"actor": 1, "equip": 2}}),
        
        (re.compile(r'\[(.+?)\]执行【马匹-(.+?)】效果'),
         {"type": "horse", "fields": {"actor": 1, "horse": 2}}),
        
        (re.compile(r'\[(.+?)\]成功规避\[(.+?)\]的伤害'),
         {"type": "evade", "fields": {"actor": 1, "source": 2}}),
        
        (re.compile(r'\[(.+?)\]队获得建筑科技强化效果'),
         {"type": "tech_buff", "fields": {"team": 1}}),
        
        (re.compile(r'\[(.+?)\]队获得【(.+?)】强化效果'),
         {"type": "team_buff", "fields": {"team": 1, "buff": 2}}),
        
        (re.compile(r'\[(.+?)\]的【(.+?)】(?:提升|降低)([\d.]+)%\(([\d.-]+)%\)'),
         {"type": "pct_change", "fields": {"actor": 1, "attr": 2, "change": 3, "total": 4}}),
        
        (re.compile(r'\[(.+?)\]的【(.+?)】提升(\d+)\((\d+)\)'),
         {"type": "attr_up", "fields": {"actor": 1, "attr": 2, "change": 3, "total": 4}}),
        
        (re.compile(r'\[(.+?)\]因几率未发动战法【(.+?)】'),
         {"type": "skill_fail", "fields": {"actor": 1, "skill": 2}}),
        
        (re.compile(r'\[(.+?)\]因几率未触发【(.+?)】的「(.+?)」效果'),
         {"type": "trigger_fail", "fields": {"actor": 1, "skill": 2, "effect": 3}}),
        
        (re.compile(r'\[(.+?)\]消耗(\d+)次抵御'),
         {"type": "resist", "fields": {"actor": 1, "count": 2}}),
        
        (re.compile(r'\[(.+?)\]执行分摊'),
         {"type": "share_dmg", "fields": {"actor": 1}}),
        
        (re.compile(r'\[(.+?)\]开始行动'),
         {"type": "turn_start", "fields": {"actor": 1}}),
    ]
    
    TREATISE_PATTERN = re.compile(r'[《「](.+?)[》」](?:善本|手抄|残章|孤本|秘籍|精要|全本)')
    
    DEPLOY_ONLY_TYPES = {"supply", "formation", "country_buff", "troop_buff", "tech_buff",
                         "team_buff", "equip", "horse"}

    BARE_INFO_NOISE_PATTERNS = [
        re.compile(r'^对.+武将伤害提升$'),
        re.compile(r'^受到.+武将伤害降低$'),
        re.compile(r'^主动战法发动率$'),
        re.compile(r'^自带主动战法发动率$'),
        re.compile(r'^造成(?:兵刃|谋略)?伤害$'),
        re.compile(r'^受到(?:兵刃|谋略)?伤害$'),
        re.compile(r'^(?:武力|智力|统率|先攻|破甲|看破|会心伤害|奇谋伤害|攻心)$'),
    ]

    INFO_DROP_PATTERNS = [
        re.compile(r'^\d+$'),
        re.compile(r'^\d+/\d+$'),
        re.compile(r'^\d+万/\d+万$'),
        re.compile(r'^\(\d+/\d+\)\s*提升'),
        re.compile(r'^.+[:：].*'),
        re.compile(r'分享战报'),
        re.compile(r'补给充足'),
        re.compile(r'适合放在阵型前排'),
    ]

    INFO_KEEP_KEYWORDS = (
        "触发", "执行", "效果", "伤害", "兵力", "治疗", "恢复",
        "叠加", "满层", "施加", "消失", "刷新", "会心", "奇谋",
        "抵御", "规避", "分摊", "无法再战", "胜利", "准备发动",
    )
    
    def __init__(self, heroes_whitelist: Optional[set] = None):
        self.events = []
        self.heroes = set()
        self.skills = set()
        self.treatises = set()
        self.buffs = set()
        self.formations = set()
        self.phase = BattlePhase.DEPLOY
        self.heroes_whitelist = heroes_whitelist
        
        self.buff_tracker = BuffTracker()
        self.deploy_summary = DeploySummary()
        self.hero_stats = defaultdict(lambda: {
            "damage_dealt": 0,
            "damage_taken": 0,
            "heal_done": 0,
            "skills_used": [],
            "treatises_used": [],
            "buffs_applied": [],
        })
        
        self._current_deploy_team = ""
        self._combat_started = False
        self._deploy_skill_started = False
        self._team_order = []
        self._team_heroes = defaultdict(list)
        self._team_hero_skills = defaultdict(lambda: defaultdict(list))
        self._team_hero_treatises = defaultdict(lambda: defaultdict(list))
        self._team_hero_equip = defaultdict(dict)
        self._team_hero_horse = defaultdict(dict)
        self._hero_team = {}
        self._hero_teams = defaultdict(list)
        self._hero_equip = {}
        self._hero_horse = {}
        self._hero_initial_troops = {}
        self.unmatched_events = []
        
    def reset(self):
        self.events.clear()
        self.heroes.clear()
        self.skills.clear()
        self.treatises.clear()
        self.buffs.clear()
        self.formations.clear()
        self.phase = BattlePhase.DEPLOY
        self.buff_tracker = BuffTracker()
        self.deploy_summary = DeploySummary()
        self.hero_stats.clear()
        self._current_deploy_team = ""
        self._combat_started = False
        self._deploy_skill_started = False
        self._team_order.clear()
        self._team_heroes.clear()
        self._team_hero_skills.clear()
        self._team_hero_treatises.clear()
        self._team_hero_equip.clear()
        self._team_hero_horse.clear()
        self._hero_team.clear()
        self._hero_teams.clear()
        self._hero_equip.clear()
        self._hero_horse.clear()
        self._hero_initial_troops.clear()
        self.unmatched_events.clear()
        
    def _is_combat_phase(self, text: str) -> bool:
        return any(kw in text for kw in self.COMBAT_KEYWORDS)

    def _is_treatise(self, skill_name: str) -> bool:
        return bool(self.TREATISE_PATTERN.search(skill_name))

    @staticmethod
    def _append_unique(items: list, value: str):
        if value and value not in items:
            items.append(value)

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _event_seq(event: dict, index: int) -> int:
        value = event.get("seq")
        if isinstance(value, int):
            return value
        try:
            return int(value)
        except (TypeError, ValueError):
            return index

    def _new_hero_stats(self) -> dict:
        return {
            "damage_dealt": 0,
            "damage_taken": 0,
            "heal_done": 0,
            "heal_received": 0,
            "skill_cast_count": 0,
            "skill_cast_counts": {},
            "skill_fail_count": 0,
            "skill_fail_counts": {},
            "treatise_cast_count": 0,
            "treatise_cast_counts": {},
            "damage_events": 0,
            "damage_taken_events": 0,
            "heal_events": 0,
            "heal_received_events": 0,
            "receiver_only_damage": 0,
            "receiver_only_heal": 0,
            "dedupe_dropped": 0,
            "skills_used": [],
            "treatises_used": [],
            "buffs_applied": [],
        }

    def _increment_nested_count(self, stats: dict, bucket: str, key: str):
        if key:
            stats[bucket][key] = stats[bucket].get(key, 0) + 1

    def _mark_dedupe_drop(self, stats: dict, *heroes: str):
        for hero in heroes:
            if hero:
                stats[hero]["dedupe_dropped"] += 1

    def _compute_hero_stats_from_events(self) -> dict:
        stats = defaultdict(self._new_hero_stats)
        seen_damage = set()
        seen_heal = set()
        last_cast_seq = {}
        last_fail_seq = {}

        for index, event in enumerate(self.events):
            evt_type = event.get("type", "")
            actor = event.get("actor", "")
            target = event.get("target", "")
            skill = event.get("skill", "")
            raw = event.get("raw", "")
            seq = self._event_seq(event, index)

            if evt_type in ("skill_cast", "treatise"):
                if not actor or not skill:
                    continue
                key = (evt_type, actor, skill, raw)
                previous_seq = last_cast_seq.get(key)
                if previous_seq is not None and seq - previous_seq <= self.CAST_DEDUPE_SEQ_WINDOW:
                    self._mark_dedupe_drop(stats, actor)
                    continue
                last_cast_seq[key] = seq
                if evt_type == "treatise" or self._is_treatise(skill):
                    stats[actor]["treatise_cast_count"] += 1
                    self._increment_nested_count(stats[actor], "treatise_cast_counts", skill)
                    self._append_unique(stats[actor]["treatises_used"], skill)
                else:
                    stats[actor]["skill_cast_count"] += 1
                    self._increment_nested_count(stats[actor], "skill_cast_counts", skill)
                    self._append_unique(stats[actor]["skills_used"], skill)
                continue

            if evt_type == "skill_fail":
                if not actor or not skill:
                    continue
                key = (actor, skill, raw)
                previous_seq = last_fail_seq.get(key)
                if previous_seq is not None and seq - previous_seq <= self.CAST_DEDUPE_SEQ_WINDOW:
                    self._mark_dedupe_drop(stats, actor)
                    continue
                last_fail_seq[key] = seq
                stats[actor]["skill_fail_count"] += 1
                self._increment_nested_count(stats[actor], "skill_fail_counts", skill)
                continue

            if evt_type in ("dmg_skill", "damage"):
                damage = self._safe_int(event.get("dmg"))
                if damage <= 0:
                    continue
                if actor and target:
                    key = ("source_damage", actor, target, skill, event.get("effect", ""), damage, event.get("remain"))
                    if key in seen_damage:
                        self._mark_dedupe_drop(stats, actor, target)
                        continue
                    seen_damage.add(key)
                    stats[actor]["damage_dealt"] += damage
                    stats[actor]["damage_events"] += 1
                    stats[target]["damage_taken"] += damage
                    stats[target]["damage_taken_events"] += 1
                elif actor:
                    key = ("receiver_damage", actor, damage, event.get("remain"), raw)
                    if key in seen_damage:
                        self._mark_dedupe_drop(stats, actor)
                        continue
                    seen_damage.add(key)
                    stats[actor]["damage_taken"] += damage
                    stats[actor]["damage_taken_events"] += 1
                    stats[actor]["receiver_only_damage"] += damage
                continue

            if evt_type == "heal":
                heal = self._safe_int(event.get("heal"))
                if heal <= 0 or not actor:
                    continue
                key = ("receiver_heal", actor, heal, event.get("remain"), raw)
                if key in seen_heal:
                    self._mark_dedupe_drop(stats, actor)
                    continue
                seen_heal.add(key)
                stats[actor]["heal_received"] += heal
                stats[actor]["heal_received_events"] += 1
                stats[actor]["receiver_only_heal"] += heal
                continue

            if evt_type == "heal_skill":
                heal = self._safe_int(event.get("heal"))
                if heal <= 0:
                    continue
                if actor and target:
                    key = ("source_heal", actor, target, skill, event.get("effect", ""), heal, event.get("remain"))
                    if key in seen_heal:
                        self._mark_dedupe_drop(stats, actor, target)
                        continue
                    seen_heal.add(key)
                    stats[actor]["heal_done"] += heal
                    stats[actor]["heal_events"] += 1
                    stats[target]["heal_received"] += heal
                    stats[target]["heal_received_events"] += 1
                elif actor:
                    key = ("receiver_heal", actor, heal, event.get("remain"), raw)
                    if key in seen_heal:
                        self._mark_dedupe_drop(stats, actor)
                        continue
                    seen_heal.add(key)
                    stats[actor]["heal_received"] += heal
                    stats[actor]["heal_received_events"] += 1
                    stats[actor]["receiver_only_heal"] += heal
                continue

            if evt_type in ("buff_apply", "buff"):
                buff = event.get("buff", "")
                if actor and buff:
                    self._append_unique(stats[actor]["buffs_applied"], buff)

        return {
            hero: {
                **stat,
                "skills_used": list(stat["skills_used"]),
                "treatises_used": list(stat["treatises_used"]),
                "buffs_applied": list(stat["buffs_applied"]),
                "skill_cast_counts": dict(stat["skill_cast_counts"]),
                "skill_fail_counts": dict(stat["skill_fail_counts"]),
                "treatise_cast_counts": dict(stat["treatise_cast_counts"]),
            }
            for hero, stat in stats.items()
        }

    def _remember_team(self, team: str):
        if team and team not in self._team_order:
            self._team_order.append(team)

    def _remember_team_hero(self, team: str, hero: str):
        if not team or not hero:
            return
        self._remember_team(team)
        self._append_unique(self._team_heroes[team], hero)
        self._append_unique(self._hero_teams[hero], team)
        self._hero_team.setdefault(hero, team)
        
    def _extract_named_entities(self, event_type: str, fields: dict) -> set:
        entities = set()
        if event_type in ("skill_exec", "skill_cast", "skill_fail"):
            if "actor" in fields:
                entities.add(("hero", fields["actor"]))
            if "skill" in fields:
                entities.add(("skill", fields["skill"]))
        elif event_type in ("dmg_skill", "damage", "heal", "attack", "counter", "turn_start"):
            if "actor" in fields:
                entities.add(("hero", fields["actor"]))
        return entities
        
    def _validate_entity(self, entity_type: str, name: str) -> bool:
        if entity_type != "hero" or not self.heroes_whitelist:
            return True
        return name in self.heroes_whitelist

    def _is_bare_info_noise(self, text: str) -> bool:
        if not text or re.search(r'\d', text):
            return False
        if any(mark in text for mark in ("[", "]", "【", "】", "「", "」", "《", "》")):
            return False
        return any(pattern.search(text) for pattern in self.BARE_INFO_NOISE_PATTERNS)

    def _should_keep_info(self, text: str) -> bool:
        if not text:
            return False
        if any(pattern.search(text) for pattern in self.INFO_DROP_PATTERNS):
            return False
        if self._is_bare_info_noise(text):
            return False
        return any(keyword in text for keyword in self.INFO_KEEP_KEYWORDS)
        
    def _track_buff(self, evt_type: str, fields: dict):
        """Update buff state machine"""
        actor = fields.get("actor", "")
        buff_name = fields.get("buff", "")
        if not actor or not buff_name:
            return
            
        if evt_type in ("buff_apply", "buff"):
            self.buff_tracker.apply(actor, buff_name)
        elif evt_type == "buff_end":
            self.buff_tracker.remove(actor, buff_name)
        elif evt_type == "buff_refresh":
            self.buff_tracker.refresh(actor, buff_name)
        elif evt_type == "state":
            name = fields.get("name", "")
            if name:
                self.buff_tracker.apply(actor, name)
                
    def _track_stats(self, evt_type: str, fields: dict):
        """Aggregate hero statistics"""
        actor = fields.get("actor", "")
        target = fields.get("target", "")
        
        if evt_type in ("dmg_skill", "damage"):
            dmg = int(fields.get("dmg", 0))
            if target:
                self.hero_stats[target]["damage_taken"] += dmg
            if actor:
                self.hero_stats[actor]["damage_dealt"] += dmg
        elif evt_type == "heal":
            heal = int(fields.get("heal", 0))
            if actor:
                self.hero_stats[actor]["heal_done"] += heal
        elif evt_type in ("skill_exec", "skill_cast", "treatise"):
            skill = fields.get("skill", "")
            if actor and skill:
                if self._is_treatise(skill):
                    self._append_unique(self.hero_stats[actor]["treatises_used"], skill)
                else:
                    self._append_unique(self.hero_stats[actor]["skills_used"], skill)
        elif evt_type in ("bond_effect", "skill_fail"):
            skill = fields.get("skill", "")
            if actor and skill:
                if self._is_treatise(skill):
                    self._append_unique(self.hero_stats[actor]["treatises_used"], skill)
                else:
                    self._append_unique(self.hero_stats[actor]["skills_used"], skill)
        elif evt_type in ("buff_apply", "buff"):
            buff = fields.get("buff", "")
            if actor and buff:
                self._append_unique(self.hero_stats[actor]["buffs_applied"], buff)
                
    def _update_deploy_summary(self, evt_type: str, fields: dict):
        """Update deploy summary from parsed fields and track team-hero mapping"""
        team = fields.get("team", "")
        actor = fields.get("actor", "")
        
        if team and evt_type in ("formation", "supply", "country_buff", "troop_buff", "tech_buff", "team_buff"):
            self._remember_team(team)
            self._current_deploy_team = team
            
        deploy_member_buff = evt_type == "buff_apply" and "兵种加成" in fields.get("buff", "")
        if actor and evt_type in ("equip", "horse"):
            teams = list(self._hero_teams.get(actor, []))
            if not teams and self._current_deploy_team:
                teams = [self._current_deploy_team]
            for actor_team in teams:
                self._remember_team_hero(actor_team, actor)
        elif actor and self._current_deploy_team and (
            (not self._deploy_skill_started and evt_type in ("attr_up", "attr_down", "pct_change"))
            or (not self._deploy_skill_started and deploy_member_buff)
        ):
            self._remember_team_hero(self._current_deploy_team, actor)

        if actor and evt_type in ("skill_cast", "skill_exec", "skill_fail", "treatise", "bond_effect"):
            self._deploy_skill_started = True
            skill = fields.get("skill", "")
            if skill:
                teams = list(self._hero_teams.get(actor, []))
                if not teams and self._current_deploy_team:
                    teams = [self._current_deploy_team]
                for skill_team in teams:
                    if self._is_treatise(skill):
                        self._append_unique(self._team_hero_treatises[skill_team][actor], skill)
                    else:
                        self._append_unique(self._team_hero_skills[skill_team][actor], skill)
        
        if evt_type == "supply":
            self.deploy_summary.record_supply(team, fields.get("supply", "0"), fields.get("penalty", "0"))
        elif evt_type == "formation":
            self.deploy_summary.record_formation(team, fields.get("formation", ""))
        elif evt_type == "country_buff":
            self.deploy_summary.record_country_buff(team, fields.get("country", ""), fields.get("bonus", "0"))
        elif evt_type == "troop_buff":
            self.deploy_summary.record_troop_buff(team)
        elif evt_type == "tech_buff":
            self.deploy_summary.record_tech_buff(team)
        elif evt_type == "team_buff":
            self.deploy_summary.record_team_buff(team, fields.get("buff", ""))
        elif evt_type == "equip":
            self.deploy_summary.record_equip(actor, fields.get("equip", ""))
            self._hero_equip[actor] = fields.get("equip", "")
            teams = list(self._hero_teams.get(actor, []))
            if not teams and self._current_deploy_team:
                teams = [self._current_deploy_team]
            for actor_team in teams:
                self._team_hero_equip[actor_team][actor] = fields.get("equip", "")
        elif evt_type == "horse":
            self.deploy_summary.record_horse(actor, fields.get("horse", ""))
            self._hero_horse[actor] = fields.get("horse", "")
            teams = list(self._hero_teams.get(actor, []))
            if not teams and self._current_deploy_team:
                teams = [self._current_deploy_team]
            for actor_team in teams:
                self._team_hero_horse[actor_team][actor] = fields.get("horse", "")
        
    def feed(self, text: str) -> Optional[tuple]:
        """Feed text into parser, return (event, is_battle_end) tuple if matched"""
        text = str(text).strip()
        if len(text) < 4 or 'fps_data' in text:
            return None
            
        if self.events and self.events[-1].get("raw", "") == text:
            return None
            
        evt = {"raw": text, "phase": self.phase.value}
        is_battle_end = False
        
        if self.phase == BattlePhase.DEPLOY:
            if '行动顺序判断完毕' in text:
                self.phase = BattlePhase.COMBAT
        
        for pattern, config in self.COMBAT_PHASE_PATTERNS:
            m = pattern.search(text)
            if m:
                evt["type"] = config["type"]
                fields = {}
                for field_name, group_idx in config["fields"].items():
                    val = m.group(group_idx)
                    fields[field_name] = val
                    
                    if field_name in ("actor", "target"):
                        self.heroes.add(val)
                    if field_name == "skill":
                        if self._is_treatise(val):
                            self.treatises.add(val)
                        else:
                            self.skills.add(val)
                    if field_name == "buff":
                        self.buffs.add(val)
                    if field_name == "formation":
                        self.formations.add(val)
                        
                evt.update(fields)
                
                if "actor" in fields and self._validate_entity("hero", fields["actor"]):
                    self.heroes.add(fields["actor"])
                    
                if config["type"] in ("skill_cast", "skill_exec", "skill_fail") and "skill" in fields:
                    if self._is_treatise(fields["skill"]):
                        evt["type"] = "treatise"

                evt_type = evt["type"]
                if evt_type == "turn_start":
                    self._combat_started = True
                    self.phase = BattlePhase.COMBAT
                    
                self._track_buff(config["type"], fields)
                self._track_stats(evt_type, fields)
                
                if config["type"] in self.DEPLOY_ONLY_TYPES:
                    evt["phase"] = "deploy"
                    self._update_deploy_summary(config["type"], fields)
                elif evt_type != "turn_start" and (self.phase == BattlePhase.DEPLOY or not self._combat_started):
                    evt["phase"] = "deploy"
                    self._update_deploy_summary(evt_type, fields)
                    
                break
                
        if "type" not in evt:
            if '触发会心' in text:
                evt["type"] = "crit"
            elif '行动顺序判断完毕' in text:
                evt["type"] = "order_done"
            elif '全部兵力为0' in text or '战斗结束' in text:
                evt["type"] = "victory"
                is_battle_end = True
            elif '无法再战' in text:
                evt["type"] = "victory"
                is_battle_end = True
            elif '兵力为0' in text and '无法再战' in text:
                evt["type"] = "defeated"
            elif '消耗' in text and '抵御' in text:
                evt["type"] = "resist"
            elif '执行分摊效果' in text:
                evt["type"] = "share_dmg"
            elif '已叠加' in text or '已满层' in text:
                evt["type"] = "stack"
            else:
                if not self._should_keep_info(text):
                    return None
                evt["type"] = "info"
                self.unmatched_events.append({
                    "raw": text,
                    "phase": evt.get("phase", ""),
                    "index": len(self.events),
                })

        if evt.get("type") != "turn_start" and not self._combat_started and not is_battle_end:
            evt["phase"] = "deploy"
            if self.unmatched_events and self.unmatched_events[-1].get("index") == len(self.events):
                self.unmatched_events[-1]["phase"] = "deploy"
                
        self.events.append(evt)
        return (evt, is_battle_end)
        
    def get_structured_data(self) -> list[dict]:
        result = []
        for e in self.events:
            evt = {
                "type": e.get("type", "?"),
                "phase": e.get("phase", ""),
            }
            for k, v in e.items():
                if k not in ("raw", "type", "phase"):
                    evt[k] = v
            evt["raw"] = e.get("raw", "")
            result.append(evt)
        return result
        
    def get_summary(self) -> dict:
        phase_counts = defaultdict(int)
        type_counts = defaultdict(int)
        victory = False
        
        for e in self.events:
            phase_counts[e.get("phase", "?")] += 1
            type_counts[e.get("type", "?")] += 1
            if e.get("type") == "victory":
                raw = e.get("raw", "")
                if "守方" in raw and "无法再战" in raw:
                    victory = True
                elif "攻方" in raw and "无法再战" in raw:
                    victory = False
                else:
                    victory = True
                    
        return {
            "total_events": len(self.events),
            "phase_counts": dict(phase_counts),
            "type_counts": dict(type_counts),
            "heroes": sorted(self.heroes),
            "skills": sorted(self.skills),
            "treatises": sorted(self.treatises),
            "buffs": sorted(self.buffs),
            "formations": sorted(self.formations),
            "victory": victory,
        }
        
    def get_buff_summary(self) -> dict:
        return self.buff_tracker.to_dict()
        
    def get_deploy_summary(self) -> dict:
        return self.deploy_summary.to_dict()
        
    def get_hero_stats(self) -> dict:
        if self.events:
            return self._compute_hero_stats_from_events()

        result = {}
        for hero, stats in self.hero_stats.items():
            result[hero] = {
                "damage_dealt": stats["damage_dealt"],
                "damage_taken": stats["damage_taken"],
                "heal_done": stats["heal_done"],
                "heal_received": 0,
                "skill_cast_count": 0,
                "skill_cast_counts": {},
                "skill_fail_count": 0,
                "skill_fail_counts": {},
                "treatise_cast_count": 0,
                "treatise_cast_counts": {},
                "damage_events": 0,
                "damage_taken_events": 0,
                "heal_events": 0,
                "heal_received_events": 0,
                "receiver_only_damage": 0,
                "receiver_only_heal": 0,
                "dedupe_dropped": 0,
                "skills_used": list(stats["skills_used"]),
                "treatises_used": list(stats["treatises_used"]),
                "buffs_applied": list(stats["buffs_applied"]),
            }
        return result

    def _team_label(self, team: str) -> str:
        if not team:
            return "未知"
        if team in ("1队", "攻方"):
            return "攻方"
        if team in ("2队", "守方"):
            return "守方"
        if team in self._team_order:
            idx = self._team_order.index(team)
            if idx == 0:
                return "攻方"
            if idx == 1:
                return "守方"
        for e in self.events:
            raw = e.get("raw", "")
            if "守方" in raw and "无法再战" in raw:
                return "守方" if team == "2队" else "攻方"
        return "攻方" if team == "1队" else "守方"

    def get_lineup(self) -> dict:
        """Build structured lineup: attacker and defender teams with hero details"""
        deploy = self.deploy_summary.to_dict()
        hero_stats = self.get_hero_stats()

        def build_team(team_key: str) -> dict:
            heroes = list(self._team_heroes.get(team_key, []))
            for hero, mapped_team in self._hero_team.items():
                if mapped_team == team_key:
                    self._append_unique(heroes, hero)
            team_heroes = []
            for hero in heroes:
                team_skills = self._team_hero_skills.get(team_key, {}).get(hero, [])
                team_treatises = self._team_hero_treatises.get(team_key, {}).get(hero, [])
                hero_team_count = len(self._hero_teams.get(hero, []))
                stat_skills = hero_stats.get(hero, {}).get("skills_used", [])
                stat_treatises = hero_stats.get(hero, {}).get("treatises_used", [])
                skills = list(team_skills)
                treatises = list(team_treatises)
                if hero_team_count <= 1:
                    for skill in stat_skills:
                        self._append_unique(skills, skill)
                    for treatise in stat_treatises:
                        self._append_unique(treatises, treatise)
                info = {
                    "name": hero,
                    "skills": skills,
                    "treatises": treatises,
                    "equip": self._team_hero_equip.get(team_key, {}).get(hero, self._hero_equip.get(hero, "")),
                    "horse": self._team_hero_horse.get(team_key, {}).get(hero, self._hero_horse.get(hero, "")),
                }
                info = {k: v for k, v in info.items() if v}
                team_heroes.append(info)

            return {
                "label": self._team_label(team_key),
                "formation": deploy.get("formations", {}).get(team_key, ""),
                "country": deploy.get("country_buffs", {}).get(team_key, {}),
                "supply": deploy.get("supply", {}).get(team_key, {}),
                "country_buff": deploy.get("country_buffs", {}).get(team_key, {}),
                "has_tech": deploy.get("tech_buff", False),
                "has_troop_buff": team_key in deploy.get("troop_buffs", []),
                "team_buffs": deploy.get("team_buffs", {}).get(team_key, []),
                "heroes": team_heroes,
            }

        lineup = {}
        teams = list(self._team_order)
        for team in deploy.get("formations", {}).keys():
            self._append_unique(teams, team)
        for team in deploy.get("supply", {}).keys():
            self._append_unique(teams, team)
        for team in self._team_heroes.keys():
            self._append_unique(teams, team)
        for team in self._hero_team.values():
            self._append_unique(teams, team)

        for team in teams:
            lineup[team] = build_team(team)
        return lineup
