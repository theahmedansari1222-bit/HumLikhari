// Run with: node --experimental-strip-types tests/freshness.test.mjs
import assert from "node:assert/strict";
import { lastAuthenticatedAt } from "../hum-likhari-backend/supabase/functions/_shared/freshness.ts";

const now = Math.floor(Date.now() / 1000);
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("ok -", name); };

t("returns null when nothing is known (must never count as a fresh login)", () => {
  assert.equal(lastAuthenticatedAt({}, null), null);
  assert.equal(lastAuthenticatedAt(null, undefined), null);
  assert.equal(lastAuthenticatedAt({ amr: [] }, ""), null);
});
t("uses the newest amr timestamp (Supabase tokens carry no auth_time)", () => {
  assert.equal(lastAuthenticatedAt({ amr: [{ method: "otp", timestamp: now - 900 }, { method: "oauth", timestamp: now - 30 }] }, null), now - 30);
});
t("falls back to last_sign_in_at", () => {
  const iso = new Date((now - 120) * 1000).toISOString();
  assert.equal(Math.round(lastAuthenticatedAt({}, iso)), now - 120);
});
t("takes the maximum of every source", () => {
  const iso = new Date((now - 600) * 1000).toISOString();
  assert.equal(lastAuthenticatedAt({ amr: [{ timestamp: now - 5000 }], auth_time: now - 3000 }, iso), now - 600);
});
t("ignores junk values", () => {
  assert.equal(lastAuthenticatedAt({ amr: [{ timestamp: "x" }, null, {}, { timestamp: -4 }], auth_time: "nope" }, "not a date"), null);
  assert.equal(lastAuthenticatedAt({ amr: "oops" }, null), null);
});
t("a refreshed token alone does not make a stale session fresh", () => {
  // `iat`/`exp` change on refresh; they must not influence the result.
  assert.equal(lastAuthenticatedAt({ iat: now, exp: now + 3600, amr: [{ timestamp: now - 86400 }] }, null), now - 86400);
});
console.log(`${passed} freshness tests passed`);
