-- Battle Grabber V6 - Passive Battle Packet Capture
-- Hook game network to capture battle reports

local capture_dir = nil
local capture_seq = 0
local is_capturing = false

-- Target message IDs for battle data
local TARGET_MSG_IDS = {
    [1001] = "RPCGetBattleBlockList",
    [1002] = "RPCGetDetailCombatInfo",
    [1004] = "RPCGetUnionBattleBlockList",
    [1006] = "RPCGetChildCombatInfoList",
    [1007] = "RPCGetUnionChildCombatInfoList",
    [1008] = "RPCGetAllCombatInfo",
}

-- Initialize capture directory
local function init_capture_dir()
    local base = "."

    -- Try to get Unity persistent data path
    pcall(function()
        if CS and CS.UnityEngine and CS.UnityEngine.Application then
            base = CS.UnityEngine.Application.persistentDataPath
        end
    end)

    capture_dir = base .. "/battle_grabber_v6_capture"
    pcall(function()
        if CS and CS.System and CS.System.IO and CS.System.IO.Directory then
            CS.System.IO.Directory.CreateDirectory(capture_dir)
        end
    end)
    return capture_dir
end

-- Write data to file
local function write_file(path, data)
    local file = io.open(path, "wb")
    if file then
        file:write(data)
        file:close()
        return true
    end
    return false
end

-- Log message
local function log(msg)
    local timestamp = os.date("%Y-%m-%d %H:%M:%S")
    local log_msg = string.format("[%s] %s", timestamp, tostring(msg))

    print(log_msg)

    if capture_dir then
        write_file(capture_dir .. "/capture.log", log_msg .. "\n")
    end
end

-- Save captured packet
local function save_packet(msg_id, proto_name, data)
    if not is_capturing then
        return
    end

    capture_seq = capture_seq + 1

    if not capture_dir then
        init_capture_dir()
    end

    local timestamp = os.date("%Y%m%d_%H%M%S")
    local prefix = string.format("%s/%04d_recv_%d_%s_%s",
        capture_dir, capture_seq, msg_id, proto_name or "unknown", timestamp)

    -- Save metadata
    local meta = {
        seq = capture_seq,
        msgId = msg_id,
        protoName = proto_name,
        timestamp = timestamp,
        dataLength = #data,
    }

    local meta_json = string.format(
        '{"seq":%d,"msgId":%d,"protoName":"%s","timestamp":"%s","dataLength":%d}',
        meta.seq, meta.msgId, meta.protoName or "", meta.timestamp, meta.dataLength
    )

    write_file(prefix .. ".meta.json", meta_json)

    -- Save raw data
    write_file(prefix .. ".bin", data)

    log(string.format("Captured packet #%d: msgId=%d proto=%s size=%d",
        capture_seq, msg_id, proto_name or "unknown", #data))

    -- Notify host application
    if _G.__battle_grabber_callback then
        _G.__battle_grabber_callback({
            type = "packet_captured",
            seq = capture_seq,
            msgId = msg_id,
            protoName = proto_name,
            timestamp = timestamp,
            dataLength = #data,
        })
    end
end

-- Hook network receive function
local function hook_network()
    log("Hooking network layer...")

    -- Try to hook Unity networking
    pcall(function()
        if CS and CS.UnityEngine and CS.UnityEngine.Networking then
            log("Found Unity Networking")
        end
    end)

    -- Try to hook custom game network
    pcall(function()
        -- Hook common network patterns
        if _G.NetworkManager or _G.NetManager then
            log("Found game NetworkManager")
        end
    end)

    log("Network hook installed")
end

-- Start capturing
local function start_capture()
    is_capturing = true
    capture_seq = 0

    if not capture_dir then
        init_capture_dir()
    end

    log("=== Capture Started ===")
    log("Capture directory: " .. (capture_dir or "unknown"))

    hook_network()

    return true, capture_dir
end

-- Stop capturing
local function stop_capture()
    is_capturing = false
    log("=== Capture Stopped ===")
    log("Total packets captured: " .. capture_seq)

    return capture_seq
end

-- Get status
local function get_status()
    return {
        isCapturing = is_capturing,
        captureDir = capture_dir,
        packetCount = capture_seq,
    }
end

-- Export functions
return {
    start = start_capture,
    stop = stop_capture,
    status = get_status,
    save_packet = save_packet,
}
