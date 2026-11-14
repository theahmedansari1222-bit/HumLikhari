import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root,p),"utf8");

test("all main workspaces are present", () => {
  for (const p of ["hum-likhari-frontend/index.html","hum-likhari-backend/supabase/config.toml","admin/index.html","integration/smoke-test.html","README.md"]) {
    assert.ok(fs.existsSync(path.join(root,p)), `${p} should exist`);
  }
});

test("all added operational tables have RLS enabled", () => {
  const sql = read("hum-likhari-backend/supabase/migrations/20261111000000_operations_and_growth.sql");
  for (const table of ["staff_audit_log","push_devices","push_deliveries","feedback_ticket_messages","volunteer_applications","badge_applications","platform_donation_intents"]) {
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`,"i"),`${table} should have RLS`);
  }
});

test("browser integration exposes feature APIs", () => {
  const js = read("hum-likhari-backend/integration/supabase-adapter.js");
  for (const api of ["team:","badges:","platformDonations:","push:","admin:","ticketMessages:"]) assert.ok(js.includes(api),`${api} should be available`);
});

const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test("server-only secrets are not in the web app, admin panel or smoke test", () => {
  const browserFiles = [...walk("hum-likhari-frontend"), ...walk("admin"), "integration/smoke-test.js", "integration/smoke-test.html", "hum-likhari-backend/integration/supabase-adapter.js"]
    .filter((p) => /\.(js|html)$/.test(p));
  assert.ok(browserFiles.length > 20, "scan should cover the whole frontend");
  for (const p of browserFiles) {
    assert.doesNotMatch(read(p), /SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]{10,}|service_role/i, p);
  }
});

test("platform donation flow is a manual Pakistan pilot, not claimed as gateway payment", () => {
  const sql=read("hum-likhari-backend/supabase/migrations/20261111000000_operations_and_growth.sql");
  const readme=read("hum-likhari-backend/README.md");
  assert.match(sql,/claimed_country_code text not null default 'PK' check \(claimed_country_code = 'PK'\)/);
  assert.match(readme,/payment gateway|رقم منتقل نہیں/);
});

test("push dispatcher authorises in code (admin session or scheduler secret) and is service-account based", () => {
  const config=read("hum-likhari-backend/supabase/config.toml");
  const fn=read("hum-likhari-backend/supabase/functions/push-dispatch/index.ts");
  assert.match(config,/\[functions\.push-dispatch\][^\[]*verify_jwt\s*=\s*false/);
  assert.match(fn,/FCM_SERVICE_ACCOUNT_JSON/);
  assert.match(fn,/is_admin/);
  assert.match(fn,/x-dispatch-secret/);
  assert.match(fn,/safeEqual/, "secret comparison must be constant-time");
  assert.match(fn,/dispatchSecret\.length >= 24/, "a short/empty secret must never authorise");
  assert.match(fn,/next_attempt_at/, "rows are claimed with a lease so overlapping runs cannot double-send");
});

test("browser adapter copies are identical and expose the v2 groups the UI uses", () => {
  const a=read("hum-likhari-backend/integration/supabase-adapter.js");
  assert.equal(a, read("hum-likhari-frontend/js/vendor/supabase-adapter.js"));
  for (const group of ["auth:","profiles:","posts:","social:","comments:","notifications:","feedback:","onboarding:","push:"]) assert.ok(a.includes(group), group);
});

test("account deletion requires a recent login computed from amr/last_sign_in_at (Supabase tokens have no auth_time)", () => {
  const fn=read("hum-likhari-backend/supabase/functions/delete-account/index.ts");
  assert.match(fn,/lastAuthenticatedAt/);
  assert.match(fn,/recent_login_required/);
  assert.match(read("hum-likhari-backend/supabase/functions/_shared/freshness.ts"),/amr/);
});

test("admin console never writes review stamps and offers the platform donation accounts editor", () => {
  const js=read("admin/admin.js");
  assert.doesNotMatch(js,/reviewed_by\s*:/);
  assert.match(js,/platform_donation_accounts/);
  assert.match(js,/acquisition_source_counts/);
});

test("every data-act in the admin console has a handler", () => {
  const src=read("admin/admin.js")+read("admin/index.html");
  const used=new Set([...src.matchAll(/data-act="([a-z-]+)"/g)].map((m)=>m[1]));
  const handlers=new Set([...src.matchAll(/^\s+(?:async )?"?([a-z-]+)"?\(\w*\) \{/gm)].map((m)=>m[1]));
  for (const name of used) assert.ok(handlers.has(name), name);
});
