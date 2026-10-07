-- Passive capture for normal battle report packets.
-- This installs hooks only; it does not send debug/GM RPCs.

local ok_stream, Stream = pcall(require, "common_lib.Stream")

if not ok_stream or not Stream then
	return false, "common_lib.Stream missing"
end

local BATTLE_LOG_MODULES = {
	"common_lib.battlelog_lib.BattleLog"
}

local BattleLogLib = nil
local battle_log_load_report = nil

local TARGET_REQUESTS = {
	RPCGetBattleBlockList = true,
	RPCGetDetailCombatInfo = true,
	RPCGetTargetCombatList = true,
	RPCGetUnionBattleBlockList = true,
	RPCGetStaticsCombatInfo = true,
	RPCGetChildCombatInfoList = true,
	RPCGetUnionChildCombatInfoList = true,
	RPCGetAllCombatInfo = true,
	RPCGetHeroBattleSnapRecords = true,
	RPCTargetCoordBattleBlockList = true,
	RPCTargetCoordBattleChildCombatList = true,
	RPCGetTowerBattleBlockList = true,
	RPCGetTowerBattleChildCombatList = true,
	RPCGetTargetUIDOneBattleBlockInfo = true,
	RPCGetTargetUIDOneBattleChildCombatList = true,
	RPCGetExpeditionBattleBlockList = true,
	RPCGetExpeditionBattleChildCombatList = true,
	RPCGetTargetBlockHashBattleBlockInfo = true,
	RPCStarBattleBlockList = true,
	RPCStarBattleChildList = true,
	RPCGetBattleAllSnapRecords = true,
	RPCBattleSearch = true,
	RPCGetCachedBattleSearchSeg = true,
	RPCGetManorSweepBattleBlockList = true,
	RPCGetManorSweepBattleChildCombatList = true
}

local TARGET_RESPONSES = {}

for name, _ in pairs(TARGET_REQUESTS) do
	TARGET_RESPONSES[name .. "Response"] = true
end

local MSG_ID_TO_RESPONSE = {
	[1001] = "RPCGetBattleBlockListResponse",
	[1002] = "RPCGetDetailCombatInfoResponse",
	[1003] = "RPCGetTargetCombatListResponse",
	[1004] = "RPCGetUnionBattleBlockListResponse",
	[1005] = "RPCGetStaticsCombatInfoResponse",
	[1006] = "RPCGetChildCombatInfoListResponse",
	[1007] = "RPCGetUnionChildCombatInfoListResponse",
	[1008] = "RPCGetAllCombatInfoResponse",
	[1017] = "RPCGetHeroBattleSnapRecordsResponse",
	[1019] = "RPCTargetCoordBattleBlockListResponse",
	[1020] = "RPCTargetCoordBattleChildCombatListResponse",
	[1021] = "RPCGetTowerBattleBlockListResponse",
	[1022] = "RPCGetTowerBattleChildCombatListResponse",
	[1023] = "RPCGetTargetUIDOneBattleBlockInfoResponse",
	[1024] = "RPCGetTargetUIDOneBattleChildCombatListResponse",
	[1026] = "RPCGetExpeditionBattleBlockListResponse",
	[1027] = "RPCGetExpeditionBattleChildCombatListResponse",
	[1028] = "RPCGetTargetBlockHashBattleBlockInfoResponse",
	[1029] = "RPCStarBattleBlockListResponse",
	[1030] = "RPCStarBattleChildListResponse",
	[1031] = "RPCGetBattleAllSnapRecordsResponse",
	[1032] = "RPCBattleSearchResponse",
	[1033] = "RPCGetCachedBattleSearchSegResponse",
	[1035] = "RPCGetManorSweepBattleBlockListResponse",
	[1036] = "RPCGetManorSweepBattleChildCombatListResponse"
}

local BINARY_KEYS = {
	eventDataList = true,
	binStatics = true,
	baseRecords = true,
	diffRecords = true,
	battleFormulaPageDatas = true,
	reports = true
}

local capture_seq = 0

local function pack_returns(...)
	return { n = select("#", ...), ... }
end

