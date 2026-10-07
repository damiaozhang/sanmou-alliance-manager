# -*- coding: utf-8 -*-
"""将 frida 运行时 dump 的数据模块归一化为 authoritativeTerms.json 词表。

用法:
  1. 游戏(com.bilibili.nslg.exe)运行并登录后, 执行 dump:
       python collector/frida_nslg_runtime_scan.py --process <游戏PID> \
           --out <raw目录> --no-scan --no-loadbuffer-hooks \
           --probe-data-modules --exit-after-lua-probes --seconds 120
     注意必须 attach 游戏本体 com.bilibili.nslg.exe, 不是启动器 NSLG.exe
     (启动器进程没有 xlua.dll, 会报 missing-symbol lua_pcall)。
  2. 归一化(可传多个 raw 目录, 每个分类取首个命中的 dump):
       python scripts/normalize_authoritative_terms.py <raw目录> [<raw目录2> ...]

策略: heroes/skills/warbooks/formations 用运行时数据全量替换;
      equipment/horses/*Effects/*Skills 若 dump 未覆盖则保留旧值。
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD_PATH = ROOT / "src" / "battle-grabber" / "data" / "authoritativeTerms.json"
ASSET_PATH = ROOT / "src-tauri" / "assets" / "authoritative_terms.json"

DUMP_SOURCE = (
    "live_runtime_dump com.bilibili.nslg.exe via "
    "collector/frida_nslg_runtime_scan.py --probe-data-modules"
)

# dump 子表 -> 词表分类
CATEGORIES = {
    "heroes": ("Data.heros", "heros_heros"),
    "skills": ("Data.skill.skills", "skills_skills"),
    "warbooks": ("Data.warbook", "warbook_warbook"),
    "formations": ("Data.formation", "formation_formation"),
}

# 装备/坐骑模块(Data.Scenario{N}.equipment + .item)的词表分类。
# 装备与坐骑本体不含名称, 名称取自 item_item; 特效/技能表用 type 字段区分
# 装备(type 1-3)与坐骑(type 4), 与旧词表 equipmentSkills+horseSkills=107、
# equipmentEffects+horseEffects=74 的分布一致。
#
# N 随赛季变化(S16 -> S17 ...), 故运行时从 dump 文件名自动探测最大的 Scenario 编号;
# 探测失败时回退到下面的常量。
DEFAULT_SCENARIO = 17
EQUIPMENT_MODULE_TEMPLATE = "Data.Scenario{N}.equipment"
ITEM_MODULE_TEMPLATE = "Data.Scenario{N}.item"

EQUIPMENT_MODULE = EQUIPMENT_MODULE_TEMPLATE.format(N=DEFAULT_SCENARIO)
ITEM_MODULE = ITEM_MODULE_TEMPLATE.format(N=DEFAULT_SCENARIO)

_SCENARIO_RE = re.compile(r"Data\.Scenario(\d+)\.equipment_status0_leave_stack2_\.bin$")


def detect_scenario(raw_dirs: list[Path]) -> int:
    """从 dump 文件名里找最大的 Scenario 编号; 找不到时返回 DEFAULT_SCENARIO。"""
    found: set[int] = set()
    for raw_dir in raw_dirs:
        for path in raw_dir.glob("*_status0_leave_stack2_.bin"):
            match = _SCENARIO_RE.search(path.name)
            if match:
                found.add(int(match.group(1)))
    if not found:
        print(f"scenario: not detected in dumps, fallback to Scenario{DEFAULT_SCENARIO}")
        return DEFAULT_SCENARIO
    newest = max(found)
    print(f"scenario: detected Scenario{newest} (candidates={sorted(found)})")
    return newest


def load_dump(raw_dirs: list[Path], prefix: str) -> dict | None:
    for raw_dir in raw_dirs:
        for path in sorted(raw_dir.glob(f"*_{prefix}_status0_leave_stack2_.bin")):
            return json.loads(path.read_text(encoding="utf-8"))
    return None


def to_terms(table: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, item in table.items():
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        rid = item.get("ID")
        if not isinstance(rid, int) or rid <= 0:
            try:
                rid = int(key)
            except (TypeError, ValueError):
                continue
        out[str(rid)] = name.strip()
    # 按 id 数值排序输出, 避免 Lua JSON 的键顺序造成无意义 diff
    return dict(sorted(out.items(), key=lambda kv: int(kv[0])))


def _report(category: str, previous: dict, terms: dict) -> None:
    added = sorted(set(terms) - set(previous), key=int)
    removed = sorted(set(previous) - set(terms), key=int)
    renamed = sorted([k for k in set(previous) & set(terms) if previous[k] != terms[k]], key=int)
    print(f"{category}: old={len(previous)} new={len(terms)} "
          f"added={len(added)} removed={len(removed)} renamed={len(renamed)}")
    if removed:
        print(f"  removed: {[(k, previous[k]) for k in removed[:10]]}")
    if renamed:
        print(f"  renamed: {[(k, previous[k], terms[k]) for k in renamed[:10]]}")


def equipment_categories(equipment: dict, item: dict) -> dict[str, dict[str, str]]:
    item_names = {
        str(v["id"]): str(v["name"]).strip()
        for v in item.get("item_item", {}).values()
        if isinstance(v, dict) and isinstance(v.get("id"), int)
        and isinstance(v.get("name"), str) and v["name"].strip()
    }

    def body_terms(table: dict) -> dict[str, str]:
        return {
            str(v["id"]): item_names[str(v["id"])]
            for v in table.values()
            if isinstance(v, dict) and isinstance(v.get("id"), int)
            and str(v["id"]) in item_names
        }

    def typed_terms(rows: object, horse: bool) -> dict[str, str]:
        out: dict[str, str] = {}
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            is_horse = row.get("type") == 4
            if is_horse != horse:
                continue
            name = row.get("name")
            rid = row.get("id")
            if isinstance(rid, int) and rid > 0 and isinstance(name, str) and name.strip():
                out[str(rid)] = name.strip()
        return out

    def skill_terms(table: dict, horse: bool) -> dict[str, str]:
        out: dict[str, str] = {}
        for row in table.values():
            if not isinstance(row, dict):
                continue
            is_horse = row.get("type") == 4
            if is_horse != horse:
                continue
            name = row.get("name")
            rid = row.get("id")
            if isinstance(rid, int) and rid > 0 and isinstance(name, str) and name.strip():
                out[str(rid)] = name.strip()
        return out

    return {
        category: dict(sorted(terms.items(), key=lambda kv: int(kv[0])))
        for category, terms in {
            "equipment": body_terms(equipment.get("equipment_equip", {})),
            "horses": body_terms(equipment.get("equipment_horse", {})),
            "equipmentEffects": typed_terms(equipment.get("equipment_effect"), horse=False),
            "horseEffects": typed_terms(equipment.get("equipment_effect"), horse=True),
            "equipmentSkills": skill_terms(equipment.get("equipment_skill", {}), horse=False),
            "horseSkills": skill_terms(equipment.get("equipment_skill", {}), horse=True),
        }.items()
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    raw_dirs = [Path(arg) for arg in sys.argv[1:]]
    old = json.loads(OLD_PATH.read_text(encoding="utf-8"))

    new = dict(old)
    new["generatedAt"] = date.today().isoformat()
    sources = dict(old.get("sources", {}))
    updated: list[str] = []

    for category, (prefix, table_key) in CATEGORIES.items():
        dump = load_dump(raw_dirs, prefix)
        if dump is None:
            print(f"{category}: skipped (no dump for {prefix})")
            continue
        terms = to_terms(dump[table_key])
        _report(category, old.get(category, {}), terms)
        new[category] = terms
        sources[category] = f"{DUMP_SOURCE} [{prefix}] ({new['generatedAt']})"
        updated.append(category)

    scenario = detect_scenario(raw_dirs)
    equipment_module = EQUIPMENT_MODULE_TEMPLATE.format(N=scenario)
    item_module = ITEM_MODULE_TEMPLATE.format(N=scenario)
    equipment = load_dump(raw_dirs, equipment_module)
    item = load_dump(raw_dirs, item_module)
    if equipment is not None and item is not None:
        for category, terms in equipment_categories(equipment, item).items():
            _report(category, old.get(category, {}), terms)
            new[category] = terms
            sources[category] = f"{DUMP_SOURCE} [{equipment_module}+{item_module}] ({new['generatedAt']})"
            updated.append(category)
    else:
        print("equipment/horses/*: skipped (no dump for "
              f"{equipment_module} / {item_module})")

    # 2026-09-20 修复（审查 P2-9）：此前即便一个 dump 都没命中，也会把几乎
    # 未变的词表写回去并 exit 0 —— 赛季号/文件命名一变就变成"成功但没更新"，
    # 完全没有信号。现在没有命中任何分类时直接非零退出，且不覆盖已有文件。
    required = {"heroes", "skills", "warbooks", "formations"}
    if not updated:
        print("ERROR: 没有任何 dump 命中，未更新词表（检查 raw 目录与赛季号/文件名）",
              file=sys.stderr)
        return 1
    missing = sorted(required - set(updated))
    if missing:
        print(f"ERROR: 关键分类缺少 dump，未更新词表: {', '.join(missing)}", file=sys.stderr)
        return 1

    new["sources"] = sources

    text = json.dumps(new, ensure_ascii=False, indent=2) + "\n"
    OLD_PATH.write_text(text, encoding="utf-8")
    ASSET_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {OLD_PATH}")
    print(f"wrote {ASSET_PATH}")

    # 双副本一致性断言：两个文件都各有消费者（前端静态 import / 分析脚本兜底），
    # 手工改动其中一个就会静默漂移，这里写后立即回读校验。
    if OLD_PATH.read_text(encoding="utf-8") != ASSET_PATH.read_text(encoding="utf-8"):
        print(f"ERROR: 两份词表内容不一致，请检查 {OLD_PATH} 与 {ASSET_PATH}", file=sys.stderr)
        return 1
    print(f"consistency: {OLD_PATH.name} 与 {ASSET_PATH.name} 内容一致 ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
