#!/usr/bin/env python3
"""Attach to the NSLG client and dump likely decoded Lua/data buffers.

This script is evidence-oriented: it scans process memory for client-owned
paths/table names and optionally hooks Lua loadbuffer-style functions when
Frida can resolve them. Dumps are written as raw windows for offline analysis.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import frida


DEFAULT_OUT = Path(
    "docs/battle-audit/nslg-authoritative-2026-06-05/raw/runtime-scan"
)
PROCESS_HINTS = ("com.bilibili.nslg", "nslg")


FRIDA_JS = r"""
const config = CONFIG_JSON;
const seenDumps = new Set();
let luaApi = null;
let luaProbeApi = null;
let luaProbeDone = false;
let luaProbeRunning = false;
let luaProbeCallback = null;
let currentLuaProbeModule = null;

function sanitize(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 120);
}

function readUtf8(ptrValue) {
  try {
    if (ptrValue.isNull()) return "";
    return ptrValue.readUtf8String(256) || "";
  } catch (_) {
    return "";
  }
}

function getExport(name) {
  try {
    const direct = Module.findExportByName("xlua.dll", name) || Module.findExportByName(null, name);
    if (direct !== null) return direct;
  } catch (_) {}
  try {
    const matches = DebugSymbol.findFunctionsNamed(name);
    if (matches.length > 0) return matches[0];
  } catch (_) {}
  return null;
}

function ensureLuaApi() {
  if (luaApi !== null) return luaApi;
  const gettop = getExport("lua_gettop");
  const type = getExport("lua_type");
  const typename = getExport("lua_typename");
  const tolstring = getExport("lua_tolstring");
  if (gettop === null || type === null || typename === null || tolstring === null) {
    send({ type: "error", where: "ensureLuaApi", message: "Lua API exports not found" });
    luaApi = false;
    return luaApi;
  }
  luaApi = {
    gettop: new NativeFunction(gettop, "int", ["pointer"]),
    type: new NativeFunction(type, "int", ["pointer", "int"]),
    typename: new NativeFunction(typename, "pointer", ["pointer", "int"]),
    tolstring: new NativeFunction(tolstring, "pointer", ["pointer", "int", "pointer"])
  };
  return luaApi;
}

function ensureLuaProbeApi() {
  if (luaProbeApi !== null) return luaProbeApi;
  const gettop = getExport("lua_gettop");
  const settop = getExport("lua_settop");
  const loadstring = getExport("luaL_loadstring");
  const call = getExport("lua_call");
  const cpcall = getExport("lua_cpcall");
  const pcall = getExport("lua_pcall");
  if (
    gettop === null ||
    settop === null ||
    loadstring === null ||
    call === null ||
    cpcall === null ||
    pcall === null
  ) {
    send({
      type: "error",
      where: "ensureLuaProbeApi",
      message: "Lua probe API exports not found",
      found: {
        lua_gettop: gettop === null ? null : gettop.toString(),
        lua_settop: settop === null ? null : settop.toString(),
        luaL_loadstring: loadstring === null ? null : loadstring.toString(),
        lua_call: call === null ? null : call.toString(),
        lua_cpcall: cpcall === null ? null : cpcall.toString(),
        lua_pcall: pcall === null ? null : pcall.toString()
      }
    });
    luaProbeApi = false;
    return luaProbeApi;
  }
  send({
    type: "lua-probe-api",
    lua_gettop: gettop.toString(),
    lua_settop: settop.toString(),
    luaL_loadstring: loadstring.toString(),
    lua_call: call.toString(),
    lua_cpcall: cpcall.toString(),
    lua_pcall: pcall.toString()
  });
  luaProbeApi = {
    gettop: new NativeFunction(gettop, "int", ["pointer"]),
    settop: new NativeFunction(settop, "void", ["pointer", "int"]),
    loadstring: new NativeFunction(loadstring, "int", ["pointer", "pointer"]),
    call: new NativeFunction(call, "void", ["pointer", "int", "int"]),
    cpcall: new NativeFunction(cpcall, "int", ["pointer", "pointer", "pointer"]),
    pcall: new NativeFunction(pcall, "int", ["pointer", "int", "int", "int"])
  };
  return luaProbeApi;
}

function luaStringLiteral(value) {
  return JSON.stringify(String(value));
}

