/**
 * Battle Report Grabber v4 - production hook.
 *
 * Channels:
 * - batch: lossless battle UI text stream used by the realtime parser.
 * - structured_batch: best-effort Lua field/value side-channel for report ids,
 *   hero data, tactics, treatises, render data, and alliance metadata.
 * - stats/coverage: hook coverage, filter counters, and bounded reject samples.
 */
var captured = [];
var structured = [];
var batchNum = 0;
var structuredBatchNum = 0;
var eventSeq = 0;
var structuredSeq = 0;
var coverageTick = 0;
var MAX_READ_LEN = 2000;
var MAX_LUA_STRING_LEN = 50000;
var MAX_REJECT_SAMPLES = 16;
var FIELD_VALUE_WINDOW_MS = 1500;

var TEMPLATE_REGEX = /[a-z]+[A-Z][a-zA-Z]+/;
var LOWERCASE_PLACEHOLDER = /\b[a-z]+%\b/;
var LUA_MODULE_PATTERNS = [/.*lua.*\.dll/i, /xlua\.dll/i, /tolua\.dll/i];
var EXPORT_READERS = [
    {name: "lua_pushlstring", reader: "push_lstring"},
    {name: "lua_pushstring", reader: "push_string"},
    {name: "lua_tolstring", reader: "tolstring"}
];
var FIELD_EXPORTS = ["lua_getfield"];

var REPORT_FIELDS = makeSet([
    "unionName", "unionId", "avatarName", "avatarId", "avName", "myself",
    "battleId", "battleResult", "battleReport", "battleReportData", "battleDetail",
    "result", "isWin", "createTime", "coord", "name", "txt", "msg", "desc", "content",
    "heroData", "heroList", "renderData", "parentRenderData", "shareInfo",
    "armyId", "attackArmyId", "defendArmyId", "attackAvatarId", "defendAvatarId",
    "attackUnionId", "defendUnionId", "attackUnionName", "defendUnionName",
    "winBattleNum", "zgNum", "totalArmyTroopNum", "battleGetWay", "rtp", "baseTp",
    "heroName", "heroId", "heroIndex", "position", "country", "camp", "level",
    "skillName", "skillId", "skill", "tacticName", "tacticId",
    "treatiseName", "treatiseId", "treatiseList", "equipName", "equipList",
    "horseName", "horseList", "buffList", "formation", "soldierType", "soldierNum",
    "troopNum", "leftTroop", "loseSoldier", "damage", "hurt", "heal", "killNum",
    "attack", "defence", "intelligence", "speed", "might", "effect", "supply",
    "roundList", "actionList", "replay", "statistics", "sIndex", "resLv", "guardId"
]);
var CONTEXT_FIELDS = makeSet([
    "battleReport", "battleReportData", "battleDetail", "heroData", "heroList",
    "renderData", "parentRenderData", "shareInfo", "roundList", "actionList",
    "statistics", "buffList", "treatiseList", "equipList", "horseList"
]);

var stats = {
    total: 0,
    passed: 0,
    structured: 0,
    filteredLength: 0,
    filteredJson: 0,
    filteredTemplate: 0,
    filteredIndicator: 0,
    filteredCleanLength: 0,
    errors: 0,
    bySource: {},
    byField: {},
    rejectedSamples: {
        length: [],
        json: [],
        template: [],
        indicator: [],
        cleanLength: []
    }
};
var attachedHooks = [];
var moduleNames = [];
var lastFieldName = "";
var lastFieldAt = 0;
var currentContext = "";

function makeSet(values) {
    var result = {};
    for (var i = 0; i < values.length; i++) result[values[i]] = true;
    return result;
}

function safeSend(type, payload) {
    try {
        send({type: type, payload: payload});
    } catch(e) {}
}

function ensureSourceStats(source) {
    if (!stats.bySource[source]) {
        stats.bySource[source] = {
            total: 0,
            passed: 0,
            structured: 0,
            filtered: 0,
            errors: 0
        };
    }
    return stats.bySource[source];
}

function hasTemplate(s) {
    if (TEMPLATE_REGEX.test(s)) return true;
    if (LOWERCASE_PLACEHOLDER.test(s)) return true;
    return false;
}

function containsAny(s, values) {
    for (var i = 0; i < values.length; i++) {
        if (s.indexOf(values[i]) >= 0) return true;
    }
    return false;
}

