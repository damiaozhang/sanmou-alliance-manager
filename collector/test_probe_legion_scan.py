"""军团列表探针（问题二修复）的回归测试。

背景：旧探针只按 `likely_ui_key` + `likely_group_info`（路径含 legion/group 字样）
判定军团节点，对真正存放军团名的容器节点一无所知 —— 历史实测中，
`UnionScheduleWndUI.legionList.N.renderData` / `UnionMemberUI.ui.legionScrollListCList.curShowRender.*`
这些节点的 key 未必含 legion/group，导致 legionGroups 长期只有 0~1 组。

修复：两个探针都新增「按容器 key 名结构化提取军团条目的专项扫描」
（`container_suggests_legion` / `scan_legion_containers` / `add_group_list` / `add_group_fields`）。

本测试有两条通道：
1) 纯 Python 静态断言（CI 默认执行，无外部依赖）。
2) 可选行为验证：若本机可执行 node（生成 Lua 探针）+ lupa（执行 Lua），
   则在沙箱里跑真实生成的探针，校验能从 mock UI cache 提取分组且不误报成员对象。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

COLLECTOR_DIR = Path(__file__).resolve().parent
SCAN_SOURCE = COLLECTOR_DIR / "frida_nslg_runtime_scan.py"

NODE_BIN = shutil.which("node")
try:
    from lupa import LuaRuntime as _LuaRuntime  # type: ignore
except ImportError:  # pragma: no cover
    _LuaRuntime = None


def _load_frida_js() -> str:
    source = SCAN_SOURCE.read_text(encoding="utf-8")
    match = re.search(r'FRIDA_JS\s*=\s*r"""(.*?)"""', source, re.S)
    if not match:
        raise AssertionError("frida_nslg_runtime_scan.py 未找到 FRIDA_JS 字面量")
    return match.group(1)


def _build_lua_probe(probe_name: str) -> str:
    """用 node 执行 FRIDA_JS（截断到 hook 安装循环前）并生成指定探针的 Lua 体。"""
    js = _load_frida_js()
    cut = js.find("for (const symbol of config.symbols)")
    if cut <= 0:
        raise AssertionError("未找到 hook 安装循环标记")
    head = js[:cut].replace(
        "CONFIG_JSON",
        json.dumps({"symbols": [], "modulePrefixes": [], "moduleNames": [], "targets": []}),
        1,
    )
    harness = (
        "function send(){}\nfunction recv(){return null;}\n"
        "const Process = new Proxy({}, { get: () => (() => []) });\n"
        "const Module = new Proxy({}, { get: () => (() => null) });\n"
        "const Memory = new Proxy({}, { get: () => (() => null) });\n"
        "const Interceptor = new Proxy({}, { get: () => (() => null) });\n"
        + head
        + "\n;module.exports = { buildModuleDumpChunk };\n"
    )
    with tempfile.TemporaryDirectory() as tmp:
        head_path = Path(tmp) / "frida_head.js"
        head_path.write_text(harness, encoding="utf-8")
        script = (
            "const m = require(%s);"
            "process.stdout.write(m.buildModuleDumpChunk(%s));"
            % (json.dumps(str(head_path).replace("\\", "/")), json.dumps(probe_name))
        )
        proc = subprocess.run(
            [NODE_BIN, "-e", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )
        if proc.returncode != 0:
            raise AssertionError("node 生成探针失败: %s" % proc.stderr[:2000])
        return proc.stdout


class LegionProbeStaticTests(unittest.TestCase):
    """静态断言：探针源码必须包含军团列表专项扫描结构。CI 默认执行。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.js = _load_frida_js()

    def test_probe_builds_both_legion_dump_chunks(self) -> None:
        self.assertIn("__dump_alliance_legion_cache__", self.js)
        self.assertIn("__dump_alliance_ui_cache__", self.js)

    def test_legion_cache_probe_has_container_scan(self) -> None:
        self.assertIn("local function container_suggests_legion(key)", self.js)
        self.assertIn("local function add_group_fields(source, origin, path)", self.js)
        self.assertIn("local function add_group_list(source, origin, path, key)", self.js)
        self.assertIn(
            "local function scan_legion_containers(value, origin, path, depth, parent_key)",
            self.js,
        )
        # 专项扫描必须在模块遍历里被真正调用，而不是只定义
        self.assertIn(
            "scan_legion_containers(mod, 'module:' .. module_name, module_name, 0, module_name)",
            self.js,
        )

    def test_ui_cache_probe_has_container_scan(self) -> None:
        self.assertIn("local function add_group_fields(source, ui_name, path)", self.js)
        self.assertIn("local function add_group_list(source, ui_name, path, key)", self.js)
        self.assertIn(
            "local function scan_legion_containers(value, ui_name, path, depth, parent_key)",
            self.js,
        )
        # ui probe 的 roots 循环里必须调用专项扫描
        self.assertIn(
            "scan_legion_containers(root.value, root.key, root.key, 0, root.key)", self.js
        )

    def test_container_heuristic_covers_historical_keys(self) -> None:
        """历史 4 次成功提取都依赖 renderData / curRender 这类 key。"""
        self.assertIn("lower:find('rendata', 1, true)", self.js)
        self.assertIn("lower:find('renderdata', 1, true)", self.js)
        self.assertIn("lower:find('currender', 1, true)", self.js)
        self.assertIn("lower:find('legion', 1, true)", self.js)
        self.assertIn("lower:find('group', 1, true)", self.js)

    def test_member_objects_are_excluded_from_groups(self) -> None:
        """成员对象含 avatar*/power 字段，不得被当成军团分组条目。"""
        self.assertIn("local function has_avatar_fields(source)", self.js)
        self.assertIn("'avatarId'", self.js)
        self.assertIn("'avatarName'", self.js)
        self.assertIn("not has_avatar_fields(value)", self.js)

    def test_group_cap_raised_to_200(self) -> None:
        """分组上限从 120 提升到 200，避免大同盟被截断。"""
        self.assertIn("#payload.legionGroups >= 200", self.js)
        self.assertNotIn("#payload.legionGroups >= 120", self.js)