function buildModuleDumpChunk(moduleName) {
  if (moduleName === "__smoke__") {
    return "return 'OK __smoke__'";
  }
  if (moduleName === "__globals__") {
    return [
      "local parts = {}",
      "local function add(name, value) parts[#parts + 1] = name .. '=' .. type(value) .. ':' .. tostring(value) end",
      "add('pcall', pcall)",
      "add('require', require)",
      "add('package', package)",
      "add('package.loaded', package and package.loaded)",
      "add('_G.rapidjson', rawget(_G, 'rapidjson'))",
      "return table.concat(parts, '\\n')"
    ].join("\n");
  }
  if (moduleName === "__rapidjson_smoke__") {
    return [
      "local ok, rapidjson = pcall(require, 'rapidjson')",
      "if not ok then return 'RAPIDJSON require=false error=' .. tostring(rapidjson) end",
      "local okEncode, text = pcall(rapidjson.encode, { smoke = true, value = 7 })",
      "return 'RAPIDJSON require=true type=' .. type(rapidjson) .. ' encode=' .. tostring(okEncode) .. ' text=' .. tostring(text)"
    ].join("\n");
  }
  if (moduleName === "__loaded_keys__") {
    return [
      "local loaded = package and package.loaded",
      "if type(loaded) ~= 'table' then return 'NO package.loaded' end",
      "local keys = {}",
      "for key, value in pairs(loaded) do",
      "  if type(key) == 'string' then keys[#keys + 1] = key .. '=' .. type(value) end",
      "end",
      "table.sort(keys)",
      "return table.concat(keys, '\\n')"
    ].join("\n");
  }
  if (moduleName === "__noop__") {
    return "return 'NOOP'";
  }
  // 通用逃生舱：__lua__:<json.dumps(lua 源码)>
  // 直接执行任意 Lua 代码块（需自带 return），用于探测游戏内 API（如类的方法名）。
  // 用 JSON 字符串字面量传参：Python 侧 json.dumps 生成，JS 侧 JSON.parse 还原，
  // 可安全携带换行/引号/中文；注意 frida 的 JS 环境是 QuickJS，**没有 Node 的 Buffer**。
  if (moduleName.indexOf("__lua__:") === 0) {
    try {
      return JSON.parse(moduleName.slice("__lua__:".length));
    } catch (err) {
      return "return 'LUA_PAYLOAD_PARSE_ERROR: " + String(err) + "'";
    }
  }
  if (moduleName.indexOf("__loaded__:") === 0) {
    const loadedModule = luaStringLiteral(moduleName.slice("__loaded__:".length));
    return [
      "local moduleName = " + loadedModule,
      "local loaded = package and package.loaded",
      "local value = loaded and loaded[moduleName]",
      "local parts = { 'LOADED ' .. moduleName, 'type=' .. type(value), 'tostring=' .. tostring(value) }",
      "if type(value) == 'table' then",
      "  local count = 0",
      "  local keys = {}",
      "  for key, child in pairs(value) do",
      "    count = count + 1",
      "    if count <= 30 then keys[#keys + 1] = tostring(key) .. ':' .. type(child) end",
      "  end",
      "  parts[#parts + 1] = 'count=' .. tostring(count)",
      "  parts[#parts + 1] = 'keys=' .. table.concat(keys, ',')",
      "end",
      "return table.concat(parts, '\\n')"
    ].join("\n");
  }
  if (moduleName.indexOf("__require_only__:") === 0) {
    const requiredModule = luaStringLiteral(moduleName.slice("__require_only__:".length));
    return [
      "local moduleName = " + requiredModule,
      "local ok, value = pcall(require, moduleName)",
      "local parts = { 'REQUIRE ' .. moduleName, 'ok=' .. tostring(ok), 'type=' .. type(value), 'tostring=' .. tostring(value) }",
      "if ok and type(value) == 'table' then",
      "  local count = 0",
      "  for _ in pairs(value) do count = count + 1 end",
      "  parts[#parts + 1] = 'count=' .. tostring(count)",
      "end",
      "return table.concat(parts, '\\n')"
    ].join("\n");
  }
  if (moduleName.indexOf("__install_rpc_hook__:") === 0) {
    const spec = moduleName.slice("__install_rpc_hook__:".length);
    const parts = spec.split("|");
    const targetModule = luaStringLiteral(parts[0] || "");
    const targetFunc = luaStringLiteral(parts[1] || "");
    return [
      "local moduleName = " + targetModule,
      "local funcName = " + targetFunc,
      "if moduleName == '' or funcName == '' then return 'INSTALL_RPC_HOOK_ERROR invalid spec' end",
      "local function json_escape(value)",
      "  return '\"' .. tostring(value):gsub('[%z\\1-\\31\\\\\"]', function(char)",
      "    local byte = string.byte(char)",
      "    if char == '\\\\' then return '\\\\\\\\' end",
      "    if char == '\"' then return '\\\\\"' end",
      "    if char == '\\n' then return '\\\\n' end",
      "    if char == '\\r' then return '\\\\r' end",
      "    if char == '\\t' then return '\\\\t' end",
      "    return string.format('\\\\u%04x', byte)",
      "  end) .. '\"'",
      "end",
      "local function encode(value, depth, seen)",
      "  depth = depth or 0",
      "  seen = seen or {}",
      "  local valueType = type(value)",
      "  if valueType == 'nil' then return 'null' end",
      "  if valueType == 'boolean' then return value and 'true' or 'false' end",
      "  if valueType == 'number' then",
      "    if value ~= value or value == math.huge or value == -math.huge then return 'null' end",
      "    return tostring(value)",
      "  end",
      "  if valueType == 'string' then",
      "    local text = value",
      "    if string.len(text) > 500 then text = string.sub(text, 1, 500) .. '...[truncated]' end",
      "    return json_escape(text)",
      "  end",
      "  if valueType ~= 'table' then return '{\"__type\":' .. json_escape(valueType) .. ',\"__tostring\":' .. json_escape(tostring(value)) .. '}' end",
      "  if seen[value] then return '{\"__type\":\"table\",\"__cycle\":true,\"__tostring\":' .. json_escape(tostring(value)) .. '}' end",
      "  if depth >= 7 then return '{\"__type\":\"table\",\"__maxDepth\":true,\"__tostring\":' .. json_escape(tostring(value)) .. '}' end",
      "  seen[value] = true",
      "  local keys = {}",
      "  local count = 0",
      "  for key in pairs(value) do",
      "    count = count + 1",
      "    if #keys < 320 then keys[#keys + 1] = key end",
      "  end",
      "  table.sort(keys, function(left, right)",
      "    local leftType = type(left)",
      "    local rightType = type(right)",
      "    if leftType == rightType then return tostring(left) < tostring(right) end",
      "    return leftType < rightType",
      "  end)",
      "  local out = { '\"__type\":\"table\"', '\"__count\":' .. tostring(count) }",
      "  if count > #keys then out[#out + 1] = '\"__truncated\":true' end",
      "  for _, key in ipairs(keys) do",
      "    local keyText = tostring(key)",
      "    if type(key) ~= 'string' then keyText = '[' .. type(key) .. ']' .. keyText end",
      "    local ok, encoded = pcall(encode, value[key], depth + 1, seen)",
      "    if not ok then encoded = '{\"__error\":' .. json_escape(tostring(encoded)) .. '}' end",
      "    out[#out + 1] = json_escape(keyText) .. ':' .. encoded",
      "  end",
      "  seen[value] = nil",
      "  return '{' .. table.concat(out, ',') .. '}'",
      "end",
      "local function pack_returns(...) return { n = select('#', ...), ... } end",
      "local unpack_returns = table.unpack or unpack",
      "_G.__codex_rpc_captures = _G.__codex_rpc_captures or {}",
      "_G.__codex_rpc_originals = _G.__codex_rpc_originals or {}",
      "local mod = package and package.loaded and rawget(package.loaded, moduleName)",
      "if type(mod) ~= 'table' then",
      "  local okRequire, loaded = pcall(require, moduleName)",
      "  if not okRequire then return 'INSTALL_RPC_HOOK_ERROR require ' .. moduleName .. ': ' .. tostring(loaded) end",
      "  mod = loaded",
      "end",
      "if type(mod) ~= 'table' then return 'INSTALL_RPC_HOOK_ERROR module not table ' .. moduleName .. ' type=' .. type(mod) end",
      "local hookKey = moduleName .. '.' .. funcName",
      "if _G.__codex_rpc_originals[hookKey] then return 'INSTALL_RPC_HOOK already ' .. hookKey end",
      "local okGet, original = pcall(rawget, mod, funcName)",
      "if not okGet then return 'INSTALL_RPC_HOOK_ERROR rawget ' .. hookKey .. ': ' .. tostring(original) end",
      "if type(original) ~= 'function' then return 'INSTALL_RPC_HOOK_ERROR missing function ' .. hookKey .. ' type=' .. type(original) end",
      "local wrapper = function(...)",
      "  local args = { ... }",
      "  local okEncoded, encoded = pcall(function() return encode(args, 0, {}) end)",
      "  if not okEncoded then encoded = '{\"__encode_error\":' .. json_escape(tostring(encoded)) .. '}' end",
      "  local capture = { module = moduleName, func = funcName, time = os and os.time and os.time() or 0, args = encoded }",
      "  _G.__codex_rpc_captures[#_G.__codex_rpc_captures + 1] = capture",
      "  local returnValues = pack_returns(original(...))",
      "  local okReturnEncoded, encodedReturn = pcall(function() return encode(returnValues, 0, {}) end)",
      "  if not okReturnEncoded then encodedReturn = '{\"__encode_error\":' .. json_escape(tostring(encodedReturn)) .. '}' end",
      "  capture.returns = encodedReturn",
      "  return unpack_returns(returnValues, 1, returnValues.n)",
      "end",
      "_G.__codex_rpc_originals[hookKey] = original",
      "local okSet, setErr = pcall(rawset, mod, funcName, wrapper)",
      "if not okSet then _G.__codex_rpc_originals[hookKey] = nil; return 'INSTALL_RPC_HOOK_ERROR rawset ' .. hookKey .. ': ' .. tostring(setErr) end",
      "return 'INSTALL_RPC_HOOK ' .. hookKey"
    ].join("\n");
  }
  if (moduleName.indexOf("__json_loaded__:") === 0) {
    const loadedModule = luaStringLiteral(moduleName.slice("__json_loaded__:".length));
    return [
      "local moduleName = " + loadedModule,
      "local loaded = package and package.loaded",
      "local root = loaded and loaded[moduleName]",
      "if root == nil then return 'JSON_LOADED_ERROR module not loaded: ' .. moduleName end",
      "local function json_escape(value)",
      "  return '\"' .. tostring(value):gsub('[%z\\1-\\31\\\\\"]', function(char)",
      "    local byte = string.byte(char)",
      "    if char == '\\\\' then return '\\\\\\\\' end",
      "    if char == '\"' then return '\\\\\"' end",
      "    if char == '\\b' then return '\\\\b' end",
      "    if char == '\\f' then return '\\\\f' end",
      "    if char == '\\n' then return '\\\\n' end",
      "    if char == '\\r' then return '\\\\r' end",
      "    if char == '\\t' then return '\\\\t' end",
      "    return string.format('\\\\u%04x', byte)",
      "  end) .. '\"'",
      "end",
      "local function is_array(value)",
      "  local count = 0",
      "  local max_index = 0",
      "  for key in pairs(value) do",
      "    if type(key) ~= 'number' or key < 1 or key % 1 ~= 0 then return false, 0 end",
      "    count = count + 1",
      "    if key > max_index then max_index = key end",
      "  end",
      "  return max_index == count, max_index",
      "end",
      "local encode",
      "encode = function(value, seen)",
      "  local value_type = type(value)",
      "  if value_type == 'nil' then return 'null' end",
      "  if value_type == 'boolean' then return value and 'true' or 'false' end",
      "  if value_type == 'number' then",
      "    if value ~= value or value == math.huge or value == -math.huge then return 'null' end",
      "    return tostring(value)",
      "  end",
      "  if value_type == 'string' then return json_escape(value) end",
      "  if value_type ~= 'table' then error('unsupported json type: ' .. value_type) end",
      "  seen = seen or {}",
      "  if seen[value] then error('cycle while encoding table') end",
      "  seen[value] = true",
      "  local array, max_index = is_array(value)",
      "  local parts = {}",
      "  if array then",
      "    for index = 1, max_index do parts[#parts + 1] = encode(value[index], seen) end",
      "    seen[value] = nil",
      "    return '[' .. table.concat(parts, ',') .. ']'",
      "  end",
      "  local keys = {}",
      "  for key in pairs(value) do keys[#keys + 1] = key end",
      "  table.sort(keys, function(left, right)",
      "    local left_type = type(left)",
      "    local right_type = type(right)",
      "    if left_type == right_type then return tostring(left) < tostring(right) end",
      "    return left_type < right_type",
      "  end)",
      "  for _, key in ipairs(keys) do",
      "    parts[#parts + 1] = json_escape(key) .. ':' .. encode(value[key], seen)",
      "  end",
      "  seen[value] = nil",
      "  return '{' .. table.concat(parts, ',') .. '}'",
      "end",
      "local ok, text = pcall(encode, root)",
      "if not ok then return 'JSON_ENCODE_ERROR ' .. moduleName .. ': ' .. tostring(text) end",
      "return text"
    ].join("\n");
  }
  if (moduleName.indexOf("__snapshot_loaded__:") === 0) {
    const loadedModule = luaStringLiteral(moduleName.slice("__snapshot_loaded__:".length));
    return [
      "local moduleName = " + loadedModule,
      "local loaded = package and package.loaded",
      "local root = loaded and loaded[moduleName]",
      "if root == nil then return 'SNAPSHOT_LOADED_ERROR module not loaded: ' .. moduleName end",
      "local maxDepth = 5",
      "local maxEntries = 120",
      "local maxString = 500",
      "local function json_escape(value)",
      "  return '\"' .. tostring(value):gsub('[%z\\1-\\31\\\\\"]', function(char)",
      "    local byte = string.byte(char)",
      "    if char == '\\\\' then return '\\\\\\\\' end",
      "    if char == '\"' then return '\\\\\"' end",
      "    if char == '\\b' then return '\\\\b' end",
      "    if char == '\\f' then return '\\\\f' end",
      "    if char == '\\n' then return '\\\\n' end",
      "    if char == '\\r' then return '\\\\r' end",
      "    if char == '\\t' then return '\\\\t' end",
      "    return string.format('\\\\u%04x', byte)",
      "  end) .. '\"'",
      "end",
      "local function safe_number(value)",
      "  if value ~= value or value == math.huge or value == -math.huge then return 'null' end",
      "  return tostring(value)",
      "end",
      "local function encode_leaf(value)",
      "  local valueType = type(value)",
      "  if valueType == 'nil' then return 'null' end",
      "  if valueType == 'boolean' then return value and 'true' or 'false' end",
      "  if valueType == 'number' then return safe_number(value) end",
      "  if valueType == 'string' then",
      "    local text = value",
      "    if string.len(text) > maxString then text = string.sub(text, 1, maxString) .. '...[truncated]' end",
      "    return json_escape(text)",
      "  end",
      "  return '{\"__type\":' .. json_escape(valueType) .. ',\"__tostring\":' .. json_escape(tostring(value)) .. '}'",
      "end",
      "local function sorted_keys(value)",
      "  local keys = {}",
      "  local count = 0",
      "  for key in pairs(value) do",
      "    count = count + 1",
      "    if #keys < maxEntries then keys[#keys + 1] = key end",
      "  end",
      "  table.sort(keys, function(left, right)",
      "    local leftType = type(left)",
      "    local rightType = type(right)",
      "    if leftType == rightType then return tostring(left) < tostring(right) end",
      "    return leftType < rightType",
      "  end)",
      "  return keys, count",
      "end",
      "local encode",
      "encode = function(value, depth, seen)",
      "  local valueType = type(value)",
      "  if valueType ~= 'table' then return encode_leaf(value) end",
      "  seen = seen or {}",
      "  if seen[value] then",
      "    return '{\"__type\":\"table\",\"__cycle\":true,\"__tostring\":' .. json_escape(tostring(value)) .. '}'",
      "  end",
      "  if depth >= maxDepth then",
      "    return '{\"__type\":\"table\",\"__maxDepth\":true,\"__tostring\":' .. json_escape(tostring(value)) .. '}'",
      "  end",
      "  seen[value] = true",
      "  local keys, count = sorted_keys(value)",
      "  local parts = {",
      "    '\"__type\":\"table\"',",
      "    '\"__tostring\":' .. json_escape(tostring(value)),",
      "    '\"__count\":' .. tostring(count)",
      "  }",
      "  if count > #keys then parts[#parts + 1] = '\"__truncated\":true' end",
      "  for _, key in ipairs(keys) do",
      "    local keyText = tostring(key)",
      "    if type(key) ~= 'string' then keyText = '[' .. type(key) .. ']' .. keyText end",
      "    local ok, encoded = pcall(encode, value[key], depth + 1, seen)",
      "    if not ok then encoded = '{\"__error\":' .. json_escape(tostring(encoded)) .. '}' end",
      "    parts[#parts + 1] = json_escape(keyText) .. ':' .. encoded",
      "  end",
      "  seen[value] = nil",
      "  return '{' .. table.concat(parts, ',') .. '}'",
      "end",
      "local ok, text = pcall(encode, root, 0, {})",
      "if not ok then return 'SNAPSHOT_ENCODE_ERROR ' .. moduleName .. ': ' .. tostring(text) end",
      "return text"
    ].join("\n");
  }
  if (moduleName.indexOf("__snapshot_path__:") === 0) {
    const spec = moduleName.slice("__snapshot_path__:".length);
    const parts = spec.split("|");
    const loadedModule = luaStringLiteral(parts[0] || "");
    const pathParts = (parts[1] || "").split(".").filter((part) => part.length > 0);
    const maxDepth = Number.isFinite(Number(parts[2])) ? Math.max(1, Math.min(12, Number(parts[2]))) : 7;
    const maxEntries = Number.isFinite(Number(parts[3])) ? Math.max(10, Math.min(500, Number(parts[3]))) : 200;
    const pathLua = "{ " + pathParts.map((part) => luaStringLiteral(part)).join(", ") + " }";
    return [
      "local moduleName = " + loadedModule,
      "local pathParts = " + pathLua,
      "local loaded = package and package.loaded",
      "local root = loaded and loaded[moduleName]",
      "if root == nil then return 'SNAPSHOT_PATH_ERROR module not loaded: ' .. moduleName end",
      "local current = root",
      "for _, part in ipairs(pathParts) do",
      "  if type(current) ~= 'table' then return 'SNAPSHOT_PATH_ERROR non-table before ' .. tostring(part) end",
      "  local value = rawget(current, part)",
      "  if value == nil then",
      "    local numeric = tonumber(part)",
      "    if numeric ~= nil then value = rawget(current, numeric) end",
      "  end",
      "  if value == nil then return 'SNAPSHOT_PATH_ERROR missing path part: ' .. tostring(part) end",
      "  current = value",
      "end",
      "local maxDepth = " + String(maxDepth),
      "local maxEntries = " + String(maxEntries),
      "local maxString = 500",
      "local function json_escape(value)",
      "  return '\"' .. tostring(value):gsub('[%z\\1-\\31\\\\\"]', function(char)",
      "    local byte = string.byte(char)",
      "    if char == '\\\\' then return '\\\\\\\\' end",
      "    if char == '\"' then return '\\\\\"' end",
      "    if char == '\\b' then return '\\\\b' end",
      "    if char == '\\f' then return '\\\\f' end",
      "    if char == '\\n' then return '\\\\n' end",
      "    if char == '\\r' then return '\\\\r' end",
      "    if char == '\\t' then return '\\\\t' end",
      "    return string.format('\\\\u%04x', byte)",
      "  end) .. '\"'",
      "end",
      "local function safe_number(value)",
      "  if value ~= value or value == math.huge or value == -math.huge then return 'null' end",
      "  return tostring(value)",
      "end",
      "local function encode_leaf(value)",
      "  local valueType = type(value)",
      "  if valueType == 'nil' then return 'null' end",
      "  if valueType == 'boolean' then return value and 'true' or 'false' end",
      "  if valueType == 'number' then return safe_number(value) end",
      "  if valueType == 'string' then",
      "    local text = value",
      "    if string.len(text) > maxString then text = string.sub(text, 1, maxString) .. '...[truncated]' end",
      "    return json_escape(text)",
      "  end",
      "  return '{\"__type\":' .. json_escape(valueType) .. ',\"__tostring\":' .. json_escape(tostring(value)) .. '}'",
      "end",
      "local function sorted_keys(value)",
      "  local keys = {}",
      "  local count = 0",
      "  for key in pairs(value) do",
      "    count = count + 1",
      "    if #keys < maxEntries then keys[#keys + 1] = key end",
      "  end",
      "  table.sort(keys, function(left, right)",
      "    local leftType = type(left)",
      "    local rightType = type(right)",
      "    if leftType == rightType then return tostring(left) < tostring(right) end",
      "    return leftType < rightType",
      "  end)",
      "  return keys, count",
      "end",
      "local encode",
      "encode = function(value, depth, seen)",
      "  local valueType = type(value)",
      "  if valueType ~= 'table' then return encode_leaf(value) end",
      "  seen = seen or {}",
      "  if seen[value] then",
      "    return '{\"__type\":\"table\",\"__cycle\":true,\"__tostring\":' .. json_escape(tostring(value)) .. '}'",
      "  end",
      "  if depth >= maxDepth then",
      "    return '{\"__type\":\"table\",\"__maxDepth\":true,\"__tostring\":' .. json_escape(tostring(value)) .. '}'",
      "  end",
      "  seen[value] = true",
      "  local keys, count = sorted_keys(value)",
      "  local parts = {",
      "    '\"__type\":\"table\"',",
      "    '\"__tostring\":' .. json_escape(tostring(value)),",
      "    '\"__count\":' .. tostring(count)",
      "  }",
      "  if count > #keys then parts[#parts + 1] = '\"__truncated\":true' end",
      "  for _, key in ipairs(keys) do",
      "    local keyText = tostring(key)",
      "    if type(key) ~= 'string' then keyText = '[' .. type(key) .. ']' .. keyText end",
      "    local ok, encoded = pcall(encode, value[key], depth + 1, seen)",
      "    if not ok then encoded = '{\"__error\":' .. json_escape(tostring(encoded)) .. '}' end",
      "    parts[#parts + 1] = json_escape(keyText) .. ':' .. encoded",
      "  end",
      "  seen[value] = nil",
      "  return '{' .. table.concat(parts, ',') .. '}'",
      "end",
      "local ok, text = pcall(encode, current, 0, {})",
      "if not ok then return 'SNAPSHOT_PATH_ENCODE_ERROR ' .. moduleName .. ': ' .. tostring(text) end",
      "return text"
    ].join("\n");
  }
  if (moduleName === "__install_season_rpc_hooks__" || moduleName === "__install_alliance_rpc_hooks__" || moduleName === "__install_battle_listener_hooks__") {
    return [
      "local function json_escape(value)",
      "  return '\"' .. tostring(value):gsub('[%z\\1-\\31\\\\\"]', function(char)",
      "    local byte = string.byte(char)",
      "    if char == '\\\\' then return '\\\\\\\\' end",
      "    if char == '\"' then return '\\\\\"' end",
      "    if char == '\\b' then return '\\\\b' end",
      "    if char == '\\f' then return '\\\\f' end",
      "    if char == '\\n' then return '\\\\n' end",
      "    if char == '\\r' then return '\\\\r' end",
      "    if char == '\\t' then return '\\\\t' end",
      "    return string.format('\\\\u%04x', byte)",
      "  end) .. '\"'",
      "end",
      "local function encode(value, depth, seen)",
      "  depth = depth or 0",
      "  seen = seen or {}",
      "  local valueType = type(value)",
      "  if valueType == 'nil' then return 'null' end",
      "  if valueType == 'boolean' then return value and 'true' or 'false' end",
      "  if valueType == 'number' then",
      "    if value ~= value or value == math.huge or value == -math.huge then return 'null' end",
      "    return tostring(value)",
      "  end",
      "  if valueType == 'string' then",
      "    local text = value",
      "    if string.len(text) > 500 then text = string.sub(text, 1, 500) .. '...[truncated]' end",
      "    return json_escape(text)",
      "  end",
      "  if valueType ~= 'table' then",
      "    return '{\"__type\":' .. json_escape(valueType) .. ',\"__tostring\":' .. json_escape(tostring(value)) .. '}'",
      "  end",
      "  if seen[value] then return '{\"__type\":\"table\",\"__cycle\":true,\"__tostring\":' .. json_escape(tostring(value)) .. '}' end",
      "  if depth >= 7 then return '{\"__type\":\"table\",\"__maxDepth\":true,\"__tostring\":' .. json_escape(tostring(value)) .. '}' end",
      "  seen[value] = true",
      "  local keys = {}",
      "  local count = 0",
      "  for key in pairs(value) do",
      "    count = count + 1",
      "    if #keys < 320 then keys[#keys + 1] = key end",
      "  end",
      "  table.sort(keys, function(left, right)",
      "    local leftType = type(left)",
      "    local rightType = type(right)",
      "    if leftType == rightType then return tostring(left) < tostring(right) end",
      "    return leftType < rightType",
      "  end)",
      "  local parts = { '\"__type\":\"table\"', '\"__count\":' .. tostring(count) }",
      "  if count > #keys then parts[#parts + 1] = '\"__truncated\":true' end",
      "  for _, key in ipairs(keys) do",
      "    local keyText = tostring(key)",
      "    if type(key) ~= 'string' then keyText = '[' .. type(key) .. ']' .. keyText end",
      "    local ok, encoded = pcall(encode, value[key], depth + 1, seen)",
      "    if not ok then encoded = '{\"__error\":' .. json_escape(tostring(encoded)) .. '}' end",
      "    parts[#parts + 1] = json_escape(keyText) .. ':' .. encoded",
      "  end",
      "  seen[value] = nil",
      "  return '{' .. table.concat(parts, ',') .. '}'",
      "end",
      "local function pack_returns(...)",
      "  return { n = select('#', ...), ... }",
      "end",
      "local unpack_returns = table.unpack or unpack",
      "local requestedHook = " + luaStringLiteral(moduleName),
      "_G.__codex_rpc_captures = {}",
      "_G.__codex_rpc_originals = _G.__codex_rpc_originals or {}",
      "local targets = {",
      "  ['Proxy.AvatarMembers.ImpSeason'] = { 'RPCGetTeamMemberInfoResponse', 'RPCGetSelfTeamBaseInfoResponse', 'RPCGetTeamDetailInfoResponse', 'RPCGetTargetZoneInfoResponse', 'RPCGetNextServerInfoResponse', 'RPCGetSameNextServerIdTeamListResponse', 'RPCGetRegionGroupInfoResponse', 'RPCGetTeamsChoosedRegionInfoResponse', 'RPCFactionTeamListResponse', 'RPCSearchTeamResponse', 'RPCSearchCrossZoneTeamResponse', 'RPCGetNoTeamUnionMembersResponse' },",
      "  ['Proxy.AvatarMembers.ImpSeasonSettle'] = { 'RPCGetSettlePreviewInfoResponse', 'RPCGetCityFirstOccupyDataResponse', 'RPCGetFactionSeasonSettleRanksResponse' },",
      "  ['Proxy.AccountMembers.ImpCreateRole'] = { 'account_get_team_avatar_infoResponse', 'account_get_regionsResponse', 'account_select_regionResponse' },",
      "  ['Proxy.AvatarMembers.ImpUnion'] = { 'SRPC_RPCReqUnionMemberInfoResponse', 'SRPC_RPCReqGetAllLegionInfoResponse' },",
      "  ['Proxy.AvatarMembers.ImpUnionBuilding'] = { 'RPC_GetUnionBuildingInfoResponse', 'RPC_UnionBuildingUpgradeResponse', 'RPC_UnionBuildingUpgradeStateResponse', 'RPCUnionPalaceLevelChangeResponse', 'DRPC_WaterBattleTech_GetTechInfoResponse', 'DRPC_WaterBattleTech_UpgradeTechResponse', 'GetUnionBuildingInfosByType', 'GetCurUnionBuildingLevel', 'GetUnionBuildingEffect' },",
      "  ['Proxy.AvatarMembers.ImpUnionHistory'] = { 'SRPC_GetUnionHistoryInfoResponse', 'SRPC_GetUnionHistoryDetailInfoResponse', 'SRPC_GetUnionHistorySimpleInfoResponse', 'SRPC_GetUnionAchievementResponse', 'SRPC_GetUnionGloryScoreBonusResponse' },",
      "  ['Proxy.AvatarMembers.ImpUnionSalary'] = { 'RPCGetBonusContriRankResponse', 'RPCGetUnionBonusAndOfficialSalaryInfoResponse', 'RPCReceiveUnionBonusResponse', 'RPCReceiveUnionOfficialSalaryResponse' },",
      "  ['Proxy.AvatarMembers.ImpUnionSchedule'] = { 'RPCGetAllUnionScheduleResponse', 'RPCGetAllTemplateScheduleResponse', 'RPCNotifyUnionScheduleChangeResponse', 'RPCNotifyUnionTemplateScheduleChangeResponse' },",
      "  ['Proxy.AvatarMembers.ImpUnionStrategy'] = { 'RPCGetUnionStrategyResponse', 'RPCGetUnionStrategyHistoryResponse', 'SRPC_NotifyUnionStrategyPointResponse' },",
      "  ['Proxy.AvatarMembers.ImpUnionRelation'] = { 'RPCGetDiplomacyUnionInfoResponse', 'DRPC_FriendlyUnion_GetFriendlyUnionListResponse', 'DRPC_FriendlyUnion_NotifyFriendlyUnionChangeResponse' },",
      "  ['Proxy.AvatarMembers.ImpUnionShip'] = { 'RPCGetUnionShipSimpleInfosResponse', 'RPCGetOneUnionShipDetailInfoResponse', 'RPCBuildUnionShipResponse', 'RPCUnionShipAddArmyToShipResponse', 'RPCUnionShipRemoveArmyFromShipResponse', 'GetCurAllUnionShip', 'GetCurCanBuildUnionShipCount', 'GetUnionShipByCarrierId', 'GetUnionShipsByBuildIdAndYard' },",
      "  ['Proxy.AvatarMembers.ImpRank'] = { 'RPCGetRankResponse', 'RPCGetRankSimpleDataResponse', 'RPCGetOneRankDataResponse', 'RPCGetSelfRankIndexResponse', 'RPCGetSelfUnionRankIndexResponse', 'RPCGetMaxBlockLvInOccupyRankResponse' },",
      "}",
      "local installed = {}",
      "local skipped = {}",
      "local function install_one(moduleName, mod, funcName)",
      "  local key = moduleName .. '.' .. funcName",
      "  if _G.__codex_rpc_originals[key] then",
      "    installed[#installed + 1] = key .. ' already'",
      "    return",
      "  end",
      "  local okGet, original = pcall(rawget, mod, funcName)",
      "  if not okGet then",
      "    skipped[#skipped + 1] = key .. ' rawget failed: ' .. tostring(original)",
      "    return",
      "  end",
      "  if type(original) ~= 'function' then return end",
      "  local wrapper = function(...)",
      "    local args = { ... }",
      "    local okEncoded, encoded = pcall(function() return encode(args, 0, {}) end)",
      "    if not okEncoded then encoded = '{\"__encode_error\":' .. json_escape(tostring(encoded)) .. '}' end",
      "    local capture = { module = moduleName, func = funcName, time = os and os.time and os.time() or 0, args = encoded }",
      "    _G.__codex_rpc_captures[#_G.__codex_rpc_captures + 1] = capture",
      "    local returnValues = pack_returns(original(...))",
      "    local okReturnEncoded, encodedReturn = pcall(function() return encode(returnValues, 0, {}) end)",
      "    if not okReturnEncoded then encodedReturn = '{\"__encode_error\":' .. json_escape(tostring(encodedReturn)) .. '}' end",
      "    capture.returns = encodedReturn",
      "    return unpack_returns(returnValues, 1, returnValues.n)",
      "  end",
      "  _G.__codex_rpc_originals[key] = original",
      "  local okSet, setErr = pcall(rawset, mod, funcName, wrapper)",
      "  if okSet then",
      "    installed[#installed + 1] = key",
      "  else",
      "    _G.__codex_rpc_originals[key] = nil",
      "    skipped[#skipped + 1] = key .. ' rawset failed: ' .. tostring(setErr)",
      "  end",
      "end",
      "local selectedTargets = targets",
      "if requestedHook == '__install_alliance_rpc_hooks__' then",
      "  selectedTargets = {",
      "    ['Proxy.AvatarMembers.ImpUnion'] = targets['Proxy.AvatarMembers.ImpUnion'],",
      "  }",
      "elseif requestedHook == '__install_season_rpc_hooks__' then",
      "  selectedTargets = {",
      "    ['Proxy.AvatarMembers.ImpSeason'] = targets['Proxy.AvatarMembers.ImpSeason'],",
      "    ['Proxy.AvatarMembers.ImpSeasonSettle'] = targets['Proxy.AvatarMembers.ImpSeasonSettle'],",
      "    ['Proxy.AccountMembers.ImpCreateRole'] = targets['Proxy.AccountMembers.ImpCreateRole'],",
      "  }",
      "elseif requestedHook == '__install_battle_listener_hooks__' then",
      "  selectedTargets = {}",
      "end",
      "for moduleName, funcs in pairs(selectedTargets) do",
      "  local mod = package and package.loaded and rawget(package.loaded, moduleName)",
      "  if type(mod) == 'table' and type(funcs) == 'table' then",
      "    for _, funcName in ipairs(funcs) do install_one(moduleName, mod, funcName) end",
      "  end",
      "end",
      "if requestedHook == '__install_battle_listener_hooks__' and package and type(package.loaded) == 'table' then",
      "  local battleFuncs = { 'RPCGetBattleBlockList', 'RPCGetBattleBlockListResponse', 'RPCGetDetailCombatInfo', 'RPCGetDetailCombatInfoResponse', 'RPCGetTargetCombatList', 'RPCGetTargetCombatListResponse', 'RPCGetUnionBattleBlockList', 'RPCGetUnionBattleBlockListResponse', 'RPCGetStaticsCombatInfo', 'RPCGetStaticsCombatInfoResponse', 'RPCGetChildCombatInfoList', 'RPCGetChildCombatInfoListResponse', 'RPCGetUnionChildCombatInfoList', 'RPCGetUnionChildCombatInfoListResponse', 'RPCGetAllCombatInfo', 'RPCGetAllCombatInfoResponse', 'RPCGetHeroBattleSnapRecords', 'RPCGetHeroBattleSnapRecordsResponse', 'RPCGetBattleAllSnapRecords', 'RPCGetBattleAllSnapRecordsResponse', 'RPCBattleSearch', 'RPCBattleSearchResponse', 'RPCTargetCoordBattleBlockList', 'RPCTargetCoordBattleBlockListResponse', 'RPCGetTowerBattleBlockList', 'RPCGetTowerBattleBlockListResponse', 'RPCGetTargetUIDOneBattleBlockInfo', 'RPCGetTargetUIDOneBattleBlockInfoResponse', 'RPCGetExpeditionBattleBlockList', 'RPCGetExpeditionBattleBlockListResponse', 'RPCGetTargetBlockHashBattleBlockInfo', 'RPCGetTargetBlockHashBattleBlockInfoResponse', 'RPCStarBattleBlockList', 'RPCStarBattleBlockListResponse' }",
      "  for loadedName, mod in pairs(package.loaded) do",
      "    if type(loadedName) == 'string' and type(mod) == 'table' then",
      "      for _, funcName in ipairs(battleFuncs) do install_one(loadedName, mod, funcName) end",
      "    end",
      "  end",
      "end",
      "return 'installed=' .. tostring(#installed) .. '\\nskipped=' .. tostring(#skipped) .. '\\n' .. table.concat(installed, '\\n') .. (#skipped > 0 and ('\\nSKIPPED\\n' .. table.concat(skipped, '\\n')) or '')"
    ].join("\n");
  }
  if (moduleName === "__dump_alliance_legion_cache__") {
    return [
      "local function json_escape(value)",
      "  return '\"' .. tostring(value):gsub('[%z\\1-\\31\\\\\"]', function(char)",
      "    local byte = string.byte(char)",
      "    if char == '\\\\' then return '\\\\\\\\' end",
      "    if char == '\"' then return '\\\\\"' end",
      "    if char == '\\n' then return '\\\\n' end",
      "    if char == '\\r' then return '\\\\r' end",
      "    if char == '\\t' then return '\\\\t' end",
      "    return string.format('\\\\u%04x', byte)",
      "  end) .. '\"'",
      "end",
      "local function is_array(value)",
      "  local count = 0",
      "  local max_index = 0",
      "  for key in pairs(value) do",
      "    if type(key) ~= 'number' or key < 1 or key % 1 ~= 0 then return false, 0 end",
      "    count = count + 1",
      "    if key > max_index then max_index = key end",
      "  end",
      "  return max_index == count, max_index",
      "end",
      "local encode",
      "encode = function(value, depth, seen)",
      "  depth = depth or 0",
      "  seen = seen or {}",
      "  local value_type = type(value)",
      "  if value_type == 'nil' then return 'null' end",
      "  if value_type == 'boolean' then return value and 'true' or 'false' end",
      "  if value_type == 'number' then",
      "    if value ~= value or value == math.huge or value == -math.huge then return 'null' end",
      "    return tostring(value)",
      "  end",
      "  if value_type == 'string' then return json_escape(value) end",
      "  if value_type ~= 'table' then return json_escape(tostring(value)) end",
      "  if seen[value] then return '{\"__type\":\"table\",\"__cycle\":true}' end",
      "  if depth >= 8 then return '{\"__type\":\"table\",\"__maxDepth\":true}' end",
      "  seen[value] = true",
      "  local array, max_index = is_array(value)",
      "  local parts = {}",
      "  if array then",
      "    for index = 1, max_index do parts[#parts + 1] = encode(value[index], depth + 1, seen) end",
      "    seen[value] = nil",
      "    return '[' .. table.concat(parts, ',') .. ']'",
      "  end",
      "  local keys = {}",
      "  for key in pairs(value) do keys[#keys + 1] = key end",
      "  table.sort(keys, function(left, right) return tostring(left) < tostring(right) end)",
      "  for _, key in ipairs(keys) do",
      "    parts[#parts + 1] = json_escape(key) .. ':' .. encode(value[key], depth + 1, seen)",
      "  end",
      "  seen[value] = nil",
      "  return '{' .. table.concat(parts, ',') .. '}'",
      "end",
      "local function trim_text(value)",
      "  if type(value) ~= 'string' then return '' end",
      "  return (value:gsub('^%s+', ''):gsub('%s+$', ''))",
      "end",
      "local function first_string(source, keys)",
      "  for _, key in ipairs(keys) do",
      "    local raw_value = rawget(source, key)",
      "    local text = trim_text(raw_value)",
      "    if text == '' and type(raw_value) == 'number' then text = tostring(raw_value) end",
      "    if text ~= '' then return text end",
      "  end",
      "  return ''",
      "end",
      "local function first_number(source, keys)",
      "  for _, key in ipairs(keys) do",
      "    local value = rawget(source, key)",
      "    if type(value) == 'number' then return value end",
      "    if type(value) == 'string' then",
      "      local parsed = tonumber(value)",
      "      if parsed ~= nil then return parsed end",
      "    end",
      "  end",
      "  return 0",
      "end",
      "local function has_any(source, keys)",
      "  for _, key in ipairs(keys) do",
      "    if rawget(source, key) ~= nil then return true end",
      "  end",
      "  return false",
      "end",
      "local id_keys = { 'legionId', 'legion_id', 'groupId', 'group_id', 'group', 'id', 'legion', 'legionNo', 'legion_no' }",
      "local name_keys = { 'legionName', 'legion_name', 'groupName', 'group_name', 'name', 'title' }",
      "local function likely_legion_info(source, path)",
      "  if has_any(source, { 'avatarId', 'avatarName', 'playerId', 'playerName', 'power', 'prosperity' }) then return false end",
      "  if has_any(source, { 'legionName', 'legion_name', 'groupName', 'group_name' }) and has_any(source, id_keys) then return true end",
      "  local lower = string.lower(tostring(path or ''))",
      "  if lower:find('legion', 1, true) or lower:find('group', 1, true) then",
      "    return has_any(source, id_keys) and has_any(source, name_keys)",
      "  end",
      "  return false",
      "end",
      "local function scalar_preview(source)",
      "  local result = {}",
      "  local count = 0",
      "  for key, value in pairs(source) do",
      "    local value_type = type(value)",
      "    if value_type == 'string' or value_type == 'number' or value_type == 'boolean' then",
      "      count = count + 1",
      "      if count <= 80 then result[tostring(key)] = value end",
      "    end",
      "  end",
      "  result.__scalarCount = count",
      "  return result",
      "end",
      "local payload = { source = 'loaded union/avatar modules', legionGroups = {}, probes = {}, scannedNodes = 0, limited = false, roots = {} }",
      "local seen_groups = {}",
      "local seen_tables = {}",
      "local function has_avatar_fields(source)",
      "  return has_any(source, { 'avatarId', 'avatarName', 'playerId', 'playerName', 'power', 'prosperity', 'weeklyMerit', 'seasonScore' })",
      "end",
      "local function container_suggests_legion(key)",
      "  local lower = string.lower(tostring(key or ''))",
      "  if lower:find('legion', 1, true) then return true end",
      "  if lower:find('group', 1, true) then return true end",
      "  if lower:find('rendata', 1, true) or lower:find('renderdata', 1, true) then return true end",
      "  if lower:find('currender', 1, true) then return true end",
      "  return false",
      "end",
      "local function add_group_fields(source, origin, path)",
      "  if #payload.legionGroups >= 200 then payload.limited = true; return end",
      "  if type(source) ~= 'table' or has_avatar_fields(source) then return end",
      "  local legion_id = first_number(source, { 'legionId', 'legion_id', 'groupId', 'group_id', 'legionNo', 'legion_no' })",
      "  local legion_name = first_string(source, { 'legionName', 'legion_name', 'groupName', 'group_name' })",
      "  if legion_id <= 0 or legion_name == '' then return end",
      "  local lower_name = string.lower(legion_name)",
      "  if lower_name == 'nil' or lower_name == 'null' or lower_name == 'false' or lower_name == 'true' then return end",
      "  local dedupe_key = tostring(legion_id) .. '|' .. legion_name",
      "  if seen_groups[dedupe_key] then return end",
      "  seen_groups[dedupe_key] = true",
      "  payload.legionGroups[#payload.legionGroups + 1] = { legionId = legion_id, legionName = legion_name, origin = origin, path = path, rawScalars = scalar_preview(source) }",
      "end",
      "local function add_group(source, origin, path)",
      "  if not likely_legion_info(source, path) then return end",
      "  local legion_id = first_number(source, id_keys)",
      "  local legion_name = first_string(source, name_keys)",
      "  if legion_id <= 0 or legion_name == '' then return end",
      "  local dedupe_key = tostring(legion_id) .. '|' .. legion_name",
      "  if seen_groups[dedupe_key] then return end",
      "  seen_groups[dedupe_key] = true",
      "  payload.legionGroups[#payload.legionGroups + 1] = { legionId = legion_id, legionName = legion_name, origin = origin, path = path, rawScalars = scalar_preview(source) }",
      "end",
      "local function add_group_list(source, origin, path, key)",
      "  if type(source) ~= 'table' then return end",
      "  if #payload.legionGroups >= 200 then payload.limited = true; return end",
      "  local array, max_index = is_array(source)",
      "  if array and max_index > 0 then",
      "    for index = 1, math.min(max_index, 64) do",
      "      add_group_fields(source[index], origin, path .. '[' .. tostring(index) .. ']')",
      "    end",
      "    return",
      "  end",
      "  for child_key, child in pairs(source) do",
      "    if type(child) == 'table' then add_group_fields(child, origin, path .. '.' .. tostring(child_key)) end",
      "  end",
      "end",
      "local function scan_legion_containers(value, origin, path, depth, parent_key)",
      "  if type(value) ~= 'table' or seen_tables[value] then return end",
      "  if depth > 8 then return end",
      "  seen_tables[value] = true",
      "  if container_suggests_legion(parent_key) and not has_avatar_fields(value) then add_group_list(value, origin, path, parent_key) end",
      "  for child_key, child in pairs(value) do",
      "    if type(child) == 'table' then scan_legion_containers(child, origin, path .. '.' .. tostring(child_key), depth + 1, child_key) end",
      "  end",
      "  seen_tables[value] = nil",
      "end",
      "local scan",
      "scan = function(value, origin, path, depth)",
      "  if type(value) ~= 'table' or seen_tables[value] then return end",
      "  if payload.scannedNodes >= 24000 then payload.limited = true; return end",
      "  payload.scannedNodes = payload.scannedNodes + 1",
      "  seen_tables[value] = true",
      "  add_group(value, origin, path)",
      "  if depth < 8 then",
      "    local child_count = 0",
      "    for key, child in pairs(value) do",
      "      if type(child) == 'table' then",
      "        child_count = child_count + 1",
      "        if child_count <= 420 then scan(child, origin, path .. '.' .. tostring(key), depth + 1) else payload.limited = true end",
      "      end",
      "    end",
      "  end",
      "  seen_tables[value] = nil",
      "end",
      "local scanned_modules = 0",
      "local scanned_functions = 0",
      "local function should_scan_module(name)",
      "  local lower = string.lower(tostring(name or ''))",
      "  if lower == 'proxy.avatarmembers.impunion' then return true end",
      "  if not (lower:find('union', 1, true) or lower:find('legion', 1, true)) then return false end",
      "  if lower:find('ui.customrender', 1, true) or lower:find('ui.control', 1, true) or lower:find('proxy.avatarmembers', 1, true) or lower:find('union.', 1, true) or lower:find('commonproperty', 1, true) or lower:find('helper.', 1, true) then return true end",
      "  return false",
      "end",
      "local function scan_upvalues(module_name, mod)",
      "  if type(debug) ~= 'table' or type(debug.getupvalue) ~= 'function' then payload.debugUpvalueUnavailable = true; return end",
      "  for func_name, func in pairs(mod) do",
      "    if scanned_functions >= 260 then payload.limited = true; return end",
      "    if type(func) == 'function' and type(func_name) == 'string' then",
      "      local lower = string.lower(func_name)",
      "      if lower:find('legion', 1, true) or lower:find('union', 1, true) or lower:find('group', 1, true) then",
      "        scanned_functions = scanned_functions + 1",
      "        for index = 1, 40 do",
      "          local okUp, up_name, up_value = pcall(debug.getupvalue, func, index)",
      "          if not okUp or up_name == nil then break end",
      "          if #payload.probes < 360 then payload.probes[#payload.probes + 1] = { module = module_name, func = func_name, upvalue = tostring(up_name), valueType = type(up_value) } end",
      "          if type(up_value) == 'table' then scan(up_value, 'upvalue:' .. module_name .. ':' .. func_name .. ':' .. tostring(up_name), tostring(up_name), 0) end",
      "        end",
      "      end",
      "    end",
      "  end",
      "end",
      "local function scan_root(module_name, mod)",
      "  if type(mod) ~= 'table' then return end",
      "  if scanned_modules >= 120 then payload.limited = true; return end",
      "  scanned_modules = scanned_modules + 1",
      "  if #payload.roots < 180 then payload.roots[#payload.roots + 1] = module_name end",
      "  scan(mod, 'module:' .. module_name, module_name, 0)",
      "  -- 军团列表专项扫描：模块里存的 legionList / renderData / groupList 等容器，",
      "  -- 其 key 未必是 legion 字样（如 renderData），普通 scan 走路径判据会漏，",
      "  -- 这里按容器 key 名再做一遍结构化提取。",
      "  scan_legion_containers(mod, 'module:' .. module_name, module_name, 0, module_name)",
      "  scan_upvalues(module_name, mod)",
      "end",
      "if package and type(package.loaded) == 'table' then",
      "  local loaded_names = {}",
      "  for loaded_name, mod in pairs(package.loaded) do",
      "    if type(loaded_name) == 'string' and type(mod) == 'table' and should_scan_module(loaded_name) then loaded_names[#loaded_names + 1] = loaded_name end",
      "  end",
      "  table.sort(loaded_names)",
      "  for _, loaded_name in ipairs(loaded_names) do",
      "    scan_root(loaded_name, package.loaded[loaded_name])",
      "    if payload.limited then break end",
      "  end",
      "end",
      "local okRequire, mod = pcall(require, 'Proxy.AvatarMembers.ImpUnion')",
      "payload.requireOk = okRequire",
      "payload.impUnionType = type(mod)",
      "if okRequire and type(mod) == 'table' then scan_root('Proxy.AvatarMembers.ImpUnion', mod) end",
      "payload.scannedModules = scanned_modules",
      "payload.scannedLegionFunctions = scanned_functions",
      "local record = { module = 'Proxy.AvatarMembers.ImpUnion', func = '__dump_alliance_legion_cache__', time = os and os.time and os.time() or 0, returns = encode(payload, 0, {}) }",
      "return '[' .. encode(record, 0, {}) .. ']'"
    ].join("\n");
  }
  if (moduleName === "__dump_alliance_ui_cache__") {
    return [
      "local function json_escape(value)",
      "  return '\"' .. tostring(value):gsub('[%z\\1-\\31\\\\\"]', function(char)",
      "    local byte = string.byte(char)",
      "    if char == '\\\\' then return '\\\\\\\\' end",
      "    if char == '\"' then return '\\\\\"' end",
      "    if char == '\\n' then return '\\\\n' end",
      "    if char == '\\r' then return '\\\\r' end",
      "    if char == '\\t' then return '\\\\t' end",
      "    return string.format('\\\\u%04x', byte)",
      "  end) .. '\"'",
      "end",
      "local function is_array(value)",
      "  local count = 0",
      "  local max_index = 0",
      "  for key in pairs(value) do",
      "    if type(key) ~= 'number' or key < 1 or key % 1 ~= 0 then return false, 0 end",
      "    count = count + 1",
      "    if key > max_index then max_index = key end",
      "  end",
      "  return max_index == count, max_index",
      "end",
      "local encode",
      "encode = function(value)",
      "  local value_type = type(value)",
      "  if value_type == 'nil' then return 'null' end",
      "  if value_type == 'boolean' then return value and 'true' or 'false' end",
      "  if value_type == 'number' then",
      "    if value ~= value or value == math.huge or value == -math.huge then return 'null' end",
      "    return tostring(value)",
      "  end",
      "  if value_type == 'string' then return json_escape(value) end",
      "  if value_type ~= 'table' then return json_escape(tostring(value)) end",
      "  local array, max_index = is_array(value)",
      "  local parts = {}",
      "  if array then",
      "    for index = 1, max_index do parts[#parts + 1] = encode(value[index]) end",
      "    return '[' .. table.concat(parts, ',') .. ']'",
      "  end",
      "  local keys = {}",
      "  for key in pairs(value) do keys[#keys + 1] = key end",
      "  table.sort(keys, function(left, right) return tostring(left) < tostring(right) end)",
      "  for _, key in ipairs(keys) do",
      "    parts[#parts + 1] = json_escape(key) .. ':' .. encode(value[key])",
      "  end",
      "  return '{' .. table.concat(parts, ',') .. '}'",
      "end",
      "local known_profession = { ['司仓'] = true, ['奇佐'] = true, ['神行'] = true, ['天工'] = true, ['青囊'] = true, ['镇军'] = true }",
      "local known_official = { ['普通成员'] = true, ['成员'] = true, ['精英'] = true, ['官员'] = true, ['指挥'] = true, ['副盟主'] = true, ['盟主'] = true, ['校尉'] = true, ['典军校尉'] = true, ['虎英校尉'] = true, ['鹰扬校尉'] = true }",
      "local function trim_text(value)",
      "  if type(value) ~= 'string' then return '' end",
      "  return (value:gsub('^%s+', ''):gsub('%s+$', ''))",
      "end",
      "local function first_string(source, keys)",
      "  for _, key in ipairs(keys) do",
      "    local raw_value = rawget(source, key)",
      "    local text = trim_text(raw_value)",
      "    if text == '' and type(raw_value) == 'number' then text = tostring(raw_value) end",
      "    if text ~= '' then return text end",
      "  end",
      "  return ''",
      "end",
      "local function first_number(source, keys)",
      "  for _, key in ipairs(keys) do",
      "    local value = rawget(source, key)",
      "    if type(value) == 'number' then return value end",
      "    if type(value) == 'string' then",
      "      local parsed = tonumber(value)",
      "      if parsed ~= nil then return parsed end",
      "    end",
      "  end",
      "  return 0",
      "end",
      "local function find_profession(source)",
      "  for _, key in ipairs({ 'professionName', 'profession', 'careerName', 'career', 'occupationName', 'occupation', 'jobName', 'job_name' }) do",
      "    local text = trim_text(rawget(source, key))",
      "    if known_profession[text] then return text end",
      "  end",
      "  for key, value in pairs(source) do",
      "    local text = trim_text(value)",
      "    if known_profession[text] then return text end",
      "  end",
      "  return ''",
      "end",
      "local function profession_role_label(role_id)",
      "  if role_id == 1 then return '司仓' end",
      "  if role_id == 2 then return '镇军' end",
      "  if role_id == 3 then return '奇佐' end",
      "  if role_id == 4 then return '天工' end",
      "  if role_id == 5 then return '青囊' end",
      "  if role_id == 6 then return '神行' end",
      "  if role_id and role_id ~= 0 then return '职业ID ' .. tostring(role_id) end",
      "  return ''",
      "end",
      "local function official_type_label(official_type)",
      "  if official_type == 0 then return '普通成员' end",
      "  if official_type == 12 then return '典军校尉' end",
      "  if official_type == 15 then return '鹰扬校尉' end",
      "  if official_type == 16 then return '虎英校尉' end",
      "  if official_type and official_type ~= 0 then return '职位ID ' .. tostring(official_type) end",
      "  return ''",
      "end",
      "local function find_official(source)",
      "  for _, key in ipairs({ 'officialName', 'official_name', 'official', 'positionName', 'position', 'unionRoleName', 'titleName', 'jobTitle', 'officeName', 'rankName' }) do",
      "    local text = trim_text(rawget(source, key))",
      "    if text ~= '' then return text end",
      "  end",
      "  for key, value in pairs(source) do",
      "    local text = trim_text(value)",
      "    if known_official[text] then return text end",
      "  end",
      "  return ''",
      "end",
      "local function likely_ui_key(key)",
      "  local lower = string.lower(tostring(key or ''))",
      "  return lower:find('union', 1, true) or lower:find('alliance', 1, true) or lower:find('member', 1, true) or lower:find('legion', 1, true) or lower:find('rank', 1, true)",
      "end",
      "local function scalar_preview(source)",
      "  local result = {}",
      "  local count = 0",
      "  for key, value in pairs(source) do",
      "    local value_type = type(value)",
      "    if value_type == 'string' or value_type == 'number' or value_type == 'boolean' then",
      "      count = count + 1",
      "      if count <= 80 then",
      "        local text_key = tostring(key)",
      "        if value_type == 'string' and string.len(value) > 160 then",
      "          result[text_key] = string.sub(value, 1, 160) .. '...[truncated]'",
      "        else",
      "          result[text_key] = value",
      "        end",
      "      end",
      "    end",
      "  end",
      "  result.__scalarCount = count",
      "  return result",
      "end",
      "local group_id_keys = { 'legionId', 'legion_id', 'groupId', 'group_id', 'group', 'id', 'legion', 'legionNo', 'legion_no' }",
      "local group_name_keys = { 'legionName', 'legion_name', 'groupName', 'group_name', 'name', 'title', 'label' }",
      "local function likely_group_info(source, path)",
      "  if rawget(source, 'avatarId') ~= nil or rawget(source, 'avatarName') ~= nil or rawget(source, 'playerId') ~= nil or rawget(source, 'playerName') ~= nil then return false end",
      "  local lower = string.lower(tostring(path or ''))",
      "  if not (lower:find('legion', 1, true) or lower:find('group', 1, true)) then return false end",
      "  return first_number(source, group_id_keys) > 0 and first_string(source, group_name_keys) ~= ''",
      "end",
      "local function has_avatar_fields(source)",
      "  if rawget(source, 'avatarId') ~= nil or rawget(source, 'avatarName') ~= nil then return true end",
      "  if rawget(source, 'playerId') ~= nil or rawget(source, 'playerName') ~= nil then return true end",
      "  if rawget(source, 'power') ~= nil or rawget(source, 'prosperity') ~= nil then return true end",
      "  if rawget(source, 'weeklyMerit') ~= nil or rawget(source, 'seasonScore') ~= nil then return true end",
      "  return false",
      "end",
      "local payload = { source = 'UI.Common.UIMgr.uiClsCache', memberSnapshots = {}, legionGroups = {}, professionTextHits = {}, uiKeys = {}, scannedNodes = 0, limited = false }",
      "local seen_tables = {}",
      "local seen_candidates = {}",
      "local seen_groups = {}",
      "local seen_profession_hits = {}",
      "local function add_profession_hit(source, ui_name, path)",
      "  if #payload.professionTextHits >= 240 then return end",
      "  local profession_name = find_profession(source)",
      "  if profession_name == '' then return end",
      "  local hit_key = ui_name .. '|' .. path .. '|' .. profession_name",
      "  if seen_profession_hits[hit_key] then return end",
      "  seen_profession_hits[hit_key] = true",
      "  payload.professionTextHits[#payload.professionTextHits + 1] = { professionName = profession_name, uiName = ui_name, uiPath = path, rawScalars = scalar_preview(source) }",
      "end",
      "local function add_group_fields(source, ui_name, path)",
      "  if #payload.legionGroups >= 200 then payload.limited = true; return end",
      "  if type(source) ~= 'table' then return end",
      "  if has_avatar_fields(source) then return end",
      "  local legion_id = first_number(source, { 'legionId', 'legion_id', 'groupId', 'group_id', 'legionNo', 'legion_no' })",
      "  local legion_name = first_string(source, { 'legionName', 'legion_name', 'groupName', 'group_name' })",
      "  if legion_id <= 0 then return end",
      "  if legion_name == '' then return end",
      "  local lower_name = string.lower(legion_name)",
      "  if lower_name == 'nil' or lower_name == 'null' or lower_name == 'false' or lower_name == 'true' then return end",
      "  local dedupe_key = tostring(legion_id) .. '|' .. legion_name",
      "  if seen_groups[dedupe_key] then return end",
      "  seen_groups[dedupe_key] = true",
      "  payload.legionGroups[#payload.legionGroups + 1] = { legionId = legion_id, legionName = legion_name, uiName = ui_name, uiPath = path, rawScalars = scalar_preview(source) }",
      "end",
      "local function container_suggests_legion(key)",
      "  local lower = string.lower(tostring(key or ''))",
      "  if lower:find('legion', 1, true) then return true end",
      "  if lower:find('group', 1, true) then return true end",
      "  if lower:find('rendata', 1, true) then return true end",
      "  if lower:find('renderdata', 1, true) then return true end",
      "  if lower:find('currender', 1, true) then return true end",
      "  if lower:find('currenderdata', 1, true) then return true end",
      "  if lower:find('list', 1, true) and lower:find('member', 1, true) == nil then return true end",
      "  if lower:find('data', 1, true) and lower:find('member', 1, true) == nil then return true end",
      "  return false",
      "end",
      "local function add_group_list(source, ui_name, path, key)",
      "  if type(source) ~= 'table' then return end",
      "  if #payload.legionGroups >= 200 then payload.limited = true; return end",
      "  local array, max_index = is_array(source)",
      "  if array and max_index > 0 then",
      "    for index = 1, math.min(max_index, 64) do",
      "      add_group_fields(source[index], ui_name, path .. '[' .. tostring(index) .. ']')",
      "    end",
      "    return",
      "  end",
      "  for child_key, child in pairs(source) do",
      "    if type(child) == 'table' then add_group_fields(child, ui_name, path .. '.' .. tostring(child_key)) end",
      "  end",
      "end",
      "local function scan_legion_containers(value, ui_name, path, depth, parent_key)",
      "  if type(value) ~= 'table' or seen_tables[value] then return end",
      "  if depth > 8 then return end",
      "  seen_tables[value] = true",
      "  if container_suggests_legion(parent_key) and not has_avatar_fields(value) then add_group_list(value, ui_name, path, parent_key) end",
      "  for child_key, child in pairs(value) do",
      "    if type(child) == 'table' then scan_legion_containers(child, ui_name, path .. '.' .. tostring(child_key), depth + 1, child_key) end",
      "  end",
      "  seen_tables[value] = nil",
      "end",
      "local function add_group(source, ui_name, path)",
      "  if #payload.legionGroups >= 200 then payload.limited = true; return end",
      "  if not likely_group_info(source, path) then return end",
      "  local legion_id = first_number(source, group_id_keys)",
      "  local legion_name = first_string(source, group_name_keys)",
      "  if legion_id <= 0 or legion_name == '' then return end",
      "  local dedupe_key = tostring(legion_id) .. '|' .. legion_name",
      "  if seen_groups[dedupe_key] then return end",
      "  seen_groups[dedupe_key] = true",
      "  payload.legionGroups[#payload.legionGroups + 1] = { legionId = legion_id, legionName = legion_name, uiName = ui_name, uiPath = path, rawScalars = scalar_preview(source) }",
      "end",
      "local function add_candidate(source, ui_name, path)",
      "  if #payload.memberSnapshots >= 320 then payload.limited = true; return end",
      "  local avatar_name = first_string(source, { 'avatarName', 'avatar_name', 'memberName', 'member_name', 'playerName', 'player_name', 'nickName', 'nickname', 'name' })",
      "  if avatar_name == '' or known_profession[avatar_name] or known_official[avatar_name] then return end",
      "  local profession_name = find_profession(source)",
      "  if profession_name == '' then profession_name = profession_role_label(first_number(source, { 'roleId', 'role_id', 'role' })) end",
      "  local official_name = find_official(source)",
      "  if official_name == '' then official_name = official_type_label(first_number(source, { 'type', 'officialType', 'positionType' })) end",
      "  local prosperity = first_number(source, { 'power', 'prosperity', 'prosperityValue' })",
      "  local weekly_merit = first_number(source, { 'weeklyMerit', 'weekly_merit', 'merit', 'feat' })",
      "  local weekly_contribution = first_number(source, { 'weeklyContribution', 'weekly_contribution', 'contri', 'contribution' })",
      "  local season_score = first_number(source, { 'seasonScore', 'season_score', 'score' })",
      "  if profession_name == '' and prosperity == 0 and weekly_merit == 0 and weekly_contribution == 0 and season_score == 0 then return end",
      "  local avatar_id = first_string(source, { 'avatarId', 'avatar_id', 'memberId', 'member_id', 'playerId', 'player_id', 'uid' })",
      "  local dedupe_key = avatar_id .. '|' .. avatar_name .. '|' .. profession_name",
      "  if seen_candidates[dedupe_key] then return end",
      "  seen_candidates[dedupe_key] = true",
      "  payload.memberSnapshots[#payload.memberSnapshots + 1] = {",
      "    observedAt = os and os.time and os.time() or 0,",
      "    avatarId = avatar_id,",
      "    avatarName = avatar_name,",
      "    professionName = profession_name,",
      "    professionId = first_number(source, { 'professionId', 'profession_id', 'careerId', 'occupationId', 'jobId', 'roleId', 'role_id', 'role' }),",
      "    officialName = official_name,",
      "    roleId = first_number(source, { 'roleId', 'role_id', 'role' }),",
      "    legionName = first_string(source, { 'legionName', 'legion_name', 'groupName', 'group_name', 'teamName', 'team_name' }),",
      "    legionId = first_number(source, { 'legionId', 'legion_id', 'groupId', 'group_id', 'group' }),",
      "    prosperity = prosperity,",
      "    weeklyMerit = weekly_merit,",
      "    weeklyContribution = weekly_contribution,",
      "    seasonScore = season_score,",
      "    demolitionValue = first_number(source, { 'demolitionValue', 'demolition_value', 'demolition', 'demolish', 'attack' }),",
      "    uiName = ui_name,",
      "    uiPath = path,",
      "    rawScalars = scalar_preview(source)",
      "  }",
      "end",
      "local scan",
      "scan = function(value, ui_name, path, depth)",
      "  if type(value) ~= 'table' or seen_tables[value] then return end",
      "  if payload.scannedNodes >= 20000 then payload.limited = true; return end",
      "  payload.scannedNodes = payload.scannedNodes + 1",
      "  seen_tables[value] = true",
      "  add_profession_hit(value, ui_name, path)",
      "  add_group(value, ui_name, path)",
      "  add_candidate(value, ui_name, path)",
      "  if depth < 7 then",
      "    local child_count = 0",
      "    for key, child in pairs(value) do",
      "      if type(child) == 'table' then",
      "        child_count = child_count + 1",
      "        if child_count <= 360 then scan(child, ui_name, path .. '.' .. tostring(key), depth + 1) else payload.limited = true end",
      "      end",
      "    end",
      "  end",
      "  seen_tables[value] = nil",
      "end",
      "local ui_mgr = package and package.loaded and package.loaded['UI.Common.UIMgr']",
      "if type(ui_mgr) ~= 'table' then",
      "  local ok, loaded = pcall(require, 'UI.Common.UIMgr')",
      "  if ok then ui_mgr = loaded end",
      "end",
      "payload.uiMgrType = type(ui_mgr)",
      "local cache = type(ui_mgr) == 'table' and (rawget(ui_mgr, 'uiClsCache') or rawget(ui_mgr, 'uiCache') or rawget(ui_mgr, 'uiList')) or nil",
      "if type(cache) ~= 'table' and type(ui_mgr) == 'table' and type(rawget(ui_mgr, 'UIMgr')) == 'table' then",
      "  local nested = rawget(ui_mgr, 'UIMgr')",
      "  cache = rawget(nested, 'uiClsCache') or rawget(nested, 'uiCache') or rawget(nested, 'uiList')",
      "end",
      "payload.cacheType = type(cache)",
      "if type(cache) == 'table' then",
      "  local roots = 0",
      "  local likely_roots = {}",
      "  local fallback_roots = {}",
      "  for key, value in pairs(cache) do",
      "    roots = roots + 1",
      "    if #payload.uiKeys < 240 then payload.uiKeys[#payload.uiKeys + 1] = tostring(key) .. ':' .. type(value) end",
      "    if type(value) == 'table' and likely_ui_key(key) then",
      "      likely_roots[#likely_roots + 1] = { key = tostring(key), value = value }",
      "    elseif type(value) == 'table' and #fallback_roots < 24 then",
      "      fallback_roots[#fallback_roots + 1] = { key = tostring(key), value = value }",
      "    end",
      "    if roots >= 180 then payload.limited = true; break end",
      "  end",
      "  table.sort(likely_roots, function(left, right) return left.key < right.key end)",
      "  for _, root in ipairs(likely_roots) do scan(root.value, root.key, root.key, 0) end",
      "  if #payload.memberSnapshots == 0 then",
      "    for _, root in ipairs(fallback_roots) do scan(root.value, root.key, root.key, 0) end",
      "  end",
      "  payload.uiLikelyRootCount = #likely_roots",
      "  payload.uiRootCount = roots",
      "  -- 军团列表专项扫描：军团名只存在于「军团列表节点」被打开后的 render/data 数组里",
      "  -- （历史实测：UnionScheduleWndUI.legionList.N.renderData 给到完整 10 组；",
      "  --  UnionMemberUI.ui.legionScrollListCList.curShowRender.* 给到 8 组）。",
      "  -- 该节点的 key 未必含 legion/group 字样，故不走 likely_ui_key 白名单，",
      "  -- 而是对全部 root 做 key 命名的容器扫描，命中 legion/group/renderData/list",
      "  -- 这类容器名即按「军团条目」解析（排除含 avatar*/power 的成员对象）。",
      "  if #likely_roots > 0 or #fallback_roots > 0 then",
      "    local scanned_roots = 0",
      "    for _, root in ipairs(likely_roots) do",
      "      scanned_roots = scanned_roots + 1",
      "      scan_legion_containers(root.value, root.key, root.key, 0, root.key)",
      "      if scanned_roots >= 60 then payload.limited = true; break end",
      "    end",
      "    for _, root in ipairs(fallback_roots) do",
      "      scanned_roots = scanned_roots + 1",
      "      scan_legion_containers(root.value, root.key, root.key, 0, root.key)",
      "      if scanned_roots >= 60 then payload.limited = true; break end",
      "    end",
      "  end",
      "end",
      "local record = { module = 'UI.Common.UIMgr', func = '__dump_alliance_ui_cache__', time = os and os.time and os.time() or 0, returns = encode(payload) }",
      "return '[' .. encode(record) .. ']'"
    ].join("\n");
  }
  if (moduleName === "__dump_rpc_captures__") {
    return [
      "local captures = _G.__codex_rpc_captures or {}",
      "local function json_escape(value)",
      "  return '\"' .. tostring(value):gsub('[%z\\1-\\31\\\\\"]', function(char)",
      "    local byte = string.byte(char)",
      "    if char == '\\\\' then return '\\\\\\\\' end",
      "    if char == '\"' then return '\\\\\"' end",
      "    if char == '\\n' then return '\\\\n' end",
      "    if char == '\\r' then return '\\\\r' end",
      "    if char == '\\t' then return '\\\\t' end",
      "    return string.format('\\\\u%04x', byte)",
      "  end) .. '\"'",
      "end",
      "local parts = {}",
      "local startIndex = math.max(1, #captures - 499)",
      "for index = startIndex, #captures do",
      "  local item = captures[index]",
      "  parts[#parts + 1] = '{\"module\":' .. json_escape(item.module) .. ',\"func\":' .. json_escape(item.func) .. ',\"time\":' .. tostring(item.time or 0) .. ',\"args\":' .. json_escape(item.args or '') .. ',\"returns\":' .. json_escape(item.returns or '') .. '}'",
      "end",
      "return '[' .. table.concat(parts, ',') .. ']'"
    ].join("\n");
  }
  if (moduleName.indexOf("__call_module_method__:") === 0) {
    const spec = moduleName.slice("__call_module_method__:".length);
    const parts = spec.split("|");
    const targetModule = luaStringLiteral(parts[0] || "");
    const targetMethod = luaStringLiteral(parts[1] || "");
    const callMode = luaStringLiteral(parts[2] || "");
    return [
      "local moduleName = " + targetModule,
      "local methodName = " + targetMethod,
      "local callMode = " + callMode,
      "if moduleName == '' or methodName == '' then return 'CALL_MODULE_ERROR invalid spec' end",
      "local moduleValue = package and package.loaded and package.loaded[moduleName]",
      "if type(moduleValue) ~= 'table' then",
      "  local okRequire, loaded = pcall(require, moduleName)",
      "  if not okRequire then return 'CALL_MODULE_ERROR require ' .. moduleName .. ': ' .. tostring(loaded) end",
      "  moduleValue = loaded",
      "end",
      "if type(moduleValue) ~= 'table' then return 'CALL_MODULE_ERROR non-table module: ' .. moduleName .. ' type=' .. type(moduleValue) end",
      "local func = rawget(moduleValue, methodName) or moduleValue[methodName]",
      "if type(func) ~= 'function' then return 'CALL_MODULE_ERROR missing method: ' .. moduleName .. '.' .. methodName end",
      "local okCall, result",
      "if callMode == 'self' then",
      "  okCall, result = pcall(func, moduleValue)",
      "else",
      "  okCall, result = pcall(func)",
      "end",
      "return 'CALL_MODULE ' .. moduleName .. '.' .. methodName .. ' ok=' .. tostring(okCall) .. ' result=' .. tostring(result)"
    ].join("\n");
  }
  if (moduleName.indexOf("__call_avatar_method__:") === 0) {
    const methodName = luaStringLiteral(moduleName.slice("__call_avatar_method__:".length));
    return [
      "local methodName = " + methodName,
      "local avatarModule = package and package.loaded and package.loaded['Proxy.Avatar']",
      "local avatar = avatarModule and avatarModule.Avatar",
      "if type(avatar) ~= 'table' then return 'CALL_AVATAR_ERROR no Proxy.Avatar.Avatar' end",
      "local func = avatar[methodName]",
      "if type(func) ~= 'function' and type(avatar.__components__) == 'table' then",
      "  for _, component in pairs(avatar.__components__) do",
      "    if type(component) == 'table' and type(component[methodName]) == 'function' then",
      "      func = component[methodName]",
      "      break",
      "    end",
      "  end",
      "end",
      "if type(func) ~= 'function' then return 'CALL_AVATAR_ERROR missing method: ' .. methodName end",
      "local ok, result = pcall(func, avatar)",
      "return 'CALL_AVATAR ' .. methodName .. ' ok=' .. tostring(ok) .. ' result=' .. tostring(result)"
    ].join("\n");
  }
  const quotedModule = luaStringLiteral(moduleName);
  return [
    "local moduleName = " + quotedModule,
    "local ok, moduleValue = pcall(require, moduleName)",
    "if not ok then return 'ERROR require ' .. moduleName .. ': ' .. tostring(moduleValue) end",
    "local okJson, rapidjson = pcall(require, 'rapidjson')",
    "if not okJson then return 'ERROR rapidjson: ' .. tostring(rapidjson) end",
    "local okEncode, text = pcall(rapidjson.encode, moduleValue)",
    "if not okEncode then return 'ERROR encode ' .. moduleName .. ': ' .. tostring(text) end",
    "return text"
  ].join("\n");
}