function hasBattleIndicator(s) {
    if (s.indexOf("<color=") >= 0 || s.indexOf("<link") >= 0) return true;
    if (s.indexOf("\u3010") >= 0 || s.indexOf("\u300c") >= 0) return true;
    return containsAny(s, [
        "\u635f\u5931\u4e86\u5175\u529b",
        "\u6062\u590d\u4e86\u5175\u529b",
        "\u53d1\u52a8",
        "\u884c\u52a8\u987a\u5e8f",
        "\u5f53\u524d\u8865\u7ed9\u503c",
        "\u5f00\u59cb\u884c\u52a8",
        "\u5175\u529b",
        "\u961f\u83b7\u5f97",
        "\u5f3a\u5316\u6548\u679c",
        "\u63d0\u5347",
        "\u964d\u4f4e",
        "\u53e0\u52a0",
        "\u6d88\u5931",
        "\u5237\u65b0",
        "\u56e0\u51e0\u7387",
        "\u65e0\u6cd5\u518d\u6218",
        "\u6218\u6597\u7ed3\u675f",
        "\u56de\u5408",
        "\u65bd\u52a0",
        "\u62b5\u5fa1",
        "\u89c4\u907f",
        "\u5206\u644a",
        "\u53cd\u51fb",
        "\u6cbb\u7597",
        "\u4f24\u5bb3",
        "\u4f1a\u5fc3",
        "\u5947\u8c0b"
    ]);
}

function hasReportJsonHint(s) {
    return containsAny(s, [
        "\"battleId\"", "\"heroData\"", "\"heroList\"", "\"renderData\"",
        "\"skillName\"", "\"treatiseName\"", "\"battleReport\"", "\"battleDetail\""
    ]);
}

function plainText(s) {
    return String(s || "").replace(/<[^>]+>/g, "").trim();
}

function recordReject(reason, s, source) {
    var bucket = stats.rejectedSamples[reason];
    if (!bucket || bucket.length >= MAX_REJECT_SAMPLES) return;
    var text = plainText(String(s || "")).slice(0, 180);
    if (!text) return;
    bucket.push({source: source, text: text, len: String(s || "").length});
}

function recordStructured(row) {
    var source = row.source || "";
    var sourceStats = ensureSourceStats(source);
    var field = String(row.field || "");
    var value = String(row.value !== undefined ? row.value : "");
    structuredSeq++;
    stats.structured++;
    sourceStats.structured++;
    if (field) stats.byField[field] = (stats.byField[field] || 0) + 1;
    structured.push({
        kind: row.kind || "field_value",
        field: field,
        value: value.slice(0, MAX_READ_LEN),
        plain: plainText(value).slice(0, MAX_READ_LEN),
        source: source,
        context: row.context || currentContext || "",
        hook_seq: structuredSeq,
        hook_ts: row.hook_ts || Date.now(),
        value_len: value.length
    });
    if (structured.length >= 100) flushStructured("size");
}

function trackFieldName(name, source) {
    if (!name || name.length > 160) return;
    lastFieldName = name;
    lastFieldAt = Date.now();
    if (CONTEXT_FIELDS[name]) currentContext = name;
    if (!REPORT_FIELDS[name]) return;
    recordStructured({
        kind: "field",
        field: name,
        value: name,
        source: source,
        context: currentContext,
        hook_ts: lastFieldAt
    });
}

function trackStructuredValue(s, source) {
    if (!s) return;
    var raw = String(s).trim();
    if (!raw || raw.length > MAX_LUA_STRING_LEN) return;
    var now = Date.now();
    var field = "";
    if (lastFieldName && (now - lastFieldAt) <= FIELD_VALUE_WINDOW_MS) {
        field = lastFieldName;
    }
    var knownField = field && REPORT_FIELDS[field];
    var knownContext = currentContext && CONTEXT_FIELDS[currentContext];
    var jsonCandidate = raw.charCodeAt(0) === 123 && raw.length <= MAX_LUA_STRING_LEN && hasReportJsonHint(raw);
    if (!knownField && !knownContext && !jsonCandidate) return;
    if (hasTemplate(raw) && !jsonCandidate) return;

    recordStructured({
        kind: jsonCandidate ? "json_candidate" : (knownField ? "field_value" : "context_value"),
        field: jsonCandidate ? "json" : field,
        value: raw,
        source: source,
        context: currentContext,
        hook_ts: now
    });
}

