"use strict";

const LUA_PAYLOAD = __LUA_PAYLOAD__;
const MAX_INSTALL_ATTEMPTS = 400;

let api = null;
let hookInstalled = false;
let payloadInstalled = false;
let installAttempts = 0;
let injecting = false;
let lastLuaState = ptr(0);

function emit(type, fields) {
  send(Object.assign({ type: type }, fields || {}));
}

function readLuaString(L, index) {
  const p = api.lua_tolstring(L, index, NULL);
  if (p.isNull()) {
    return "";
  }
  return p.readUtf8String() || "";
}

function resolveApi() {
  const mod = Process.findModuleByName("xlua.dll");
  if (mod === null) {
    return null;
  }

  function exp(name) {
    let p = null;

    if (mod !== null && typeof mod.findExportByName === "function") {
      p = mod.findExportByName(name);
    }

    if (p === null && mod !== null && typeof mod.getExportByName === "function") {
      try {
        p = mod.getExportByName(name);
      } catch (_) {
        p = null;
      }
    }

    if (p === null && typeof Module.findExportByName === "function") {
      p = Module.findExportByName("xlua.dll", name);
    }

    if (p === null && typeof Module.getExportByName === "function") {
      try {
        p = Module.getExportByName("xlua.dll", name);
      } catch (_) {
        p = null;
      }
    }

    if (p === null && typeof Module.findGlobalExportByName === "function") {
      p = Module.findGlobalExportByName(name);
    }

    if (p === null && typeof Module.getGlobalExportByName === "function") {
      try {
        p = Module.getGlobalExportByName(name);
      } catch (_) {
        p = null;
      }
    }

    if (p === null) {
      throw new Error("missing xlua export " + name);
    }
    return p;
  }

  const resolved = {
    lua_pcall_ptr: exp("lua_pcall"),
    luaL_loadbuffer_ptr: exp("luaL_loadbuffer"),
    lua_gettop: new NativeFunction(exp("lua_gettop"), "int", ["pointer"]),
    lua_settop: new NativeFunction(exp("lua_settop"), "void", ["pointer", "int"]),
    lua_toboolean: new NativeFunction(exp("lua_toboolean"), "int", ["pointer", "int"]),
    lua_tolstring: new NativeFunction(exp("lua_tolstring"), "pointer", ["pointer", "int", "pointer"]),
  };

  resolved.lua_pcall = new NativeFunction(resolved.lua_pcall_ptr, "int", ["pointer", "int", "int", "int"]);
  resolved.luaL_loadbuffer = new NativeFunction(resolved.luaL_loadbuffer_ptr, "int", ["pointer", "pointer", "ulong", "pointer"]);

  emit("api", {
    module: mod.name,
    base: mod.base.toString(),
    lua_pcall: resolved.lua_pcall_ptr.toString(),
    luaL_loadbuffer: resolved.luaL_loadbuffer_ptr.toString(),
  });

  return resolved;
}

function callLua(L, code, label) {
  if (L.isNull()) {
    return { ok: false, msg: "lua_State is null" };
  }

  injecting = true;

  let top = -1;
  const result = { ok: false, msg: "" };

  try {
    top = api.lua_gettop(L);
    const codePtr = Memory.allocUtf8String(code);
    const labelPtr = Memory.allocUtf8String(label);

    let rc = api.luaL_loadbuffer(L, codePtr, code.length, labelPtr);
    if (rc !== 0) {
      result.msg = "luaL_loadbuffer rc=" + rc + " " + readLuaString(L, -1);
      api.lua_settop(L, top);
      return result;
    }

    rc = api.lua_pcall(L, 0, 2, 0);
    if (rc !== 0) {
      result.msg = "lua_pcall rc=" + rc + " " + readLuaString(L, -1);
      api.lua_settop(L, top);
      return result;
    }

    result.ok = api.lua_toboolean(L, top + 1) !== 0;
    result.msg = readLuaString(L, top + 2);
    api.lua_settop(L, top);
    return result;
  } catch (e) {
    result.msg = "callLua exception: " + e;
    if (top >= 0) {
      try {
        api.lua_settop(L, top);
      } catch (_) {
      }
    }
    return result;
  } finally {
    injecting = false;
  }
}

function tryInstallPayload(L) {
  if (payloadInstalled || injecting) {
    return;
  }

  if (installAttempts >= MAX_INSTALL_ATTEMPTS) {
    return;
  }

  installAttempts += 1;
  const result = callLua(L, LUA_PAYLOAD, "@capture_passive_battle_packets.lua");

  if (result.ok) {
    payloadInstalled = true;
    emit("installed", { attempts: installAttempts, output: result.msg });
  } else if (installAttempts % 25 === 1) {
    emit("install_wait", { attempts: installAttempts, reason: result.msg });
  }
}

function processLuaWork(L) {
  if (injecting || L.isNull()) {
    return;
  }

  if (!payloadInstalled) {
    tryInstallPayload(L);
  }
}

function installHook() {
  if (hookInstalled) {
    return;
  }

  api = resolveApi();
  if (api === null) {
    setTimeout(installHook, 1000);
    return;
  }

  Interceptor.attach(api.lua_pcall_ptr, {
    onEnter(args) {
      if (injecting) {
        return;
      }

      this.luaState = args[0];
    },
    onLeave(_) {
      if (injecting || this.luaState === undefined) {
        return;
      }

      lastLuaState = this.luaState;
      processLuaWork(lastLuaState);
    },
  });

  hookInstalled = true;
  emit("hooked", {});
}

rpc.exports = {
  status() {
    return {
      hookInstalled: hookInstalled,
      payloadInstalled: payloadInstalled,
      installAttempts: installAttempts,
      lastLuaState: lastLuaState.toString(),
    };
  },
  reinstall() {
    payloadInstalled = false;
    installAttempts = 0;
    if (lastLuaState.isNull()) {
      return { ok: false, msg: "lastLuaState is null" };
    }
    tryInstallPayload(lastLuaState);
    return { ok: payloadInstalled, msg: payloadInstalled ? "installed" : "queued" };
  },
};

installHook();