function ensureLuaProbeCallback(api) {
  if (luaProbeCallback !== null) return luaProbeCallback;
  luaProbeCallback = new NativeCallback(function(callbackL) {
    const moduleName = currentLuaProbeModule || "<unknown>";
    let baseTop = null;
    let stage = "callback-gettop";
    try {
      send({ type: "lua-probe-stage", moduleName, stage, L: callbackL.toString() });
      baseTop = api.gettop(callbackL);

      stage = "callback-loadstring";
      const chunk = buildModuleDumpChunk(moduleName);
      const source = Memory.allocUtf8String(chunk);
      send({ type: "lua-probe-stage", moduleName, stage, baseTop, sourceLength: chunk.length });
      const loadStatus = api.loadstring(callbackL, source);
      if (loadStatus !== 0) {
        send({ type: "lua-probe-error", moduleName, stage, status: loadStatus });
        dumpLuaStack("lua_probe_" + sanitize(moduleName) + "_callback_load_error", callbackL, "leave");
        if (baseTop !== null) api.settop(callbackL, baseTop);
        return 0;
      }

      stage = "callback-call";
      send({ type: "lua-probe-stage", moduleName, stage });
      api.call(callbackL, 0, 1);

      stage = "callback-dump";
      send({ type: "lua-probe", moduleName, status: 0 });
      dumpLuaStack("lua_probe_" + sanitize(moduleName) + "_status0", callbackL, "leave");

      stage = "callback-settop";
      if (baseTop !== null) api.settop(callbackL, baseTop);
      send({ type: "lua-probe-stage", moduleName, stage, baseTop });
      return 0;
    } catch (error) {
      send({
        type: "error",
        where: "luaProbeCallback",
        moduleName,
        stage,
        baseTop,
        message: String(error)
      });
      if (baseTop !== null) {
        try {
          api.settop(callbackL, baseTop);
        } catch (restoreError) {
          send({
            type: "error",
            where: "luaProbeCallback.restoreStack",
            moduleName,
            baseTop,
            message: String(restoreError)
          });
        }
      }
      return 0;
    }
  }, "int", ["pointer"]);
  return luaProbeCallback;
}

