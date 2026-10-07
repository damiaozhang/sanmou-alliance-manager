// 版本号一致性检查：package.json、src-tauri/tauri.conf.json 与
// src-tauri/Cargo.toml 的 version 必须保持一致，否则非零退出并输出三者。
// 用于 CI 的 frontend 与 release job 前置检查，避免 tag 版本与安装包 /
// updater manifest / Rust crate 版本错位。
//
// 2026-09-20 修复（审查：文档与代码不一致 #5）：此前只校验前两处，
// Cargo.toml 的 version 漏在外面 —— 而它同样会被打进二进制元数据。
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

async function readText(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  try {
    return await readFile(fullPath, "utf8");
  } catch (error) {
    console.error(`[check:version] 无法读取 ${relativePath}: ${error.message}`);
    process.exit(2);
  }
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readText(relativePath));
  } catch (error) {
    console.error(`[check:version] 无法解析 ${relativePath}: ${error.message}`);
    process.exit(2);
  }
}

function readCargoPackageVersion(text) {
  // 只取 [package] 段里的第一个 version，避免命中 [dependencies.*] 的 version
  const packageSection = text.split(/^\[/m).find((section) => section.startsWith("package]"));
  if (!packageSection) return undefined;
  const match = packageSection.match(/^\s*version\s*=\s*"([^"]+)"/m);
  return match?.[1];
}

const packageJson = await readJson("package.json");
const tauriConf = await readJson(path.join("src-tauri", "tauri.conf.json"));
const cargoVersion = readCargoPackageVersion(await readText(path.join("src-tauri", "Cargo.toml")));

// Tauri 2 配置里版本号字段就是顶层 "version"
const npmVersion = packageJson.version;
const tauriVersion = tauriConf.version;

const sources = [
  ["package.json                ", npmVersion],
  ["src-tauri/tauri.conf.json   ", tauriVersion],
  ["src-tauri/Cargo.toml        ", cargoVersion],
];

const missing = sources.filter(([, version]) => !version).map(([label]) => label.trim());
if (missing.length > 0) {
  console.error(
    `[check:version] 缺少版本号字段: ${missing.join(", ")}\n` +
      sources.map(([label, version]) => `  ${label} version = ${version ?? "<missing>"}`).join("\n"),
  );
  process.exit(1);
}

const distinct = [...new Set(sources.map(([, version]) => version))];
if (distinct.length > 1) {
  console.error(
    `[check:version] 版本号不一致:\n` +
      sources.map(([label, version]) => `  ${label} version = ${version}`).join("\n") +
      `\n请将三处版本号同步后再发布。`,
  );
  process.exit(1);
}

console.log(
  `[check:version] OK: package.json / tauri.conf.json / Cargo.toml 版本均为 ${npmVersion}`,
);