function submitString(s, source) {
    stats.total++;
    var sourceStats = ensureSourceStats(source);
    sourceStats.total++;

    trackStructuredValue(s, source);

    if (!s || s.length < 5) {
        stats.filteredLength++;
        sourceStats.filtered++;
        recordReject("length", s, source);
        return;
    }
    if (s.charCodeAt(0) === 123) {
        stats.filteredJson++;
        sourceStats.filtered++;
        recordReject("json", s, source);
        return;
    }
    if (hasTemplate(s)) {
        stats.filteredTemplate++;
        sourceStats.filtered++;
        recordReject("template", s, source);
        return;
    }
    if (!hasBattleIndicator(s)) {
        stats.filteredIndicator++;
        sourceStats.filtered++;
        recordReject("indicator", s, source);
        return;
    }

    var raw = String(s).trim();
    var plain = plainText(raw);
    if (plain.length < 4) {
        stats.filteredCleanLength++;
        sourceStats.filtered++;
        recordReject("cleanLength", s, source);
        return;
    }

    var now = Date.now();
    eventSeq++;
    stats.passed++;
    sourceStats.passed++;
    captured.push({
        raw: raw,
        plain: plain,
        source: source,
        hook_seq: eventSeq,
        hook_ts: now,
        raw_len: raw.length
    });

    if (captured.length >= 100) flushBatch("size");
}

function flushBatch(reason) {
    if (captured.length === 0) return;
    batchNum++;
    safeSend("batch", {
        batch: batchNum,
        reason: reason || "timer",
        events: captured.slice(0),
        stats: buildStatsPayload()
    });
    captured = [];
}

function flushStructured(reason) {
    if (structured.length === 0) return;
    structuredBatchNum++;
    safeSend("structured_batch", {
        batch: structuredBatchNum,
        reason: reason || "timer",
        events: structured.slice(0),
        stats: buildStatsPayload()
    });
    structured = [];
}

function buildStatsPayload() {
    return {
        total: stats.total,
        passed: stats.passed,
        structured: stats.structured,
        filteredLength: stats.filteredLength,
        filteredJson: stats.filteredJson,
        filteredTemplate: stats.filteredTemplate,
        filteredIndicator: stats.filteredIndicator,
        filteredCleanLength: stats.filteredCleanLength,
        errors: stats.errors,
        bySource: stats.bySource,
        byField: stats.byField,
        rejectedSamples: stats.rejectedSamples,
        hooks: attachedHooks,
        modules: moduleNames,
        pending: {
            text: captured.length,
            structured: structured.length
        }
    };
}

function sendCoverage(reason) {
    safeSend("coverage", {
        reason: reason || "timer",
        stats: buildStatsPayload(),
        modules: moduleNames,
        hooks: attachedHooks
    });
}

function findLuaModules() {
    var modules = Process.enumerateModules();
    var result = [];
    var seen = {};
    for (var pi = 0; pi < LUA_MODULE_PATTERNS.length; pi++) {
        for (var mi = 0; mi < modules.length; mi++) {
            var mod = modules[mi];
            var key = mod.name + "@" + mod.base;
            if (!LUA_MODULE_PATTERNS[pi].test(mod.name)) continue;
            if (seen[key]) continue;
            seen[key] = true;
            result.push(mod);
            moduleNames.push({name: mod.name, base: String(mod.base), size: mod.size || 0});
        }
    }
    return result;
}

function findExport(mod, exportName) {
    try {
        var addr = mod.getExportByName(exportName);
        if (addr) return addr;
    } catch(e) {}
    return null;
}

function readPushLString(args) {
    var p = ptr(args[1]);
    if (p.isNull()) return "";
    var len = args[2].toInt32();
    if (len < 1 || len > MAX_LUA_STRING_LEN) return "";
    return p.readUtf8String(Math.min(len, MAX_READ_LEN));
}

function readPushString(args) {
    var p = ptr(args[1]);
    if (p.isNull()) return "";
    return p.readUtf8String(MAX_READ_LEN);
}

function attachPushReader(mod, exportInfo, addr) {
    var source = mod.name + "::" + exportInfo.name;
    Interceptor.attach(addr, {
        onEnter: function(args) {
            try {
                var s = exportInfo.reader === "push_lstring" ? readPushLString(args) : readPushString(args);
                submitString(s, source);
            } catch(e) {
                stats.errors++;
                ensureSourceStats(source).errors++;
            }
        }
    });
    attachedHooks.push({module: mod.name, export: exportInfo.name, reader: exportInfo.reader});
    safeSend("info", {msg: "attached " + source, hooks: attachedHooks});
}

