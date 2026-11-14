/* Shared Playwright harness: static server, route mocks, page opener. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_REQUIRE || "playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const webRoot = path.join(root, "hum-likhari-frontend");
const mockJs = fs.readFileSync(path.join(here, "mock-backend.js"), "utf8");
export const stubJs = fs.readFileSync(path.join(here, "supabase-stub.js"), "utf8");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = path.join(webRoot, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(webRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
export const base = "http://127.0.0.1:" + server.address().port;

export const browser = await chromium.launch();

export async function open(cfg, hash, ctxOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 820 }, locale: "ur-PK" }, ctxOpts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push("console: " + m.text()); });
  await page.addInitScript((c) => { window.__mockConfig = c; }, cfg || {});
  await page.route("**/js/vendor/supabase-adapter.js", (route) => route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(webRoot, "js/vendor/supabase-adapter.js"), "utf8") + "\n" + mockJs }));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({ contentType: "text/javascript", body: stubJs }));
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  await page.route("**/config.js", (route) => route.fulfill({ contentType: "text/javascript", body: 'window.HL_BACKEND_CONFIG={url:"https://example.supabase.co",publishableKey:"sb_publishable_test"};' }));
  await page.route("https://example.supabase.co/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") }));
  await page.goto(base + "/" + (hash || ""));
  await page.waitForFunction(() => typeof S !== "undefined" && S.booted && document.querySelector("#screen").innerHTML.length > 20);
  page.errors = errors;
  page.ctx = ctx;
  return page;
}
export const closeAll = async () => { await browser.close(); server.close(); };
