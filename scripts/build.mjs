import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const BUILD_DIR = path.join(ROOT, ".build");
const CLEAN_ONLY = process.argv.includes("--clean");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      shell: false
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(" ")}`));
    });
  });
}

function shouldCopyAsset(src) {
  return !src.endsWith(".ts");
}

async function copyDir(relPath) {
  const from = path.join(ROOT, relPath);
  const to = path.join(BUILD_DIR, relPath);
  await cp(from, to, { recursive: true, filter: shouldCopyAsset });
}

async function clean() {
  await rm(BUILD_DIR, { recursive: true, force: true });
}

async function main() {
  await clean();
  if (CLEAN_ONLY) return;

  const tscBin = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  await run(process.execPath, [tscBin, "-p", "tsconfig.json"]);

  await Promise.all([copyDir("ui"), copyDir("browser-extension"), copyDir("landing")]);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
