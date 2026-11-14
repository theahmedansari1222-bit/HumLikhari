import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipDirs = new Set([".git", "node_modules", ".supabase"]);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name)); }
    else files.push(path.join(dir, entry.name));
  }
}
walk(root);
let errors = 0;
for (const file of files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    errors++;
    process.stderr.write(`SYNTAX ERROR: ${path.relative(root,file)}\n${result.stderr}\n`);
  }
}
for (const file of files.filter((f) => f.endsWith(".json"))) {
  try { JSON.parse(fs.readFileSync(file,"utf8")); }
  catch (error) { errors++; process.stderr.write(`JSON ERROR: ${path.relative(root,file)}: ${error.message}\n`); }
}
const migrations = files.filter((f) => f.endsWith(".sql") && f.includes(`${path.sep}migrations${path.sep}`));
for (const file of migrations) {
  const sql = fs.readFileSync(file,"utf8");
  if (!/^begin;/im.test(sql) || !/commit;\s*$/im.test(sql)) {
    errors++; process.stderr.write(`MIGRATION TRANSACTION MARKER MISSING: ${path.relative(root,file)}\n`);
  }
}
for (const file of files.filter((f) => f.includes(`${path.sep}hum-likhari-frontend${path.sep}`) || f.includes(`${path.sep}admin${path.sep}`))) {
  if (!file.endsWith(".js") && !file.endsWith(".html")) continue;
  const text = fs.readFileSync(file,"utf8");
  if (/service_role|sb_secret_[A-Za-z0-9_-]{10,}|SUPABASE_SERVICE_ROLE_KEY/i.test(text)) {
    errors++; process.stderr.write(`POSSIBLE SERVER SECRET IN BROWSER FILE: ${path.relative(root,file)}\n`);
  }
}

// ---- structural checks specific to this platform ----------------------------------------------------------
const rel = (f) => path.relative(root, f);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const fail = (msg) => { errors++; process.stderr.write(msg + "\n"); };

// 1. The two copies of the browser adapter must be byte-identical.
const adapterA = read("hum-likhari-backend/integration/supabase-adapter.js");
const adapterB = read("hum-likhari-frontend/js/vendor/supabase-adapter.js");
if (adapterA !== adapterB) fail("ADAPTER COPIES DIFFER: hum-likhari-backend/integration/supabase-adapter.js vs hum-likhari-frontend/js/vendor/supabase-adapter.js (copy the backend one over the frontend one)");

// 2. No demo data may ship in the production frontend.
const demoMarkers = /DEMO_POSTS|SAMPLE_POSTS|const\s+POSTS\s*=|mockPosts|faker\./;
for (const f of files.filter((f) => f.includes(`${path.sep}hum-likhari-frontend${path.sep}js${path.sep}`) && f.endsWith(".js"))) {
  if (demoMarkers.test(fs.readFileSync(f, "utf8"))) fail(`DEMO DATA MARKER IN PRODUCTION FRONTEND: ${rel(f)}`);
}

// 3. Every data-a / data-act used in markup must have a registered handler (frontend: ACT.x, admin: ACTIONS).
const frontendJs = files.filter((f) => f.includes(`${path.sep}hum-likhari-frontend${path.sep}js${path.sep}`) && f.endsWith(".js")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
const usedA = new Set([...frontendJs.matchAll(/data-a="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
const definedA = new Set([...frontendJs.matchAll(/\bACT\.([A-Za-z0-9_]+)\s*=/g)].map((m) => m[1]));
// handlers registered through Object.assign(ACT, { key: ..., key2: ... }) — keys sit at two-space indentation (house style)
for (const block of frontendJs.matchAll(/Object\.assign\(ACT, \{\n([\s\S]*?)\n\}\);/g)) {
  for (const m of block[1].matchAll(/^  (?:async )?([A-Za-z0-9_]+)\s*[:(]/gm)) definedA.add(m[1]);
}
for (const name of usedA) if (!definedA.has(name)) fail(`FRONTEND data-a="${name}" HAS NO ACT HANDLER`);

// 4. Browser-facing HTML must carry a CSP and must not use inline event handlers.
for (const f of ["hum-likhari-frontend/index.html", "admin/index.html"]) {
  const html = read(f);
  if (!/Content-Security-Policy/i.test(html)) fail(`MISSING CSP META: ${f}`);
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) fail(`INLINE EVENT HANDLER IN ${f}`);
}

// 5. One supabase-js version everywhere (browser pages and Edge Functions), and never an unpinned one.
const versions = new Set();
for (const f of files.filter((f) => /\.(html|json|ts)$/.test(f) && !f.includes("node_modules"))) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/supabase-js@(\d+\.\d+\.\d+|[^/"\s]*)/g)) {
    if (!/^\d+\.\d+\.\d+$/.test(m[1])) fail(`UNPINNED supabase-js VERSION in ${rel(f)}: ${m[1]}`);
    versions.add(m[1]);
  }
}
if (versions.size > 1) fail(`MULTIPLE supabase-js VERSIONS: ${[...versions].join(", ")}`);

// 6. Edge Functions: shared CORS helper, no wildcard origin, push-dispatch authorises in code.
for (const fn of ["delete-account", "manage-user-role", "push-dispatch"]) {
  const src = read(`hum-likhari-backend/supabase/functions/${fn}/index.ts`);
  if (!src.includes("../_shared/http.ts")) fail(`EDGE FUNCTION ${fn} DOES NOT USE THE SHARED CORS HELPER`);
  if (/Access-Control-Allow-Origin["']?\s*:\s*["']\*/.test(src)) fail(`WILDCARD CORS IN ${fn}`);
}
if (!/\[functions\.push-dispatch\][^\[]*verify_jwt\s*=\s*false/.test(read("hum-likhari-backend/supabase/config.toml"))) fail("push-dispatch must set verify_jwt = false (it authorises in code: admin session or x-dispatch-secret)");
if (!/x-dispatch-secret/.test(read("hum-likhari-backend/supabase/functions/push-dispatch/index.ts"))) fail("push-dispatch lost its scheduler-secret check");

// 7. Config files shipped to browsers must hold placeholders only.
for (const f of ["hum-likhari-frontend/config.js", "admin/config.js"]) {
  if (/https:\/\/[a-z0-9]{15,}\.supabase\.co|sb_publishable_[A-Za-z0-9_-]{20,}/.test(read(f))) fail(`REAL PROJECT KEYS COMMITTED IN ${f}`);
}

if (errors) process.exit(1);
console.log(`Static validation passed: ${files.length} files scanned; ${migrations.length} SQL migrations checked.`);
