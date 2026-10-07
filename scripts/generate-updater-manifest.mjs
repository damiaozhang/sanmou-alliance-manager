import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const defaultBundleDir = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
);
const bundleDir = process.env.SMDC_RELEASE_BUNDLE_DIR || defaultBundleDir;
// 默认托管到 GitHub Releases：发布时把 latest.json、安装包、.sig 上传到
// 对应 v<version> tag 的 release；tauri.conf.json 的 updater endpoint 指向
// releases/latest/download/latest.json。可用 SMDC_RELEASE_BASE_URL 覆盖。
const baseUrl =
  process.env.SMDC_RELEASE_BASE_URL ||
  "https://github.com/damiaozhang/sanmou-alliance-manager/releases/download";

const packageJson = JSON.parse(
  await readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const version = packageJson.version;
const releaseBaseUrl = `${baseUrl.replace(/\/$/, "")}/v${version}`;

const entries = await readdir(bundleDir);
const installerName = entries.find(
  (name) =>
    name === `sanmou-alliance-manager_${version}_x64-setup.exe` ||
    (name.endsWith("_x64-setup.exe") && name.includes(`_${version}_`)),
);

if (!installerName) {
  throw new Error(
    `Cannot find Windows x64 NSIS installer for version ${version} in ${bundleDir}`,
  );
}

const signaturePath = path.join(bundleDir, `${installerName}.sig`);
const signature = (await readFile(signaturePath, "utf8")).trim();

if (!signature) {
  throw new Error(`Updater signature file is empty: ${signaturePath}`);
}

const manifest = {
  version,
  notes: "Sanmou Alliance Manager Windows release.",
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `${releaseBaseUrl}/${encodeURIComponent(installerName)}`,
    },
  },
};

const outputPath = path.join(bundleDir, "latest.json");
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Generated updater manifest: ${outputPath}`);