function runLuaProbe(L, trigger) {
  if (luaProbeDone || luaProbeRunning || config.luaProbeModules.length === 0) return;
  const api = ensureLuaProbeApi();
  if (api === false) return;
  const callback = ensureLuaProbeCallback(api);
  luaProbeDone = true;
  luaProbeRunning = true;
  send({
    type: "lua-probe-start",
    trigger,
    L: L.toString(),
    modules: config.luaProbeModules
  });
  try {
    for (const moduleName of config.luaProbeModules) {
      let topBefore = null;
      let stage = "gettop";
      try {
        send({ type: "lua-probe-stage", moduleName, stage, L: L.toString() });
        topBefore = api.gettop(L);

        stage = "cpcall";
        currentLuaProbeModule = moduleName;
        send({ type: "lua-probe-stage", moduleName, stage, topBefore });
        const callStatus = api.cpcall(L, callback, ptr(0));
        currentLuaProbeModule = null;
        send({ type: "lua-probe-cpcall", moduleName, status: callStatus });
        if (callStatus !== 0) {
          dumpLuaStack("lua_probe_" + sanitize(moduleName) + "_cpcall_error" + callStatus, L, "leave");
        }

        stage = "settop";
        api.settop(L, topBefore);
        send({ type: "lua-probe-stage", moduleName, stage, topBefore });
      } catch (error) {
        currentLuaProbeModule = null;
        send({
          type: "error",
          where: "runLuaProbe",
          moduleName,
          stage,
          topBefore,
          message: String(error)
        });
        if (topBefore !== null) {
          try {
            api.settop(L, topBefore);
          } catch (restoreError) {
            send({
              type: "error",
              where: "runLuaProbe.restoreStack",
              moduleName,
              topBefore,
              message: String(restoreError)
            });
          }
        }
      }
    }
  } catch (error) {
    send({ type: "error", where: "runLuaProbe", message: String(error) });
  } finally {
    luaProbeRunning = false;
  }
}

