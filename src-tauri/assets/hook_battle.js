// Battle Grabber V6 - Frida Hook Script
// Capture battle report network packets

(function () {
  "use strict";

  const TARGET_MSG_IDS = {
    1001: "RPCGetBattleBlockList",
    1002: "RPCGetDetailCombatInfo",
    1004: "RPCGetUnionBattleBlockList",
    1006: "RPCGetChildCombatInfoList",
    1007: "RPCGetUnionChildCombatInfoList",
    1008: "RPCGetAllCombatInfo",
  };

  let captureCount = 0;
  let isCapturing = true;

  function log(msg) {
    const timestamp = new Date().toISOString();
    send({
      type: "log",
      message: `[${timestamp}] ${msg}`,
    });
  }

  function onPacketCaptured(msgId, protoName, data) {
    captureCount++;
    const timestamp = new Date().toISOString();

    send({
      type: "packet",
      seq: captureCount,
      msgId: msgId,
      protoName: protoName,
      timestamp: timestamp,
      dataLength: data ? data.length : 0,
    });

    log(`Captured packet #${captureCount}: msgId=${msgId} proto=${protoName}`);
  }

  // Try to hook Unity networking
  function hookUnityNetworking() {
    try {
      // Hook UnityEngine.NetworkTransport
      const NetworkTransport = Il2Cpp.domain.assembly("UnityEngine").image.class(
        "UnityEngine.NetworkTransport"
      );

      if (NetworkTransport) {
        log("Found UnityEngine.NetworkTransport");
        // Hook send/receive methods
      }
    } catch (e) {
      // Not Unity or not available
    }
  }

  // Try to hook generic network functions
  function hookGenericNetwork() {
    try {
      // Hook common socket functions
      const recvPtr = Module.findExportByName("ws2_32.dll", "recv");
      const sendPtr = Module.findExportByName("ws2_32.dll", "send");

      if (recvPtr) {
        Interceptor.attach(recvPtr, {
          onEnter: function (args) {
            this.socket = args[0];
            this.buffer = args[1];
            this.length = args[2].toInt32();
          },
          onLeave: function (retval) {
            const bytesRead = retval.toInt32();
            if (bytesRead > 0 && isCapturing) {
              try {
                const data = Memory.readByteArray(this.buffer, bytesRead);
                // Try to parse as game protocol
                parseGameData(data, bytesRead);
              } catch (e) {
                // Ignore read errors
              }
            }
          },
        });
        log("Hooked recv function");
      }

      if (sendPtr) {
        Interceptor.attach(sendPtr, {
          onEnter: function (args) {
            const length = args[2].toInt32();
            if (length > 0 && isCapturing) {
              try {
                const data = Memory.readByteArray(args[1], length);
                parseGameData(data, length);
              } catch (e) {
                // Ignore read errors
              }
            }
          },
        });
        log("Hooked send function");
      }
    } catch (e) {
      log("Failed to hook network: " + e);
    }
  }

  // Parse game protocol data
  function parseGameData(data, length) {
    if (!data || length < 4) return;

    try {
      const view = new DataView(data);
      // Try to extract message ID (usually first 2 bytes)
      const msgId = view.getUint16(0, false); // big-endian

      if (TARGET_MSG_IDS[msgId]) {
        onPacketCaptured(msgId, TARGET_MSG_IDS[msgId], data);
      }
    } catch (e) {
      // Not a valid packet
    }
  }

  // Main initialization
  function init() {
    log("Battle Grabber V6 - Hook Script Loaded");
    log("Target Message IDs: " + Object.keys(TARGET_MSG_IDS).join(", "));

    hookGenericNetwork();
    hookUnityNetworking();

    log("Hook initialization complete");
    send({ type: "ready" });
  }

  // RPC handlers
  rpc.exports = {
    startCapture: function () {
      isCapturing = true;
      captureCount = 0;
      log("Capture started");
      return true;
    },
    stopCapture: function () {
      isCapturing = false;
      log("Capture stopped. Total: " + captureCount);
      return captureCount;
    },
    getStatus: function () {
      return {
        isCapturing: isCapturing,
        packetCount: captureCount,
      };
    },
  };

  init();
})();