local function unpack_returns(values)
	local unpack_fn = table.unpack or unpack
	return unpack_fn(values, 1, values.n)
end

local function get_output_dir()
	local base = "."

	if CSU and CSU.Application and CSU.Application.persistentDataPath then
		base = CSU.Application.persistentDataPath
	elseif CS and CS.UnityEngine and CS.UnityEngine.Application and CS.UnityEngine.Application.persistentDataPath then
		base = CS.UnityEngine.Application.persistentDataPath
	end

	return base .. "/battle_packet_capture"
end

local function ensure_dir(path)
	if CS and CS.System and CS.System.IO and CS.System.IO.Directory then
		local ok = pcall(CS.System.IO.Directory.CreateDirectory, path)

		if ok then
			return true
		end
	end

	return false
end

local function write_file(path, mode, data)
	local file, err = io.open(path, mode)

	if not file then
		if LogMgr then
			LogMgr:error("[PassiveBattleCapture] open failed %s %s", path, tostring(err))
		end

		return false
	end

	file:write(data or "")
	file:close()

	return true
end

local function append_trace(message)
	local out_dir = get_output_dir()
	ensure_dir(out_dir)
	write_file(out_dir .. "/trace.log", "ab", string.format("%s %s\n", os.date("%Y-%m-%d %H:%M:%S"), tostring(message)))
end

local function sanitize(value)
	value = tostring(value or "nil")
	value = string.gsub(value, "[^%w_%-%.]", "_")

	if #value == 0 then
		return "nil"
	end

	return value
end

local function encode_json(value)
	local ok, encoded = pcall(Stream.EncodeJson, value)

	if ok and encoded then
		return encoded
	end

	return string.format('{"error":"Stream.EncodeJson failed","detail":%q}', tostring(encoded))
end

local function has_function(value, name)
	local ok, fn = pcall(function()
		return value and value[name]
	end)

	return ok and type(fn) == "function", fn
end

local function describe_decoder(source, decoder)
	local has_decode = has_function(decoder, "DecodeIntListToEvent")
	local has_parse_all = has_function(decoder, "ParseAll")
	local has_reset = has_function(decoder, "Reset")
	local has_get_all = has_function(decoder, "GetAllEventDataList")

	return {
		source = source,
		valueType = type(decoder),
		hasDecodeIntListToEvent = has_decode,
		hasParseAll = has_parse_all,
		hasReset = has_reset,
		hasGetAllEventDataList = has_get_all
	}
end

local function try_accept_battle_log(source, decoder, attempts)
	local detail = describe_decoder(source, decoder)

	table.insert(attempts, detail)

	if detail.hasDecodeIntListToEvent then
		BattleLogLib = decoder
		battle_log_load_report = {
			ok = true,
			source = source,
			attempts = attempts
		}

		return true
	end

	return false
end

local function load_battle_log_decoder()
	if BattleLogLib then
		return BattleLogLib, battle_log_load_report
	end

	local attempts = {}
	local global_decoder = rawget(_G, "BattleLog")

	if global_decoder and try_accept_battle_log("_G.BattleLog", global_decoder, attempts) then
		return BattleLogLib, battle_log_load_report
	end

	if package and package.loaded then
		for _, module_name in ipairs(BATTLE_LOG_MODULES) do
			local loaded_decoder = package.loaded[module_name]

			if loaded_decoder and try_accept_battle_log("package.loaded:" .. module_name, loaded_decoder, attempts) then
				return BattleLogLib, battle_log_load_report
			end
		end
	end

	for _, module_name in ipairs(BATTLE_LOG_MODULES) do
		local ok, decoder = pcall(require, module_name)

		if ok then
			if try_accept_battle_log("require:" .. module_name, decoder, attempts) then
				return BattleLogLib, battle_log_load_report
			end
		else
			table.insert(attempts, {
				source = "require:" .. module_name,
				ok = false,
				error = tostring(decoder)
			})
		end
	end

	battle_log_load_report = {
		ok = false,
		attempts = attempts
	}

	return nil, battle_log_load_report
end