function readSize(ptrValue) {
  if (Process.pointerSize === 8) return ptrValue.readU64().toNumber();
  return ptrValue.readU32();
}

function dumpLuaStack(label, L, when) {
  const api = ensureLuaApi();
  if (api === false) return;
  try {
    const top = api.gettop(L);
    send({ type: "lua-stack", label, when, top });
    for (let index = 1; index <= top; index++) {
      const valueType = api.type(L, index);
      let typeName = "";
      try {
        typeName = readUtf8(api.typename(L, valueType));
      } catch (_) {}
      if (valueType !== 4) {
        send({ type: "lua-value", label, when, index, valueType, typeName });
        continue;
      }
      const lenPtr = Memory.alloc(Process.pointerSize);
      const strPtr = api.tolstring(L, index, lenPtr);
      if (strPtr.isNull()) {
        send({ type: "lua-value", label, when, index, valueType, typeName, length: 0 });
        continue;
      }
      const length = readSize(lenPtr);
      const cappedLength = Math.min(length, config.maxLuaStringBytes);
      send({
        type: "dump",
        kind: "lua-string",
        label: sanitize(label + "_" + when + "_stack" + index + "_" + typeName),
        address: strPtr.toString(),
        start: strPtr.toString(),
        length: cappedLength,
        originalLength: length,
        when,
        stackIndex: index,
        valueType,
        typeName
      }, strPtr.readByteArray(cappedLength));
    }
  } catch (error) {
    send({ type: "error", where: "dumpLuaStack", label, when, message: String(error) });
  }
}

