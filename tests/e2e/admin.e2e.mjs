/* End-to-end test of the staff console (admin/) against an in-memory stand-in for supabase-js (admin-mock.js).
 * Run: node tests/e2e/admin.e2e.mjs   (needs Playwright + Chromium; set PLAYWRIGHT_REQUIRE if not globally resolvable) */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_REQUIRE || "playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, "../../admin");
const mockJs = fs.readFileSync(path.join(here, "admin-mock.js"), "utf8");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = path.join(adminRoot, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(adminRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();

const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
const SARA = id(22), AHMED = id(21), BILAL = id(23);
const tables = () => ({
  profiles: [
    { id: AHMED, username: "ahmed", display_name: "احمد", country_code: "PK", is_active: true, created_at: iso(30) },
    { id: SARA, username: "sara", display_name: "سارہ", country_code: "PK", is_active: true, created_at: iso(20) },
    { id: BILAL, username: "bilal", display_name: "بلال", country_code: "AE", is_active: false, created_at: iso(10) },
  ],
  posts: [{ id: id(31), title: "ایک نظم", status: "published" }, { id: id(32), title: "دوسری", status: "published" }],
  comments: [{ id: id(41), body: "تبصرہ", status: "published" }],
  content_reports: [
    { id: id(51), target_type: "post", post_id: id(31), reason: "spam", details: "<img src=x onerror=\"window.__pwn=1\"> اشتہار", status: "received", staff_note: "", created_at: iso(5) },
    { id: id(52), target_type: "user", reported_user_id: SARA, reason: "harassment", details: "تنگ کرتی ہے", status: "received", staff_note: "", created_at: iso(6) },
    { id: id(53), target_type: "comment", comment_id: id(41), reason: "other", details: "ٹھیک ہے", status: "in_review", staff_note: "دیکھ رہے ہیں", created_at: iso(7) },
  ],
  feedback_tickets: [{ id: id(61), ticket_number: "HL-0001", feedback_type: "bug", message: "ایپ رک جاتی ہے", user_id: AHMED, status: "received", staff_reply: "", created_at: iso(50) }],
  feedback_ticket_messages: [
    { id: id(71), ticket_id: id(61), author_id: AHMED, message: "ایپ رک جاتی ہے", is_internal: false, created_at: iso(49) },
    { id: id(72), ticket_id: id(61), author_id: id(1), message: "اندرونی: لاگ دیکھو", is_internal: true, created_at: iso(48) },
  ],
  volunteer_applications: [{ id: id(81), applicant_id: SARA, team_area: "proofreading", skills: "پروف", availability: "شام", motivation: "شوق", status: "received", staff_note: "", created_at: iso(70) }],
  badge_applications: [{ id: id(91), user_id: SARA, badge_type: "consistent_writer", portfolio_note: "بہت کچھ", status: "received", staff_note: "", created_at: iso(80) }],
  writer_badges: [],
  platform_donation_intents: [{ id: id(101), donor_id: BILAL, amount: 500, currency: "PKR", method: "jazzcash", transaction_reference: "TX1", status: "submitted", staff_note: "", created_at: iso(90) }],
  platform_donation_accounts: [{ id: id(111), method: "jazzcash", label: "مرکزی", bank_name: null, account_title: "ہم لکھاری", account_identifier: "03001234567", instructions: "", is_active: true, sort_order: 0, created_at: iso(100) }],
  onboarding_surveys: [{ source: "facebook" }, { source: "facebook" }, { source: "facebook" }, { source: "instagram" }],
  push_deliveries: [
    { id: id(121), status: "pending", attempts: 0, last_error: null, updated_at: iso(1) }, { id: id(122), status: "pending", attempts: 0, last_error: null, updated_at: iso(1) },
    { id: id(123), status: "failed", attempts: 2, last_error: "UNAVAILABLE", updated_at: iso(2) },
    ...Array.from({ length: 5 }, (_, i) => ({ id: id(130 + i), status: "sent", attempts: 1, last_error: null, updated_at: iso(3) })),
  ],
  staff_audit_log: Array.from({ length: 120 }, (_, i) => ({ id: id(200 + i), actor_id: id(1), action: "status_changed", entity_type: "posts", entity_id: id(31), details: { n: i }, created_at: iso(i + 1) })),
});

const results = [];
let failed = 0;
const assert = (cond, msg) => { if (!cond) throw new Error("assertion failed: " + msg); };
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch((e) => { throw new Error("waiting for " + (typeof arg === "string" ? JSON.stringify(arg) : fn.toString().slice(0, 120)) + " :: " + e.message.split("\n")[0]); });
const settle = (page) => wait(page, () => !document.querySelector("#app").classList.contains("hidden") && !document.querySelector("#content").textContent.includes("لوڈ ہو رہا ہے"));
const said = (page, s) => wait(page, (x) => document.querySelector("#globalMessage").textContent.includes(x), s);
const section = async (page, label) => { await page.click(`#nav button:text-is("${label}")`); await wait(page, (l) => document.querySelector("#sectionTitle").textContent === l && !document.querySelector("#content").textContent.includes("لوڈ ہو رہا ہے"), label); };
const log = (page, pred) => page.evaluate((p) => window.__log.filter(new Function("e", "return " + p)), pred);
const navLabels = (page) => page.$$eval("#nav button", (b) => b.map((x) => x.textContent.trim()));

async function open(mock = {}, { config, hash = "", clock = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "ur-PK" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  if (clock) await page.clock.install();
  await page.addInitScript((m) => { window.__adminMock = m; }, Object.assign({ tables: tables(), roles: { admin: true } }, mock));
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: mockJs }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await page.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.HL_ADMIN_CONFIG=${JSON.stringify(config || { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" })};` }));
  await page.goto(base + "/" + hash);
  page.errors = errors; page.ctx = ctx;
  return page;
}
async function run(name, body) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const started = Date.now();
  let page;
  try {
    await body((p) => (page = p));
    const errs = page ? page.errors.slice() : [];
    if (errs.length) throw new Error("browser errors: " + errs.join(" | "));
    results.push(["ok", name]); console.log("  ✓ " + name + " (" + (Date.now() - started) + "ms)");
  } catch (e) {
    failed++; results.push(["FAIL", name]);
    console.log("  ✗ " + name + "\n      " + e.message.split("\n").slice(0, 3).join(" ").slice(0, 400));
  } finally { if (page) await page.ctx.close(); }
}
const staff = async (set, mock, o) => { const page = await open(mock, o); set(page); await settle(page); return page; };

/* ---------------------------------------------------------------- */
await run("placeholder config shows the setup panel and never contacts a backend", async (set) => {
  const page = await open({}, { config: { url: "https://YOUR_PROJECT_REF.supabase.co", publishableKey: "sb_publishable_REPLACE_ME" } }); set(page);
  await wait(page, () => !document.querySelector("#setup").classList.contains("hidden"));
  assert(await page.evaluate(() => !window.__clientArgs), "createClient must not be called with placeholder keys");
});

await run("login: phone format is validated, OTP flow reaches the auth API, Google redirect has no hash", async (set) => {
  const page = await open({ signedIn: false }, { hash: "#sensitive-fragment" }); set(page);
  await wait(page, () => !document.querySelector("#login").classList.contains("hidden"));
  await page.fill("#phone", "0300123"); await page.click("#sendOtp");
  await said(page, "بین الاقوامی");
  await page.fill("#phone", "+923001234567"); await page.click("#sendOtp");
  await wait(page, () => document.querySelector("#loginMessage").textContent.includes("کوڈ"));
  await page.fill("#otp", "12"); await page.click("#verifyOtp"); await said(page, "6 ہندسوں");
  await page.fill("#otp", "123456"); await page.click("#verifyOtp");
  await wait(page, () => window.__log.some((e) => e.auth === "verify"));
  const verify = (await log(page, "e.auth==='verify'"))[0];
  assert(verify.a.phone === "+923001234567" && verify.a.token === "123456" && verify.a.type === "sms", "verifyOtp payload");
  await page.click("#googleLogin"); await wait(page, () => window.__log.some((e) => e.auth === "oauth"));
  const oauth = (await log(page, "e.auth==='oauth'"))[0];
  assert(oauth.a.options.redirectTo === base + "/", "redirectTo must be origin+path only, got " + oauth.a.options.redirectTo);
  assert((await page.evaluate(() => window.__clientArgs.o.auth.flowType)) === "pkce", "PKCE flow");
});

await run("a signed-in non-staff account is denied and sees no console", async (set) => {
  const page = await open({ roles: {} }); set(page);
  await wait(page, () => !document.querySelector("#denied").classList.contains("hidden"));
  assert(await page.locator("#app").isHidden(), "app hidden");
  assert((await page.locator("#nav button").count()) === 0, "no navigation");
});

await run("admin: all sections, overview counts link to the right section", async (set) => {
  const page = await staff(set);
  assert((await navLabels(page)).length === 11, "admin sees 11 sections: " + (await navLabels(page)).length);
  const metric = page.locator(".metric", { hasText: "نئی رپورٹس" });
  assert((await metric.locator("strong").innerText()).trim() === "2", "two received reports");
  await metric.click();
  await wait(page, () => document.querySelector("#sectionTitle").textContent === "رپورٹس");
});

await run("reports: filter, hostile text stays inert, save sends only status+note, hide post marks report", async (set) => {
  const page = await staff(set);
  await section(page, "رپورٹس");
  assert((await page.locator("#content tbody tr").count()) === 3, "three reports");
  assert(await page.evaluate(() => !window.__pwn), "report details must not execute");
  assert((await page.locator("#content").innerText()).includes("<img src=x onerror="), "details displayed as text");
  assert((await page.locator("#content").innerText()).includes("ایک نظم"), "post title preview");
  await page.selectOption('[data-act="filter"]', "in_review");
  await wait(page, () => document.querySelectorAll("#content tbody tr").length === 1);
  await page.selectOption('[data-act="filter"]', "");
  await wait(page, () => document.querySelectorAll("#content tbody tr").length === 3);
  const row = page.locator("tbody tr", { hasText: "اشتہار" });
  await row.locator("select[data-report-status]").selectOption("in_review");
  await row.locator("textarea").fill("جانچ جاری");
  await row.locator('[data-act="save-report"]').click();
  await said(page, "اپ ڈیٹ ہو گئی");
  const saved = (await log(page, "e.table==='content_reports'&&e.op==='update'"))[0];
  assert(JSON.stringify(Object.keys(saved.patch).sort()) === '["staff_note","status"]', "only status/staff_note may be written: " + Object.keys(saved.patch));
  assert(saved.eqs[0][1] === id(51), "update must target the report id");
  await page.locator("tbody tr", { hasText: "اشتہار" }).locator('[data-act="hide-target"]').click();
  await said(page, "کارروائی لاگو");
  const post = (await log(page, "e.table==='posts'&&e.op==='update'"))[0];
  assert(post.patch.status === "removed" && post.eqs[0][1] === id(31), "post must be removed by id");
  const closed = (await log(page, "e.table==='content_reports'&&e.op==='update'")).pop();
  assert(closed.patch.status === "action_taken", "report closed automatically");
});

await run("reports: hiding a reported user deactivates the profile; a database denial is explained", async (set) => {
  const page = await staff(set, { denyWrites: [] });
  await section(page, "رپورٹس");
  await page.locator("tbody tr", { hasText: "تنگ کرتی" }).locator('[data-act="hide-target"]').click();
  await said(page, "کارروائی لاگو");
  const prof = (await log(page, "e.table==='profiles'&&e.op==='update'"))[0];
  assert(prof.patch.is_active === false && prof.eqs[0][1] === SARA, "profile deactivated");
  const denied = await staff(set, { denyWrites: ["content_reports:update"] });
  await section(denied, "رپورٹس");
  await denied.locator("tbody tr").first().locator('[data-act="save-report"]').click();
  await said(denied, "اجازت نہیں");
  await denied.ctx.close();
});

await run("feedback: thread rendered, public reply sets staff_reply, internal note does not", async (set) => {
  const page = await staff(set);
  await section(page, "صارفین کی رائے");
  assert((await page.locator(".bubble").count()) === 2 && (await page.locator(".bubble.internal").count()) === 1, "thread with one internal bubble");
  await page.fill("[data-ticket-reply]", "شکریہ، ہم دیکھ رہے ہیں");
  await page.selectOption("[data-ticket-status]", "in_review");
  await page.click('[data-act="save-ticket"]'); await said(page, "ٹکٹ اپ ڈیٹ");
  const msg = (await log(page, "e.table==='feedback_ticket_messages'&&e.op==='insert'"))[0];
  assert(msg.patch.is_internal === false && msg.patch.message.startsWith("شکریہ") && msg.patch.ticket_id === id(61), "public message insert");
  let upd = (await log(page, "e.table==='feedback_tickets'&&e.op==='update'")).pop();
  assert(upd.patch.status === "in_review" && upd.patch.staff_reply && upd.patch.assigned_to, "ticket patch: " + JSON.stringify(upd.patch));
  await page.fill("[data-ticket-reply]", "اندرونی نوٹ"); await page.check("[data-ticket-internal]");
  await page.click('[data-act="save-ticket"]'); await wait(page, () => window.__log.filter((e) => e.table === "feedback_ticket_messages").length === 2);
  upd = (await log(page, "e.table==='feedback_tickets'&&e.op==='update'")).pop();
  assert(!("staff_reply" in upd.patch), "internal note must never be copied into staff_reply");
  const internal = (await log(page, "e.table==='feedback_ticket_messages'")).pop();
  assert(internal.patch.is_internal === true, "internal flag stored");
});

await run("team / badge / donation reviews never send reviewed_by (the database stamps it)", async (set) => {
  const page = await staff(set);
  await section(page, "ٹیم درخواستیں");
  await page.selectOption("[data-vol-status]", "accepted"); await page.fill("[data-vol-note]", "خوش آمدید");
  await page.click('[data-act="save-vol"]'); await said(page, "ٹیم درخواست");
  await section(page, "Blue Tick درخواستیں");
  await page.click('[data-act="review-badge"][data-decision="approved"]'); await said(page, "بیج درخواست");
  assert((await log(page, "e.rpc==='review_badge_application'"))[0].args.p_decision === "approved", "RPC decision");
  await section(page, "پلیٹ فارم معاونت");
  await page.selectOption("[data-donation-status]", "confirmed");
  await page.click('[data-act="save-donation"]'); await said(page, "معاونت کی درخواست");
  for (const t of ["volunteer_applications", "platform_donation_intents"]) {
    const w = (await log(page, `e.table==='${t}'&&e.op==='update'`))[0];
    assert(!("reviewed_by" in w.patch) && !("reviewed_at" in w.patch), t + " patch must not contain review stamps: " + JSON.stringify(w.patch));
  }
});

await run("platform donation accounts: validation, add, edit, delete", async (set) => {
  const page = await staff(set);
  await section(page, "معاونت کے اکاؤنٹس");
  assert((await page.locator("[data-account]").count()) === 2, "one existing + one blank form");
  const f = (name) => `[data-account="new"] [data-f="${name}"]`;
  await page.selectOption(f("method"), "bank_transfer"); await page.fill(f("account_title"), "ہم لکھاری ٹرسٹ"); await page.fill(f("account_identifier"), "PK00BANK0000000000000000");
  await page.click('[data-act="save-account"][data-id="new"]'); await said(page, "بینک کا نام");
  assert((await log(page, "e.table==='platform_donation_accounts'")).length === 0, "nothing written when validation fails");
  await page.fill(f("bank_name"), "بینک الفلاح"); await page.click('[data-act="save-account"][data-id="new"]');
  await said(page, "نیا اکاؤنٹ شامل");
  const ins = (await log(page, "e.table==='platform_donation_accounts'&&e.op==='insert'"))[0];
  assert(ins.patch.method === "bank_transfer" && ins.patch.bank_name === "بینک الفلاح" && ins.patch.is_active === true && ins.patch.sort_order === 0, "insert payload " + JSON.stringify(ins.patch));
  assert((await page.locator("[data-account]").count()) === 3, "list refreshed");
  const first = `[data-account="${id(111)}"]`;
  await page.fill(`${first} [data-f="label"]`, "نیا نام"); await page.uncheck(`${first} [data-f="is_active"]`);
  await page.click(`${first} [data-act="save-account"]`); await said(page, "اکاؤنٹ محفوظ");
  const upd = (await log(page, "e.table==='platform_donation_accounts'&&e.op==='update'"))[0];
  assert(upd.patch.label === "نیا نام" && upd.patch.is_active === false && upd.eqs[0][1] === id(111), "update payload");
  await page.click(`${first} [data-act="delete-account"]`); await said(page, "حذف ہو گیا");
  assert((await page.locator("[data-account]").count()) === 2, "deleted row gone");
});

await run("users: search is sanitised, role grant resolves handle to id, errors are readable", async (set) => {
  const page = await staff(set);
  await section(page, "صارفین");
  await page.fill("#userSearch", "sa"); await page.press("#userSearch", "Enter");
  await wait(page, () => document.querySelectorAll("#content tbody tr").length === 1);
  await page.fill("#userSearch", 'x,id.eq.1) or (a"b'); await page.click('[data-act="search-users"]');
  await wait(page, () => window.__log.some((e) => e.ors && e.ors[0].includes("x id.eq.1 or a b")));
  const exprs = (await log(page, "e.table==='profiles'&&e.ors")).map((e) => e.ors[0]);
  assert(exprs[0] === "username.ilike.%sa%,display_name.ilike.%sa%", "plain search expression: " + exprs[0]);
  assert(exprs[1] === "username.ilike.%x id.eq.1 or a b%,display_name.ilike.%x id.eq.1 or a b%", "filter-syntax characters stripped: " + exprs[1]);
  await page.click('[data-act="clear-search"]'); await wait(page, () => document.querySelectorAll("#content tbody tr").length === 3);
  await page.fill("#roleUser", "@SARA"); await page.selectOption("#roleName", "moderator");
  await page.click('[data-act="apply-role"]'); await said(page, "کردار تبدیل");
  const call = (await log(page, "e.fn==='manage-user-role'"))[0];
  assert(call.body.userId === SARA && call.body.role === "moderator" && call.body.operation === "grant", "role call " + JSON.stringify(call.body));
  await page.fill("#roleUser", "nobody"); await page.click('[data-act="apply-role"]'); await said(page, "نہیں ملا");
  await page.fill("#roleUser", BILAL); await page.selectOption("#roleOperation", "revoke"); await page.click('[data-act="apply-role"]');
  await wait(page, () => window.__log.filter((e) => e.fn === "manage-user-role").length === 2);
  assert((await log(page, "e.fn==='manage-user-role'"))[1].body.userId === BILAL, "UUID accepted directly");
  await page.click(`tr:has-text("بلال") [data-act="user-active"]`); await said(page, "صارف کی حالت");
  assert((await log(page, "e.table==='profiles'&&e.op==='update'"))[0].patch.is_active === true, "inactive user re-enabled");
  const bad = await staff(set, { fnError: { "manage-user-role": "admin_only" } });
  await section(bad, "صارفین"); await bad.fill("#roleUser", "ahmed"); await bad.click('[data-act="apply-role"]'); await said(bad, "صرف admin");
  await bad.ctx.close();
});

await run("acquisition uses the aggregate RPC with Urdu labels", async (set) => {
  const page = await staff(set);
  await section(page, "صارفین کہاں سے آئے؟");
  const text = await page.locator("#content").innerText();
  assert(text.includes("فیس بک") && text.includes("75%") && text.includes("25%"), "labels and shares: " + text.replace(/\s+/g, " ").slice(0, 200));
  assert((await log(page, "e.rpc==='acquisition_source_counts'")).length === 1, "RPC used instead of a capped table read");
});

await run("audit log paginates (50 per page) without skipping or repeating rows", async (set) => {
  const page = await staff(set);
  await section(page, "انتظامی ریکارڈ");
  const rows = () => page.locator("#content tbody tr").count();
  assert((await rows()) === 50, "page 1 has 50 rows");
  assert(await page.locator('[data-act="page"][data-dir="-1"]').isDisabled(), "no previous page on page 1");
  await page.click('[data-act="page"][data-dir="1"]'); await wait(page, () => document.querySelector(".pager span").textContent.includes("2"));
  await page.click('[data-act="page"][data-dir="1"]'); await wait(page, () => document.querySelector(".pager span").textContent.includes("3"));
  assert((await rows()) === 20, "last page has the remaining 20");
  assert(await page.locator('[data-act="page"][data-dir="1"]').isDisabled(), "no next page at the end");
});

await run("token refresh and repeated SIGNED_IN do not reload the page the staff member is typing in", async (set) => {
  const page = await staff(set);
  await section(page, "صارفین کی رائے");
  await page.fill("[data-ticket-reply]", "ادھورا جواب");
  await page.evaluate(() => { window.__fireAuth("TOKEN_REFRESHED"); window.__fireAuth("SIGNED_IN"); window.__fireAuth("USER_UPDATED"); });
  await page.waitForTimeout(250);
  assert((await page.inputValue("[data-ticket-reply]")) === "ادھورا جواب", "draft must survive auth events");
});

await run("moderator and support agent see only their own sections; support cannot edit donations", async (set) => {
  const mod = await staff(set, { roles: { moderator: true } });
  assert(JSON.stringify(await navLabels(mod)) === JSON.stringify(["جائزہ", "رپورٹس", "صارفین", "انتظامی ریکارڈ"]), "moderator nav " + (await navLabels(mod)));
  await section(mod, "صارفین");
  assert((await mod.locator("#roleUser").count()) === 0, "no role form for moderators");
  await mod.ctx.close();
  const sup = await staff(set, { roles: { support_agent: true } });
  assert((await navLabels(sup)).length === 6, "support nav " + (await navLabels(sup)));
  await section(sup, "پلیٹ فارم معاونت");
  assert((await sup.locator("[data-donation-status]").count()) === 0 && (await sup.locator("#content").innerText()).includes("صرف مشاہدہ"), "read-only donations");
});

await run("push: dispatch result and failures are shown; missing configuration is explained", async (set) => {
  const page = await staff(set);
  await section(page, "Push Notifications");
  assert((await page.locator(".metric strong").allInnerTexts()).join(",") === "2,1,5", "queue counts");
  assert((await page.locator("#content").innerText()).includes("UNAVAILABLE"), "recent failures listed");
  await page.click('[data-act="dispatch-push"]'); await said(page, "2 بھیجے");
  assert((await log(page, "e.fn==='push-dispatch'"))[0].body.limit === 100, "limit sent");
  const bad = await staff(set, { fnError: { "push-dispatch": "push_service_not_configured" } });
  await section(bad, "Push Notifications"); await bad.click('[data-act="dispatch-push"]'); await said(bad, "secrets");
  await bad.ctx.close();
});

await run("idle staff sessions are signed out after 30 minutes", async (set) => {
  const page = await open({}, { clock: true }); set(page);
  await settle(page);
  await page.clock.fastForward(31 * 60 * 1000);
  await wait(page, () => !document.querySelector("#login").classList.contains("hidden"));
  assert((await log(page, "e.auth==='signOut'")).length === 1, "signOut called once");
});

await run("every data-act the console renders has a handler", async (set) => {
  const page = await staff(set);
  const src = fs.readFileSync(path.join(adminRoot, "admin.js"), "utf8") + fs.readFileSync(path.join(adminRoot, "index.html"), "utf8");
  const used = new Set([...src.matchAll(/data-act="([a-z-]+)"/g)].map((m) => m[1]));
  const handlers = new Set([...src.matchAll(/^\s+(?:async )?"?([a-z-]+)"?\(\w*\) \{/gm)].map((m) => m[1]));
  const missing = [...used].filter((u) => !handlers.has(u));
  assert(!missing.length, "actions without a handler: " + missing.join(","));
});

await browser.close(); server.close();
console.log(`\n${results.length - failed}/${results.length} admin scenarios passed`);
process.exit(failed ? 1 : 0);