local function pack_with_msg_id(msg_id, content)
	if not content then
		return nil
	end

	local ok, packed = pcall(function()
		return string.pack(">H", msg_id) .. string.pack("c" .. #content, content)
	end)

	if ok then
		return packed
	end

	return string.char(math.floor(msg_id / 256) % 256, msg_id % 256) .. content
end

local function resolve_proto_name(msg_id)
	local target_proto_name = nil

	pcall(function()
		if sproto and SProtoData then
			local target_proto = sproto.query_proto(SProtoData, msg_id)

			if target_proto and target_proto.name then
				target_proto_name = target_proto.name .. "Response"
			end
		end
	end)

	return target_proto_name or MSG_ID_TO_RESPONSE[tonumber(msg_id)]
end

local function decode_stream_blob(raw, prefix, field)
	local ok, decoded = pcall(Stream.Loads, raw)

	field.streamDecodeOk = ok

	if ok then
		field.streamJson = prefix .. ".stream.json"
		write_file(field.streamJson, "wb", encode_json(decoded))
	else
		field.streamError = tostring(decoded)
		write_file(prefix .. ".stream_error.txt", "wb", tostring(decoded))
	end
end

local function decode_battle_event_blob(raw, prefix, field)
	if not raw or #raw < 4 then
		field.lz4DecodeOk = false
		field.lz4Skipped = true
		field.lz4Error = "blob empty or length < 4"
		write_file(prefix .. ".lz4_error.txt", "wb", field.lz4Error)
		return
	end

	local ok_lz4, unzipped = pcall(Stream.Lz4Decode, raw)

	field.lz4DecodeOk = ok_lz4

	if not ok_lz4 or not unzipped then
		field.lz4Error = tostring(unzipped)
		write_file(prefix .. ".lz4_error.txt", "wb", tostring(unzipped))
		return
	end

	field.unzippedLength = #unzipped
	field.unzippedFile = prefix .. ".unlz4"
	write_file(field.unzippedFile, "wb", unzipped)

	if not SProtoData then
		field.protoDecodeOk = false
		field.protoError = "SProtoData missing"
		return
	end

	local ok_proto, event_data = pcall(function()
		local data = SProtoData:pdecode("BattleEventDataList", unzipped)

		if OverseasProtoParser and OverseasProtoParser.SafeParseProto then
			data = OverseasProtoParser.SafeParseProto(data)
		end

		return data
	end)

	field.protoDecodeOk = ok_proto

	if not ok_proto then
		field.protoError = tostring(event_data)
		write_file(prefix .. ".BattleEventDataList_error.txt", "wb", tostring(event_data))
		return
	end

	field.protoJson = prefix .. ".BattleEventDataList.json"
	write_file(field.protoJson, "wb", encode_json(event_data))

	local battle_log_decoder, battle_log_report = load_battle_log_decoder()
	field.battleLog = battle_log_report
	local has_decode, decode_fn = has_function(battle_log_decoder, "DecodeIntListToEvent")

	if battle_log_decoder and has_decode and event_data and event_data.data then
		local ok_events, events = pcall(decode_fn, battle_log_decoder, event_data.data)
		field.eventDecodeOk = ok_events

		if ok_events then
			field.eventsJson = prefix .. ".events.json"
			field.eventCount = type(events) == "table" and #events or nil
			write_file(field.eventsJson, "wb", encode_json(events))

			local has_reset, reset_fn = has_function(battle_log_decoder, "Reset")
			local has_parse_all, parse_all_fn = has_function(battle_log_decoder, "ParseAll")
			local has_get_all, get_all_fn = has_function(battle_log_decoder, "GetAllEventDataList")
			if not has_get_all then
				has_get_all, get_all_fn = has_function(battle_log_decoder, "GetEventDataList")
			end

			if type(events) == "table" and has_reset and has_parse_all and has_get_all then
				local ok_parsed, parsed_events = pcall(function()
					reset_fn(battle_log_decoder)
					parse_all_fn(battle_log_decoder, events)

					return get_all_fn(battle_log_decoder)
				end)
				field.parsedEventDecodeOk = ok_parsed

				if ok_parsed and parsed_events then
					field.parsedEventsJson = prefix .. ".parsed_events.json"
					field.parsedEventCount = type(parsed_events) == "table" and #parsed_events or nil
					write_file(field.parsedEventsJson, "wb", encode_json(parsed_events))
				else
					field.parsedEventError = tostring(parsed_events)
					write_file(prefix .. ".parsed_events_error.txt", "wb", tostring(parsed_events))
				end
			end
		else
			field.eventError = tostring(events)
			write_file(prefix .. ".events_error.txt", "wb", tostring(events))
		end
	else
		field.eventDecodeOk = false
		field.eventError = "BattleLog decoder or BattleEventDataList.data missing"
		write_file(prefix .. ".events_error.txt", "wb", encode_json({
			error = field.eventError,
			battleLog = battle_log_report,
			hasData = event_data and event_data.data ~= nil
		}))
	end
end

local function walk_binary_fields(value, path, prefix, fields, seen, depth)
	if type(value) ~= "table" or depth > 8 then
		return
	end

	if seen[value] then
		return
	end

	seen[value] = true

	for key, child in pairs(value) do
		local key_text = tostring(key)
		local child_path = path == "" and key_text or path .. "." .. key_text

		if type(child) == "string" and BINARY_KEYS[key_text] and #child > 0 then
			local child_prefix = prefix .. "_" .. sanitize(child_path)
			local bin_file = child_prefix .. ".bin"
			local field = {
				path = child_path,
				key = key_text,
				length = #child,
				file = bin_file
			}

			write_file(bin_file, "wb", child)
			table.insert(fields, field)

			if key_text == "eventDataList" then
				decode_battle_event_blob(child, child_prefix, field)
			elseif key_text == "binStatics" or key_text == "battleFormulaPageDatas" or key_text == "reports" then
				decode_stream_blob(child, child_prefix, field)
			end
		elseif type(child) == "table" then
			walk_binary_fields(child, child_path, prefix, fields, seen, depth + 1)
		end
	end
end

local function next_prefix(kind, msg_id, proto_name)
	capture_seq = capture_seq + 1

	return string.format(
		"%s/%s_%04d_%s_%s_%s",
		get_output_dir(),
		os.date("%Y%m%d_%H%M%S"),
		capture_seq,
		kind,
		sanitize(msg_id),
		sanitize(proto_name)
	)
end

local function dump_send(proto_name, proto)
	if not TARGET_REQUESTS[proto_name] then
		return
	end

	local out_dir = get_output_dir()
	ensure_dir(out_dir)

	local prefix = next_prefix("send", "request", proto_name)
	local packet_file = nil
	local packet_length = nil
	local tag = nil

	pcall(function()
		if SProtoData and SProtoData.request_encode then
			local code
			code, tag = SProtoData:request_encode(proto_name, proto)

			if code and #code > 0 then
				local packet = string.pack(">H", tag) .. string.pack("c" .. #code, code)
				packet_file = prefix .. ".packet.bin"
				packet_length = #packet
				write_file(packet_file, "wb", packet)
			end
		end
	end)

	write_file(prefix .. ".json", "wb", encode_json({
		direction = "send",
		protoName = proto_name,
		msgId = tag,
		packetFile = packet_file,
		packetLength = packet_length,
		proto = proto,
		time = os.time()
	}))
	append_trace(string.format("send proto=%s file=%s.json", tostring(proto_name), prefix))
end

local function dump_receive(msg_id, content, receive_time)
	local proto_name = resolve_proto_name(msg_id)

	if not proto_name or not TARGET_RESPONSES[proto_name] then
		return
	end

	local out_dir = get_output_dir()
	ensure_dir(out_dir)

	local prefix = next_prefix("recv", msg_id, proto_name)
	local raw_file = prefix .. ".content.bin"
	local packet_file = prefix .. ".packet.bin"

	if content then
		write_file(raw_file, "wb", content)
		write_file(packet_file, "wb", pack_with_msg_id(msg_id, content))
	end

	local meta = {
		direction = "receive",
		msgId = msg_id,
		protoName = proto_name,
		contentLength = content and #content or 0,
		receiveTime = receive_time,
		contentFile = raw_file,
		packetFile = packet_file,
		time = os.time(),
		binaryFields = {}
	}

	if ClientProxy and ClientProxy.ReceivePacket and content then
		local ok_decode, decoded = pcall(ClientProxy.ReceivePacket, ClientProxy, msg_id, content)
		meta.decodeOk = ok_decode

		if ok_decode then
			write_file(prefix .. ".decoded.json", "wb", encode_json(decoded))
			walk_binary_fields(decoded, "", prefix, meta.binaryFields, {}, 0)
		else
			meta.decodeError = tostring(decoded)
			write_file(prefix .. ".decode_error.txt", "wb", tostring(decoded))
		end
	else
		meta.decodeOk = false
		meta.decodeError = "ClientProxy.ReceivePacket or content missing"
	end

	write_file(prefix .. ".meta.json", "wb", encode_json(meta))
	append_trace(string.format("receive msgId=%s proto=%s len=%s fields=%s prefix=%s", tostring(msg_id), tostring(proto_name), tostring(meta.contentLength), tostring(#meta.binaryFields), prefix))
end

local function restore_receive_probe()
	if not NetMgr then
		return
	end

	if NetMgr.__passiveBattlePacketCaptureProbeOldOnNetCall then
		NetMgr.OnNetCall = NetMgr.__passiveBattlePacketCaptureProbeOldOnNetCall
		NetMgr.__passiveBattlePacketCaptureProbeOldOnNetCall = nil
		NetMgr.__passiveBattlePacketCaptureOnNetCallProbeInstalled = nil
	end

	if NetMgr.__passiveBattlePacketCaptureProbeOldOnReceivePacket then
		NetMgr.__passiveBattlePacketCaptureOldOnReceivePacket = NetMgr.__passiveBattlePacketCaptureProbeOldOnReceivePacket
		NetMgr.__passiveBattlePacketCaptureProbeOldOnReceivePacket = nil
		NetMgr.__passiveBattlePacketCaptureReceiveProbeInstalled = nil
	end
end

local function install_receive_wrapper()
	if not NetMgr then
		return false
	end

	local original_receive = NetMgr.__passiveBattlePacketCaptureProbeOldOnReceivePacket or NetMgr.__passiveBattlePacketCaptureOldOnReceivePacket

	if not original_receive then
		return false
	end

	NetMgr.__passiveBattlePacketCaptureOldOnReceivePacket = original_receive

	NetMgr.OnReceivePacket = function(self, msg_id, content, receive_time, ...)
		local results = pack_returns(self.__passiveBattlePacketCaptureOldOnReceivePacket(self, msg_id, content, receive_time, ...))
		local ok, err = pcall(dump_receive, msg_id, content, receive_time)

		if not ok then
			append_trace(string.format("dump_receive error msgId=%s err=%s", tostring(msg_id), tostring(err)))
		end

		return unpack_returns(results)
	end

	return true
end

local function install_passive_battle_capture()
	if not NetMgr then
		return false, "NetMgr is nil"
	end

	restore_receive_probe()

	if NetMgr.__passiveBattlePacketCaptureInstalled then
		install_receive_wrapper()
		append_trace("install already installed; receive wrapper refreshed")
		return true, get_output_dir()
	end

	ensure_dir(get_output_dir())

	NetMgr.__passiveBattlePacketCaptureInstalled = true
	NetMgr.__passiveBattlePacketCaptureOldSendPacket = NetMgr.SendPacket
	NetMgr.__passiveBattlePacketCaptureOldOnReceivePacket = NetMgr.OnReceivePacket

	NetMgr.SendPacket = function(self, proto_name, proto, ...)
		pcall(dump_send, proto_name, proto)
		return self.__passiveBattlePacketCaptureOldSendPacket(self, proto_name, proto, ...)
	end

	install_receive_wrapper()

	append_trace("install complete")

	return true, get_output_dir()
end

rawset(_G, "PassiveBattlePacketCaptureInstall", install_passive_battle_capture)
rawset(_G, "PassiveBattlePacketCaptureStatus", function()
	return true, get_output_dir()
end)

return install_passive_battle_capture()