function dumpWindow(kind, label, address, matchedSize) {
  try {
    const range = Process.findRangeByAddress(address);
    if (range === null) return;

    let start = address.sub(config.windowBefore);
    if (start.compare(range.base) < 0) start = range.base;

    let length = config.windowBytes;
    const rangeEnd = range.base.add(range.size);
    if (start.add(length).compare(rangeEnd) > 0) {
      length = rangeEnd.sub(start).toInt32();
    }
    if (length <= 0) return;

    const key = kind + ":" + label + ":" + start.toString() + ":" + length;
    if (seenDumps.has(key)) return;
    seenDumps.add(key);

    send({
      type: "dump",
      kind,
      label: sanitize(label),
      address: address.toString(),
      start: start.toString(),
      length,
      matchedSize
    }, start.readByteArray(length));
  } catch (error) {
    send({ type: "error", where: "dumpWindow", label, message: String(error) });
  }
}

function enumerateReadableRanges() {
  const protections = ["r--", "rw-", "r-x", "rwx"];
  const seen = new Set();
  const ranges = [];
  for (const protection of protections) {
    try {
      for (const range of Process.enumerateRanges({ protection, coalesce: true })) {
        const key = range.base.toString() + ":" + range.size;
        if (!seen.has(key)) {
          seen.add(key);
          ranges.push(range);
        }
      }
    } catch (_) {
      continue;
    }
  }
  return ranges;
}