@unittest.skipUnless(NODE_BIN, "需要 node 才能生成 Lua 探针")
class GeneratedLuaProbeTests(unittest.TestCase):
    """验证生成的 Lua 探针体包含修复后的结构。"""

    def test_generated_legion_lua_is_wellformed(self) -> None:
        lua = _build_lua_probe("__dump_alliance_legion_cache__")
        self.assertIn("scan_legion_containers", lua)
        self.assertIn("container_suggests_legion", lua)
        self.assertIn("__dump_alliance_legion_cache__", lua)

    def test_generated_ui_lua_is_wellformed(self) -> None:
        lua = _build_lua_probe("__dump_alliance_ui_cache__")
        self.assertIn("scan_legion_containers", lua)
        self.assertIn("container_suggests_legion", lua)
        self.assertIn("__dump_alliance_ui_cache__", lua)


# 极简 JSON 编码器，供探针内的 rapidjson.encode 使用（探针本身不依赖此实现）。
_COMMON_LUA = r"""
local rapidjson_stub = {}
package = { loaded = {} }
function require(name)
  if name == 'rapidjson' then return rapidjson_stub end
  return package.loaded[name]
end
local function enc(v)
  local t = type(v)
  if t == 'number' then
    if v == math.floor(v) then return string.format('%d', v) end
    return tostring(v)
  elseif t == 'string' then
    return '"' .. v:gsub('\\', '\\\\'):gsub('"', '\\"') .. '"'
  elseif t == 'boolean' then return tostring(v)
  elseif t == 'nil' then return 'null'
  elseif t == 'table' then
    local n, maxi, is_arr = 0, 0, true
    for k in pairs(v) do
      n = n + 1
      if type(k) ~= 'number' then is_arr = false else if k > maxi then maxi = k end end
    end
    if is_arr and maxi == n and n > 0 then
      local parts = {}
      for i = 1, maxi do parts[#parts+1] = enc(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    local parts = {}
    for k, val in pairs(v) do parts[#parts+1] = enc(tostring(k)) .. ':' .. enc(val) end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end
rapidjson_stub.encode = enc
"""


