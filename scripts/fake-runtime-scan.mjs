import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  options.set(args[index], args[index + 1]);
}

const out = options.get("--out");
const probe = options.get("--lua-probe-module");
if (!out || !probe) {
  console.error("usage: fake-runtime-scan --out <dir> --lua-probe-module <probe>");
  process.exit(2);
}

await mkdir(out, { recursive: true });
if (probe === "__dump_rpc_captures__") {
  const record = {
    module: "Proxy.AvatarMembers.ImpUnion",
    func: "SRPC_RPCReqUnionMemberInfoResponse",
    time: "2026-06-09T21:10:00+08:00",
    returns: JSON.stringify({
      memberSnapshots: [
        {
          avatarId: "command-1001",
          avatarName: "马超",
          state: "在线",
          officialName: "前锋",
          legionName: "二队",
          prosperity: 5080,
        },
      ],
    }),
  };
  await writeFile(path.join(out, "rpc-captures.json"), `${JSON.stringify([record], null, 2)}\n`);
} else {
  await writeFile(path.join(out, "hook-installed.json"), `${JSON.stringify({ probe })}\n`);
}