function attachToLStringReader(mod, exportInfo, addr) {
    var source = mod.name + "::" + exportInfo.name;
    Interceptor.attach(addr, {
        onEnter: function(args) {
            this.lenPtr = args[2];
        },
        onLeave: function(retval) {
            try {
                var p = ptr(retval);
                if (p.isNull()) return;
                var readLen = MAX_READ_LEN;
                try {
                    if (this.lenPtr && !ptr(this.lenPtr).isNull()) {
                        var len = ptr(this.lenPtr).readU32();
                        if (len >= 1 && len <= MAX_LUA_STRING_LEN) readLen = Math.min(len, MAX_READ_LEN);
                    }
                } catch(e) {}
                submitString(p.readUtf8String(readLen), source);
            } catch(e) {
                stats.errors++;
                ensureSourceStats(source).errors++;
            }
        }
    });
    attachedHooks.push({module: mod.name, export: exportInfo.name, reader: exportInfo.reader});
    safeSend("info", {msg: "attached " + source, hooks: attachedHooks});
}

function attachFieldReader(mod, exportName, addr) {
    var source = mod.name + "::" + exportName;
    Interceptor.attach(addr, {
        onEnter: function(args) {
            try {
                var keyPtr = ptr(args[2]);
                if (keyPtr.isNull()) return;
                var key = keyPtr.readUtf8String(160);
                trackFieldName(String(key || ""), source);
            } catch(e) {
                stats.errors++;
                ensureSourceStats(source).errors++;
            }
        }
    });
    attachedHooks.push({module: mod.name, export: exportName, reader: "field_name"});
    safeSend("info", {msg: "attached " + source, hooks: attachedHooks});
}

function attachExport(mod, exportInfo) {
    var addr = findExport(mod, exportInfo.name);
    if (!addr) return false;
    if (exportInfo.reader === "tolstring") attachToLStringReader(mod, exportInfo, addr);
    else attachPushReader(mod, exportInfo, addr);
    return true;
}

function attachFieldExports(mod) {
    var attached = 0;
    for (var i = 0; i < FIELD_EXPORTS.length; i++) {
        var addr = findExport(mod, FIELD_EXPORTS[i]);
        if (!addr) continue;
        attachFieldReader(mod, FIELD_EXPORTS[i], addr);
        attached++;
    }
    return attached;
}

function attachAll() {
    var modules = findLuaModules();
    if (modules.length === 0) {
        safeSend("error", {msg: "Lua module not found", tried: LUA_MODULE_PATTERNS.map(function(r){return r.source;})});
        return;
    }

    safeSend("info", {msg: "Lua modules: " + modules.map(function(m){ return m.name; }).join(", ")});
    for (var mi = 0; mi < modules.length; mi++) {
        for (var ei = 0; ei < EXPORT_READERS.length; ei++) {
            try {
                attachExport(modules[mi], EXPORT_READERS[ei]);
            } catch(e) {
                stats.errors++;
                safeSend("info", {msg: "attach failed: " + modules[mi].name + "::" + EXPORT_READERS[ei].name + " " + e.message});
            }
        }
        try {
            attachFieldExports(modules[mi]);
        } catch(e2) {
            stats.errors++;
            safeSend("info", {msg: "field attach failed: " + modules[mi].name + " " + e2.message});
        }
    }

    if (attachedHooks.length === 0) {
        safeSend("error", {msg: "No usable Lua exports found", tried: EXPORT_READERS.map(function(x){return x.name;}).concat(FIELD_EXPORTS)});
        return;
    }

    safeSend("ready", {
        msg: "Battle report hook v4 ready, hooks=" + attachedHooks.length,
        hooks: attachedHooks,
        stats: buildStatsPayload()
    });
    sendCoverage("ready");
}

attachAll();

rpc.exports = {
    flush: function(reason) {
        flushBatch(reason || "rpc");
        flushStructured(reason || "rpc");
        sendCoverage(reason || "rpc");
        return buildStatsPayload();
    }
};

setInterval(function() {
    flushBatch("timer");
    flushStructured("timer");
    safeSend("stats", buildStatsPayload());
    coverageTick++;
    if (coverageTick % 3 === 0) sendCoverage("timer");
}, 3000);