function scanPattern(pattern, ranges) {
  let hitCount = 0;
  for (const range of ranges) {
    if (range.size < pattern.minRangeBytes) continue;
    try {
      const matches = Memory.scanSync(range.base, range.size, pattern.hex);
      for (const match of matches) {
        hitCount++;
        dumpWindow("scan", pattern.name, match.address, match.size);
        if (hitCount >= config.maxHitsPerPattern) {
          send({ type: "scan-pattern", name: pattern.name, hitCount, capped: true });
          return hitCount;
        }
      }
    } catch (error) {
      send({ type: "error", where: "scanPattern", label: pattern.name, message: String(error) });
    }
  }
  send({ type: "scan-pattern", name: pattern.name, hitCount, capped: false });
  return hitCount;
}

function findSymbol(name) {
  try {
    const direct = Module.findExportByName(null, name);
    if (direct !== null) return direct;
  } catch (_) {}
  try {
    const matches = DebugSymbol.findFunctionsNamed(name);
    if (matches.length > 0) return matches[0];
  } catch (_) {}
  return null;
}

function findModuleBase(name) {
  const lowerName = String(name).toLowerCase();
  for (const moduleInfo of Process.enumerateModules()) {
    if (String(moduleInfo.name).toLowerCase() === lowerName) {
      return moduleInfo.base;
    }
  }
  return null;
}

function hookLoadbuffer(name, address) {
  send({ type: "hook", name, address: address.toString() });
  Interceptor.attach(address, {
    onEnter(args) {
      try {
        const buffer = args[1];
        let length = 0;
        if (Process.pointerSize === 8) {
          length = args[2].toUInt32();
        } else {
          length = args[2].toInt32();
        }
        if (length <= 0 || length > config.maxHookBytes) return;

        const chunkName = readUtf8(args[3]);
        let backtrace = [];
        try {
          backtrace = Thread.backtrace(this.context, Backtracer.ACCURATE)
            .slice(0, 16)
            .map(address => DebugSymbol.fromAddress(address).toString());
        } catch (_) {}
        send({
          type: "dump",
          kind: "hook",
          label: sanitize(name + "_" + chunkName),
          address: buffer.toString(),
          start: buffer.toString(),
          length,
          chunkName,
          backtrace
        }, buffer.readByteArray(length));
      } catch (error) {
        send({ type: "error", where: "hookLoadbuffer", label: name, message: String(error) });
      }
    }
  });
}

function hookLuaCFunction(hookSpec) {
  try {
    const moduleBase = findModuleBase(hookSpec.module);
    if (moduleBase === null) {
      send({ type: "missing-module", name: hookSpec.module, hook: hookSpec.name });
      return;
    }
    const address = moduleBase.add(hookSpec.rva);
    send({
      type: "native-hook",
      name: hookSpec.name,
      module: hookSpec.module,
      rva: "0x" + hookSpec.rva.toString(16),
      address: address.toString()
    });
    Interceptor.attach(address, {
      onEnter(args) {
        this.L = args[0];
        dumpLuaStack(hookSpec.name, this.L, "enter");
      },
      onLeave(retval) {
        dumpLuaStack(hookSpec.name + "_ret" + retval.toInt32(), this.L, "leave");
      }
    });
  } catch (error) {
    send({ type: "error", where: "hookLuaCFunction", hook: hookSpec.name, message: String(error) });
  }
}

function hookLuaProbeTrigger() {
  if (config.luaProbeModules.length === 0) return;
  const address = findSymbol("lua_pcall");
  if (address === null) {
    send({ type: "missing-symbol", name: "lua_pcall", hook: "lua-probe" });
    return;
  }
  send({ type: "hook", name: "lua_pcall_probe", address: address.toString() });
  Interceptor.attach(address, {
    onEnter(args) {
      this.L = args[0];
      if (!luaProbeDone && !luaProbeRunning) {
        runLuaProbe(this.L, "lua_pcall.onEnter");
      }
    },
    onLeave(_) {
    }
  });
}

send({
  type: "modules",
  modules: Process.enumerateModules().map(m => ({
    name: m.name,
    base: m.base.toString(),
    size: m.size,
    path: m.path
  }))
});

for (const symbol of config.symbols) {
  const address = findSymbol(symbol);
  if (address !== null) {
    hookLoadbuffer(symbol, address);
  } else {
    send({ type: "missing-symbol", name: symbol });
  }
}

for (const hookSpec of config.nativeHooks) {
  hookLuaCFunction(hookSpec);
}

hookLuaProbeTrigger();

send({ type: "hooks-ready" });

