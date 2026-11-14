/* Builds design/HumLikhari_admin_preview.html: ONE self-contained file that runs the real admin console (admin/admin.js + admin.css)
 * against the in-memory supabase stand-in with demo data, so the console can be reviewed as a design without any backend.
 * Role switch: open the file with ?role=admin | moderator | support_agent.
 * Run: node scripts/build-admin-preview.mjs   (re-run after any change in admin/ so the preview never drifts from the code) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const css = read("admin/admin.css");
const js = read("admin/admin.js");
const mock = read("tests/e2e/admin-mock.js");
// never let a script end the surrounding <script> element
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");

const demo = `
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const SARA = id(22), AHMED = id(21), BILAL = id(23), ALI = id(24);
return {
  profiles: [
    { id: AHMED, username: "imranahmad", display_name: "عمران احمد", country_code: "PK", is_active: true, created_at: ago(3000) },
    { id: SARA, username: "sarakhan", display_name: "سارہ خان", country_code: "PK", is_active: true, created_at: ago(2000) },
    { id: BILAL, username: "bilalahmad", display_name: "بلال احمد", country_code: "AE", is_active: false, created_at: ago(1000) },
    { id: ALI, username: "mohammadali", display_name: "محمد علی", country_code: "PK", is_active: true, created_at: ago(500) },
  ],
  posts: [{ id: id(31), title: "زندگی کی خوبصورتی", status: "published" }, { id: id(32), title: "ایک نظم", status: "published" }],
  comments: [{ id: id(41), body: "اپنی مصنوعات خریدیں!", status: "published" }],
  content_reports: [
    { id: id(51), target_type: "post", post_id: id(31), reason: "spam", details: "اشتہار جیسا مواد", status: "received", staff_note: "", created_at: ago(5) },
    { id: id(52), target_type: "user", reported_user_id: BILAL, reason: "harassment", details: "پیغامات میں تنگ کرتا ہے", status: "received", staff_note: "", created_at: ago(6) },
    { id: id(53), target_type: "comment", comment_id: id(41), reason: "spam", details: "", status: "in_review", staff_note: "دیکھ رہے ہیں", created_at: ago(7) },
  ],
  feedback_tickets: [
    { id: id(61), ticket_number: "HL-0001", feedback_type: "bug", message: "تصویر اپ لوڈ کرتے وقت ایپ رک جاتی ہے۔", user_id: AHMED, status: "in_review", staff_reply: "", created_at: ago(240) },
    { id: id(62), ticket_number: "HL-0002", feedback_type: "question", message: "ہینڈل کیسے بدلوں؟", user_id: SARA, status: "received", staff_reply: "", created_at: ago(60) },
  ],
  feedback_ticket_messages: [
    { id: id(71), ticket_id: id(61), author_id: AHMED, message: "تصویر اپ لوڈ کرتے وقت ایپ رک جاتی ہے۔", is_internal: false, created_at: ago(239) },
    { id: id(72), ticket_id: id(61), author_id: id(1), message: "اندرونی نوٹ: لاگ دیکھ کر بتائیں", is_internal: true, created_at: ago(200) },
  ],
  volunteer_applications: [{ id: id(81), applicant_id: SARA, team_area: "proofreading", skills: "پروف ریڈنگ کا تجربہ", availability: "شام کے اوقات", motivation: "اردو ادب سے محبت ہے اور مدد کرنا چاہتی ہوں۔", status: "received", staff_note: "", created_at: ago(700) }],
  badge_applications: [{ id: id(91), user_id: SARA, badge_type: "consistent_writer", portfolio_note: "پچھلے تین ماہ میں 20 تحریریں", status: "received", staff_note: "", created_at: ago(800) }],
  writer_badges: [{ id: id(95), user_id: ALI, badge_type: "featured_writer", is_active: true, created_at: ago(5000) }],
  platform_donation_intents: [{ id: id(101), donor_id: ALI, amount: 1500, currency: "PKR", method: "jazzcash", transaction_reference: "TX-0001", status: "submitted", staff_note: "", created_at: ago(90) }],
  platform_donation_accounts: [
    { id: id(111), method: "jazzcash", label: "ہم لکھاری", bank_name: null, account_title: "ہم لکھاری", account_identifier: "0300 0000000", instructions: "رقم بھیجنے کے بعد اطلاع ضرور درج کریں۔", is_active: true, sort_order: 0, created_at: ago(900) },
    { id: id(112), method: "bank_transfer", label: "", bank_name: "نمونہ بینک", account_title: "ہم لکھاری ٹرسٹ", account_identifier: "PK00 DEMO 0000 0000 0000 0002", instructions: "", is_active: true, sort_order: 1, created_at: ago(800) },
  ],
  onboarding_surveys: [{ source: "facebook" }, { source: "facebook" }, { source: "facebook" }, { source: "instagram" }, { source: "friend_family" }, { source: "friend_family" }, { source: "whatsapp" }],
  push_deliveries: [
    { id: id(121), status: "pending", attempts: 0, last_error: null, updated_at: ago(1) },
    { id: id(122), status: "pending", attempts: 0, last_error: null, updated_at: ago(1) },
    { id: id(123), status: "failed", attempts: 2, last_error: "UNAVAILABLE", updated_at: ago(2) },
    ...Array.from({ length: 5 }, (_, i) => ({ id: id(130 + i), status: "sent", attempts: 1, last_error: null, updated_at: ago(3) })),
  ],
  staff_audit_log: Array.from({ length: 120 }, (_, i) => ({ id: id(200 + i), actor_id: id(1), action: i % 3 ? "status_changed" : "role_granted", entity_type: i % 3 ? "content_reports" : "user_roles", entity_id: id(51), details: { n: i }, created_at: ago(i + 1) })),
};`;

const html = `<!doctype html>
<html lang="ur" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ہم لکھاری — انتظامی پینل (ڈیزائن پریویو)</title>
<!-- GENERATED by scripts/build-admin-preview.mjs — do not edit by hand. Runs the real admin console against an in-memory stand-in with DEMO data. -->
<style>
${css}
.previewbar{position:sticky;top:0;z-index:50;display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:center;padding:8px 12px;background:#fff8e1;border-bottom:1px solid #e0c36a;color:#5b4500;font:13px/1.6 system-ui,sans-serif}
.previewbar a{padding:2px 10px;border:1px solid #b99a2c;border-radius:99px;color:inherit;text-decoration:none;background:#fff}
.previewbar a.on{background:#5b4500;color:#fff}
</style>
</head>
<body>
<div class="previewbar" id="previewbar"><b>ڈیزائن پریویو — نمونہ ڈیٹا، کوئی حقیقی بیک اینڈ نہیں۔ تبدیلیاں صرف اس صفحے کی میموری میں رہتی ہیں۔</b><span>کردار:</span></div>
<header class="topbar"><div><strong>ہم لکھاری</strong><span>انتظامی پینل</span></div><div id="identity" class="muted">کنکشن کی جانچ ہو رہی ہے…</div></header>
<main class="wrap">
  <section id="setup" class="panel hidden"><h1>کنفیگریشن درکار ہے</h1></section>
  <section id="login" class="panel hidden"><h1>اسٹاف سائن اِن</h1><p class="muted">پریویو میں سائن اِن خودکار ہے۔</p><p id="loginMessage" class="message" role="status"></p><button id="googleLogin" data-act="google-login" class="primary hidden">Google</button><input id="phone" class="hidden"><button id="sendOtp" data-act="send-otp" class="hidden">x</button><input id="otp" class="hidden"><button id="verifyOtp" data-act="verify-otp" class="hidden">x</button></section>
  <section id="denied" class="panel hidden"><h1>رسائی کی اجازت نہیں</h1><button id="signOutDenied" data-act="sign-out" class="secondary">سائن آؤٹ</button></section>
  <section id="app" class="hidden">
    <div class="toolbar"><h1 id="sectionTitle">جائزہ</h1><div><button id="refresh" data-act="refresh" class="secondary">تازہ کریں</button><button id="signOut" data-act="sign-out" class="quiet">سائن آؤٹ</button></div></div>
    <nav id="nav" class="nav"></nav>
    <div id="content" class="content"><div class="panel">ڈیٹا لوڈ ہو رہا ہے…</div></div>
  </section>
  <p id="globalMessage" class="message" role="status" aria-live="polite"></p>
</main>
<script>
(function () {
  var role = new URLSearchParams(location.search).get("role");
  if (["admin", "moderator", "support_agent"].indexOf(role) < 0) role = "admin";
  var roles = {}; roles[role] = true;
  var names = { admin: "منتظم (admin)", moderator: "موڈریٹر", support_agent: "سپورٹ ایجنٹ" };
  var bar = document.getElementById("previewbar");
  Object.keys(names).forEach(function (r) { var a = document.createElement("a"); a.href = "?role=" + r; a.textContent = names[r]; if (r === role) a.className = "on"; bar.appendChild(a); });
  window.__adminMock = { roles: roles, tables: (function () { ${demo.replace(/<\/script/gi, "<\\/script")} })() };
  window.HL_ADMIN_CONFIG = { url: "https://preview.invalid", publishableKey: "preview_not_a_key" };
})();
</script>
<script>
${safe(mock)}
</script>
<script>
${safe(js)}
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(root, "design"), { recursive: true });
fs.writeFileSync(path.join(root, "design/HumLikhari_admin_preview.html"), html);
console.log("design/HumLikhari_admin_preview.html written (" + html.length + " bytes)");