@unittest.skipUnless(NODE_BIN, "需要 node 生成 Lua 探针")
@unittest.skipUnless(_LuaRuntime is not None, "需要 lupa 执行 Lua 探针")
class LegionProbeBehaviorTests(unittest.TestCase):
    """端到端行为：真实生成的探针在 mock 数据上提取军团分组。"""

    def _run_probe(self, probe_name: str, setup_lua: str):
        lua = _LuaRuntime()
        lua.execute(_COMMON_LUA)
        lua.execute(setup_lua)
        body = _build_lua_probe(probe_name)
        raw = lua.execute(body)
        self.assertIsNotNone(raw, "探针返回 nil")
        outer = json.loads(raw)
        return json.loads(outer[0]["returns"])

    def test_ui_probe_extracts_renderdata_container(self) -> None:
        setup = r"""
package.loaded['UI.Common.UIMgr'] = {
  uiClsCache = {
    UnionScheduleWndUI = {
      ui = { name = 'UnionScheduleWndUI' },
      legionList = {
        [1] = { renderData = { [1] = { legionId = 1, legionName = '默认分组' },
                               [2] = { legionId = 3, legionName = '测试军团丙' } } },
        [2] = { renderData = { [1] = { legionId = 5, legionName = '醉团' } } },
      },
    },
    UnionMemberUI = {
      ui = { name = 'UnionMemberUI',
             memberList = { [1] = { avatarId = 1, avatarName = '管毅', power = 100, legionId = 2 } } },
    },
  },
}
"""
        out = self._run_probe("__dump_alliance_ui_cache__", setup)
        names = sorted(g["legionName"] for g in out["legionGroups"])
        self.assertEqual(names, sorted(["默认分组", "测试军团丙", "醉团"]))
        # 成员对象不得混入分组
        self.assertNotIn("管毅", [g.get("legionName") for g in out["legionGroups"]])

    def test_ui_probe_negative_does_not_false_positive(self) -> None:
        setup = r"""
package.loaded['UI.Common.UIMgr'] = {
  uiClsCache = {
    SomeBattleUI = { ui = { name = 'SomeBattleUI' },
                     memberList = { [1] = { avatarId = 1, avatarName = '甲', power = 10 } } },
  },
}
"""
        out = self._run_probe("__dump_alliance_ui_cache__", setup)
        self.assertEqual(out["legionGroups"], [])

    def test_legion_probe_extracts_loaded_module_list(self) -> None:
        setup = r"""
package.loaded['Union.LegionModule'] = {
  legionList = {
    [1] = { legionId = 1, legionName = '默认分组' },
    [2] = { legionId = 4, legionName = '兔团' },
  },
}
package.loaded['Union.Members'] = {
  memberList = { [1] = { avatarId = 1, avatarName = '管毅', power = 100, legionId = 2 } },
}
"""
        out = self._run_probe("__dump_alliance_legion_cache__", setup)
        names = sorted(g["legionName"] for g in out["legionGroups"])
        self.assertEqual(names, sorted(["兔团", "默认分组"]))

    def test_legion_probe_negative_does_not_false_positive(self) -> None:
        setup = r"""
package.loaded['Union.Members'] = {
  memberList = { [1] = { avatarId = 1, avatarName = '甲', power = 10, legionId = 2 } },
}
"""
        out = self._run_probe("__dump_alliance_legion_cache__", setup)
        self.assertEqual(out["legionGroups"], [])


if __name__ == "__main__":
    unittest.main()