if (config.scan) {
  const ranges = enumerateReadableRanges();
  send({ type: "ranges", count: ranges.length, totalBytes: ranges.reduce((sum, r) => sum + r.size, 0) });

  let totalHits = 0;
  for (const pattern of config.patterns) {
    totalHits += scanPattern(pattern, ranges);
  }

  send({ type: "scan-complete", totalHits, dumpCount: seenDumps.size });
} else {
  send({ type: "scan-skipped" });
}
"""


@dataclass(frozen=True)
class AttachTarget:
    value: int | str
    label: str


def to_hex_pattern(value: bytes) -> str:
    return " ".join(f"{byte:02x}" for byte in value)


def utf16le_ascii(value: bytes) -> bytes:
    return value.decode("ascii").encode("utf-16le")


def build_patterns(target_only: bool) -> list[dict[str, object]]:
    target_literals = {
        "raw_heros_first16": bytes.fromhex("f7f32ed9b39c3d99582fa98b51e35d2e"),
        "raw_skills_first16": bytes.fromhex("c57892e1042a7dd97aa93bb73357427a"),
        "raw_warbook_first16": bytes.fromhex("162f8597ee60110d612eb2d3f76e75c2"),
        "full_path_heros": b"Assets/Bundles/LuaScripts/Data/heros.bytes",
        "full_path_skills": b"Assets/Bundles/LuaScripts/Data/skill/skills.bytes",
        "full_path_warbook": b"Assets/Bundles/LuaScripts/Data/warbook.bytes",
        "path_heros": b"Data/heros.bytes",
        "path_skills": b"Data/skill/skills.bytes",
        "path_warbook": b"Data/warbook.bytes",
        "full_path_heros_wide": utf16le_ascii(b"Assets/Bundles/LuaScripts/Data/heros.bytes"),
        "full_path_skills_wide": utf16le_ascii(b"Assets/Bundles/LuaScripts/Data/skill/skills.bytes"),
        "full_path_warbook_wide": utf16le_ascii(b"Assets/Bundles/LuaScripts/Data/warbook.bytes"),
        "path_heros_wide": utf16le_ascii(b"Data/heros.bytes"),
        "path_skills_wide": utf16le_ascii(b"Data/skill/skills.bytes"),
        "path_warbook_wide": utf16le_ascii(b"Data/warbook.bytes"),
        "full_path_formation": b"Assets/Bundles/LuaScripts/Data/formation.bytes",
        "path_formation": b"Data/formation.bytes",
        "full_path_formation_wide": utf16le_ascii(b"Assets/Bundles/LuaScripts/Data/formation.bytes"),
        "path_formation_wide": utf16le_ascii(b"Data/formation.bytes"),
        "full_path_bond_config": b"Assets/Bundles/LuaScripts/Data/bond_config.bytes",
        "path_bond_config": b"Data/bond_config.bytes",
        "full_path_bond_config_wide": utf16le_ascii(b"Assets/Bundles/LuaScripts/Data/bond_config.bytes"),
        "path_bond_config_wide": utf16le_ascii(b"Data/bond_config.bytes"),
        "full_path_fate": b"Assets/Bundles/LuaScripts/Data/fate.bytes",
        "path_fate": b"Data/fate.bytes",
        "full_path_fate_wide": utf16le_ascii(b"Assets/Bundles/LuaScripts/Data/fate.bytes"),
        "path_fate_wide": utf16le_ascii(b"Data/fate.bytes"),
        "module_formation": b"Data.formation",
        "module_bond_config": b"Data.bond_config",
        "module_fate": b"Data.fate",
        "module_scenario17_equipment": b"Data.Scenario17.equipment",
        "module_scenario17_item": b"Data.Scenario17.item",
        "module_scenario17_season_process": b"Data.Scenario17.season_process",
        "module_scenario_season_manage": b"Data.scenario_season_manage",
        "module_season_introduce": b"Data.season_introduce",
        "module_formation_wide": utf16le_ascii(b"Data.formation"),
        "module_bond_config_wide": utf16le_ascii(b"Data.bond_config"),
        "module_fate_wide": utf16le_ascii(b"Data.fate"),
        "module_scenario17_equipment_wide": utf16le_ascii(b"Data.Scenario17.equipment"),
        "module_scenario17_item_wide": utf16le_ascii(b"Data.Scenario17.item"),
        "module_scenario17_season_process_wide": utf16le_ascii(b"Data.Scenario17.season_process"),
        "module_scenario_season_manage_wide": utf16le_ascii(b"Data.scenario_season_manage"),
        "module_season_introduce_wide": utf16le_ascii(b"Data.season_introduce"),
        "client_crypt": b"client_crypt",
        "luaopen_client_crypt": b"luaopen_client_crypt",
        "xlua_loadbuffer": b"xluaL_loadbuffer",
        "utf8_liubei": bytes.fromhex("e58898e5a487"),
        "utf8_guanyu": bytes.fromhex("e585b3e7bebd"),
        "utf8_zhugeliang": bytes.fromhex("e8afb8e8919be4baae"),
        "utf8_zhanfa": bytes.fromhex("e68898e6b395"),
        "utf8_taolue": bytes.fromhex("e99face795a5"),
        "utf16le_liubei": bytes.fromhex("18520759"),
        "utf16le_guanyu": bytes.fromhex("7351bd7f"),
        "utf16le_zhugeliang": bytes.fromhex("f88b5b84ae4e"),
        "utf16le_zhanfa": bytes.fromhex("1862d56c"),
        "utf16le_taolue": bytes.fromhex("ec976575"),
        "gbk_liubei": bytes.fromhex("c1f5b1b8"),
        "gbk_guanyu": bytes.fromhex("b9d8d3f0"),
        "gbk_zhugeliang": bytes.fromhex("d6eeb8f0c1c1"),
        "gbk_zhanfa": bytes.fromhex("d5bdb7a8"),
        "gbk_taolue": bytes.fromhex("e8bac2d4"),
    }
    extra_literals = {
        "name_heros": b"heros",
        "name_skills": b"skills",
        "name_warbook": b"warbook",
        "source_blob": b"LuaSourceBlob",
        "lua_return": b"return ",
        "lua_local": b"local ",
    }
    literals = target_literals if target_only else {**target_literals, **extra_literals}
    return [
        {"name": name, "hex": to_hex_pattern(value), "minRangeBytes": 4096}
        for name, value in literals.items()
    ]


def choose_target(device: frida.core.Device, process_arg: str | None) -> AttachTarget:
    if process_arg and process_arg.isdigit():
        return AttachTarget(int(process_arg), f"pid={process_arg}")

    processes = device.enumerate_processes()
    if process_arg:
        lowered = process_arg.lower()
        for process in processes:
            if process.name.lower() == lowered:
                return AttachTarget(process.pid, f"{process.name} pid={process.pid}")
        raise RuntimeError(f"process not found in Frida list: {process_arg}")

    candidates = [
        process
        for process in processes
        if any(hint in process.name.lower() for hint in PROCESS_HINTS)
    ]
    if not candidates:
        names = ", ".join(f"{p.name}:{p.pid}" for p in processes[:30])
        raise RuntimeError(f"NSLG process not found in Frida list. First processes: {names}")
    process = candidates[0]
    return AttachTarget(process.pid, f"{process.name} pid={process.pid}")


def make_output_path(out_dir: Path, meta: dict[str, object], index: int) -> Path:
    label = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(meta.get("label", "dump")))[:100]
    kind = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(meta.get("kind", "hit")))[:40]
    return out_dir / f"{index:05d}_{kind}_{label}.bin"


def write_event(events_path: Path, payload: object) -> None:
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _atomic_write_json(path: Path, obj: object, indent: int = 2) -> None:
    """P2-5 修复：临时文件 + os.replace 原子落盘，避免写入中途崩溃留下半截 JSON。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=indent), encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def main() -> int:
    # P0-3 修复：Windows 中文环境下 Python 子进程 stdout/stderr 默认编码是 cp936，
    # 而父进程（runtime_probe）以 utf-8 读取。若此处 print 含中文的 JSON（如
    # on_message 里的 payload dump），会按 cp936 编码写出字节 → 父进程 utf-8 解码
    # 乱码；个别字符超出 cp936 还会触发 UnicodeEncodeError 非 0 退出，被误报为
    # "runtime scan command failed"。统一把本进程的 stdio 改成 utf-8（与父进程
    # 注入的 PYTHONIOENCODING=utf-8 双保险）。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--process",
        help="Process name or PID. Defaults to first NSLG-looking Frida process.",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument("--window-before", type=int, default=4096)
    parser.add_argument("--window-bytes", type=int, default=16384)
    parser.add_argument("--max-hook-bytes", type=int, default=8 * 1024 * 1024)
    parser.add_argument("--max-lua-string-bytes", type=int, default=8 * 1024 * 1024)
    parser.add_argument("--max-hits-per-pattern", type=int, default=24)
    parser.add_argument("--target-only", action="store_true")
    parser.add_argument("--no-scan", action="store_true")
    parser.add_argument("--no-loadbuffer-hooks", action="store_true")
    parser.add_argument("--crypt-hooks", action="store_true")
    parser.add_argument(
        "--probe-data-modules",
        action="store_true",
        help=(
            "JSON-dump loaded core Data.* tables from a live Lua state, including heroes, "
            "skills, warbook, formation, fate, and current scenario config tables."
        ),
    )
    parser.add_argument(
        "--lua-probe-module",
        action="append",
        default=[],
        help="Additional Lua module to require and JSON-dump from a live Lua state.",
    )
    parser.add_argument(
        "--exit-after-lua-probes",
        action="store_true",
        help="Detach as soon as every requested Lua probe has produced a result.",
    )
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    events_path = args.out / "events.jsonl"
    write_event(events_path, {"type": "run-start", "argv": sys.argv})

    device = frida.get_local_device()
    target = choose_target(device, args.process)
    print(f"Attaching to {target.label}")

    session = device.attach(target.value)
    dump_index = 0
    dump_bytes_total = 0
    message_type_counts: dict[str, int] = {}
    payload_type_counts: dict[str, int] = {}
    missing_symbols: list[str] = []
    missing_modules: list[str] = []
    module_samples: list[dict[str, object]] = []
    scan_complete_payload: dict[str, object] = {}
    lua_probe_done = threading.Event()
    completed_lua_probe_modules: set[str] = set()
    lua_probe_modules = list(args.lua_probe_module)
    if args.probe_data_modules:
        lua_probe_modules.extend(
            [
                "__json_loaded__:Data.heros",
                "__json_loaded__:Data.skill.skills",
                "__json_loaded__:Data.warbook",
                "__json_loaded__:Data.formation",
                "__json_loaded__:Data.bond_config",
                "__json_loaded__:Data.fate",
                "__json_loaded__:Data.Scenario17.equipment",
                "__json_loaded__:Data.Scenario17.item",
                "__json_loaded__:Data.Scenario17.season_process",
                "__json_loaded__:Data.Scenario17.skill.super_skill",
                "__json_loaded__:Data.scenario_season_manage",
                "__json_loaded__:Data.season_introduce",
            ]
        )
    config = {
        "patterns": build_patterns(args.target_only),
        "scan": not args.no_scan,
        "symbols": []
        if args.no_loadbuffer_hooks
        else ["xluaL_loadbuffer", "luaL_loadbuffer", "luaL_loadbufferx"],
        "nativeHooks": [
            {"name": "client_crypt_hashkey", "module": "xlua.dll", "rva": 0x54C90},
            {"name": "client_crypt_randomkey", "module": "xlua.dll", "rva": 0x54910},
            {"name": "client_crypt_desencode", "module": "xlua.dll", "rva": 0x549A0},
            {"name": "client_crypt_desdecode", "module": "xlua.dll", "rva": 0x54AF0},
            {"name": "client_crypt_hexencode", "module": "xlua.dll", "rva": 0x54D10},
            {"name": "client_crypt_hexdecode", "module": "xlua.dll", "rva": 0x54E10},
            {"name": "client_crypt_hmac64", "module": "xlua.dll", "rva": 0x54F60},
            {"name": "client_crypt_hmac64_md5", "module": "xlua.dll", "rva": 0x54FB0},
            {"name": "client_crypt_dhexchange", "module": "xlua.dll", "rva": 0x55080},
            {"name": "client_crypt_dhsecret", "module": "xlua.dll", "rva": 0x55000},
            {"name": "client_crypt_base64encode", "module": "xlua.dll", "rva": 0x55160},
            {"name": "client_crypt_base64decode", "module": "xlua.dll", "rva": 0x55350},
        ]
        if args.crypt_hooks
        else [],
        "windowBefore": args.window_before,
        "windowBytes": args.window_bytes,
        "maxHookBytes": args.max_hook_bytes,
        "maxLuaStringBytes": args.max_lua_string_bytes,
        "maxHitsPerPattern": args.max_hits_per_pattern,
        "luaProbeModules": lua_probe_modules,
    }
    script_source = FRIDA_JS.replace("CONFIG_JSON", json.dumps(config), 1)
    script = session.create_script(script_source)

    def on_message(message: dict[str, object], data: bytes | None) -> None:
        nonlocal dump_index, dump_bytes_total
        message_type = message.get("type")
        if isinstance(message_type, str):
            message_type_counts[message_type] = message_type_counts.get(message_type, 0) + 1
        payload = message.get("payload")
        write_event(events_path, payload if payload is not None else message)
        if not isinstance(payload, dict):
            print(message)
            return

        payload_type = payload.get("type")
        if isinstance(payload_type, str):
            payload_type_counts[payload_type] = payload_type_counts.get(payload_type, 0) + 1
        if payload_type == "modules" and isinstance(payload.get("modules"), list):
            module_samples[:] = [
                module
                for module in payload["modules"]
                if isinstance(module, dict)
            ][:50]
        elif (
            args.exit_after_lua_probes
            and lua_probe_modules
            and payload_type == "lua-probe-cpcall"
            and payload.get("status") == 0
            and isinstance(payload.get("moduleName"), str)
        ):
            completed_lua_probe_modules.add(str(payload["moduleName"]))
            if set(lua_probe_modules).issubset(completed_lua_probe_modules):
                lua_probe_done.set()
        elif payload_type == "scan-complete":
            scan_complete_payload.clear()
            scan_complete_payload.update(payload)
        elif payload_type == "missing-symbol" and isinstance(payload.get("name"), str):
            missing_symbols.append(payload["name"])
        elif payload_type == "missing-module" and isinstance(payload.get("name"), str):
            missing_modules.append(payload["name"])

        if payload_type == "dump" and data is not None:
            dump_index += 1
            dump_bytes_total += len(data)
            path = make_output_path(args.out, payload, dump_index)
            path.write_bytes(data)
            print(
                f"dump {dump_index}: {payload.get('kind')} "
                f"{payload.get('label')} {len(data)} bytes -> {path}"
            )
        else:
            print(json.dumps(payload, ensure_ascii=False))

    script.on("message", on_message)
    try:
        try:
            script.load()
            if args.exit_after_lua_probes and lua_probe_modules:
                lua_probe_done.wait(timeout=max(args.seconds, 0.0))
            else:
                time.sleep(args.seconds)
        finally:
            # 始终 detach，释放 frida 会话（被超时强杀时进程退出前也尽量清理）。
            try:
                session.detach()
            except Exception:  # noqa: BLE001
                pass
    except Exception:
        write_event(events_path, {"type": "error", "stage": "scan", "error": str(sys.exc_info()[1])})
        raise
    finally:
        # P2-5 修复：summary.json 移到 finally，确保被 kill/异常时诊断信息不丢；
        # 用临时文件 + os.replace 原子落盘，避免崩溃留下半截 JSON。
        summary = {
            "target": {
                "label": target.label,
                "value": target.value,
            },
            "requestedProcess": args.process,
            "outDir": str(args.out),
            "seconds": args.seconds,
            "options": {
                "windowBefore": args.window_before,
                "windowBytes": args.window_bytes,
                "maxHookBytes": args.max_hook_bytes,
                "maxLuaStringBytes": args.max_lua_string_bytes,
                "maxHitsPerPattern": args.max_hits_per_pattern,
                "targetOnly": args.target_only,
                "scan": not args.no_scan,
                "noLoadbufferHooks": args.no_loadbuffer_hooks,
                "cryptHooks": args.crypt_hooks,
                "probeDataModules": args.probe_data_modules,
                "luaProbeModules": lua_probe_modules,
                "exitAfterLuaProbes": args.exit_after_lua_probes,
            },
            "counts": {
                "messageTypes": message_type_counts,
                "payloadTypes": payload_type_counts,
                "dumpCount": dump_index,
                "dumpBytes": dump_bytes_total,
                "moduleSamples": len(module_samples),
                "missingSymbols": len(missing_symbols),
                "missingModules": len(missing_modules),
            },
            "missingSymbols": missing_symbols,
            "missingModules": missing_modules,
            "moduleSamples": module_samples,
            "scanComplete": scan_complete_payload or None,
        }
        _atomic_write_json(args.out / "summary.json", summary)

    print(f"Finished. Wrote {dump_index} dumps to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
