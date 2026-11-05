// Builds the slim SWA deploy package into THIS folder (api/scripts), which is the SWA `apiLocation`.
// Run with cwd anywhere: `node api/scripts/build-deploy.mjs` or `node build-deploy.mjs` from api/scripts.
// Each function entry (src/functions/*.ts) is bundled with its dependencies into dist/src/functions/*.js,
// so the package needs no node_modules. Generated output is git-ignored (see .gitignore).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const api = resolve(here, "..");
const pkg = JSON.parse(readFileSync(join(api, "package.json"), "utf8"));

// Type-check first (esbuild does not); tsc output goes to api/dist, which is also git-ignored.
execFileSync(process.execPath, [join(api, "node_modules", "typescript", "bin", "tsc"), "-p", join(api, "tsconfig.json"), "--noEmit"], {
  cwd: api,
  stdio: "inherit",
});

rmSync(join(here, "dist"), { recursive: true, force: true });
const fnDir = join(api, "src", "functions");
const entryPoints = readdirSync(fnDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => join(fnDir, f));

await build({
  entryPoints,
  outdir: join(here, "dist", "src", "functions"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  // Provided by the Functions host at runtime (and optional native driver of mssql).
  external: ["@azure/functions-core", "msnodesqlv8", "msnodesqlv8/*"],
  logLevel: "info",
});

cpSync(join(api, "host.json"), join(here, "host.json"));
mkdirSync(here, { recursive: true });
writeFileSync(
  join(here, "package.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, private: true, main: "dist/src/functions/*.js", engines: pkg.engines },
    null,
    2,
  ) + "\n",
);
console.log("Deploy package ready in " + here);
