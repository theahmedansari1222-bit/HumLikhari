/* End-to-end test of the production frontend against an in-memory backend (see mock-backend.js).
 * Run: node tests/e2e/frontend.e2e.mjs   (needs Playwright + Chromium; set PLAYWRIGHT_REQUIRE if not globally resolvable) */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browser, open, base, stubJs, closeAll } from "./harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const results = [];
let failed = 0;
const text = (page) => page.locator("#screen").innerText();
const tab = (page, name) => page.click('#tabbar [data-v="' + name + '"]');
const act = (page, name, extra) => page.click('[data-a="' + name + '"]' + (extra || ""));
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch((e) => { throw new Error("waiting for " + (typeof arg === "string" ? JSON.stringify(arg) : fn.toString().slice(0, 140)) + " :: " + e.message.split("\n")[0]); });
const calls = (page, name) => page.evaluate((n) => window.__mock.calls.filter((c) => c[0] === n), name);
const has = (page, s) => wait(page, (x) => ["#screen", "#sheet", "#toast"].some((q) => document.querySelector(q).innerText.includes(x)), s);

function assert(cond, msg) { if (!cond) throw new Error("assertion failed: " + msg); }

async function scenario(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const started = Date.now();
  let page;
  try {
    page = await fn();
    results.push(["ok", name, Date.now() - started]);
    console.log("  ✓ " + name + " (" + (Date.now() - started) + "ms)");
  } catch (e) {
    failed++;
    results.push(["FAIL", name, e.message.split("\n").slice(0, 3).join(" ").slice(0, 400)]);
    console.log("  ✗ " + name + "\n      " + e.message.split("\n").slice(0, 3).join(" ").slice(0, 400));
    try { await e.page?.screenshot({ path: path.join(here, "fail-" + name.replace(/\W+/g, "_") + ".png") }); } catch (_) { /* ignore */ }
  }
}
const run = (name, body) => scenario(name, async () => {
  let page;
  try { page = await body((p) => (page = p)); }
  catch (e) { e.page = page; throw e; }
  finally { if (page) { const errs = page.errors.slice(); await page.ctx.close(); if (errs.length) throw new Error("browser errors: " + errs.join(" | ")); } }
});

/* ---------------------------------------------------------------- */
await run("config error screen when keys are placeholders", async (set) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage(); set(page); page.errors = []; page.ctx = ctx;
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: stubJs }));
  await page.goto(base + "/");
  await wait(page, () => typeof S !== "undefined" && S.booted);
  assert((await text(page)).includes("ایپ کی ترتیب مکمل نہیں"), "placeholder config must show setup message");
  assert(!(await page.locator('[data-a="google"]').count()), "no sign-in buttons while misconfigured");
  return page;
});

await run("guest: home feed, XSS strings stay text, sign-in sheet on like", async (set) => {
  const page = await open({}); set(page);
  assert((await page.locator("#screen").innerText()).includes("ہم لکھاری"), "splash");
  await act(page, "guest");
  await has(page, "زندگی کی خوبصورتی");
  const t = await text(page);
  assert(t.includes("<img src=x onerror="), "hostile title shown as plain text");
  assert(await page.evaluate(() => !window.__xss), "no script executed from user content");
  assert((await page.locator("#screen img[src='x']").count()) === 0, "no injected <img>");
  await page.click('[data-a="like"]');
  await has(page, "سائن اِن ضروری ہے");
  await act(page, "closeSheet");
  await page.click('.tabs [data-a="feedTab"][data-v="1"]');
  await has(page, "فالو کی گئی تحریریں دیکھنے کے لیے سائن اِن کریں");
  return page;
});

await run("guest deep link opens the article and formats safely", async (set) => {
  const page = await open({}, "#/p/00000000-0000-4000-8000-000000000101"); set(page);
  await has(page, "زندگی چھوٹی ہے");
  assert((await page.locator("#screen .body b").first().innerText()) === "خوشیوں", "bold marker rendered");
  assert(!(await page.locator('[data-a="donate"]').count()) === false, "support block visible to guests");
  await page.click('[data-a="donate"]');
  await has(page, "سائن اِن ضروری ہے");
  return page;
});

await run("hostile post body is rendered inert", async (set) => {
  const page = await open({}, "#/p/00000000-0000-4000-8000-000000000106"); set(page);
  await has(page, "<script>window.__xss=2</script>");
  assert(await page.evaluate(() => !window.__xss), "script text must not execute");
  assert((await page.locator("#screen .body b").count()) === 1 && (await page.locator("#screen .body i").count()) === 1, "only our own b/i tags");
  return page;
});

await run("phone sign-in -> onboarding (interests, survey) -> home", async (set) => {
  const page = await open({}); set(page);
  await act(page, "go", '[data-v="phone"]');
  await page.fill("#f-ob_ph", "0300 1234567");
  await act(page, "phoneSend");
  await has(page, "تصدیقی کوڈ");
  assert((await calls(page, "auth.sendPhoneCode"))[0][1][0] === "+923001234567", "E.164 conversion");
  await page.fill("#f-ob_otp", "000000");
  await act(page, "otpVerify");
  await wait(page, () => document.querySelector("#toast").classList.contains("show"));
  assert((await page.locator("#toast").innerText()).includes("کوڈ غلط"), "wrong OTP message");
  await page.fill("#f-ob_otp", "123456");
  await act(page, "otpVerify");
  await has(page, "اپنی پسند چنیں");
  await page.click('[data-a="pickInterest"][data-v="society"]');
  await page.click('[data-a="pickInterest"][data-v="love"]');
  await act(page, "saveInterests");
  await has(page, "آپ نے ہمارے بارے میں کیسے سنا؟");
  await page.click('[data-a="pickSource"][data-v="other"]');
  await page.fill("#f-sv_other", "ایک دوست");
  await act(page, "saveSurvey");
  await has(page, "فالو");
  assert(await page.evaluate(() => S.scr === "home" && !!S.user), "signed in on home");
  const saved = await calls(page, "onboarding.saveInterests");
  assert(JSON.stringify(saved[0][1][0]) === JSON.stringify(["society", "love"]), "interests saved as slugs");
  return page;
});

await run("bad phone numbers are rejected before the network", async (set) => {
  const page = await open({}); set(page);
  await act(page, "go", '[data-v="phone"]');
  await page.fill("#f-ob_ph", "12345");
  await act(page, "phoneSend");
  await has(page, "درست موبائل نمبر");
  assert((await calls(page, "auth.sendPhoneCode")).length === 0, "no request sent");
  return page;
});

await run("like/save/follow are optimistic and roll back on failure", async (set) => {
  const page = await open({ signedIn: true }); set(page);
  await has(page, "زندگی کی خوبصورتی");
  const likeBtn = page.locator('article:has-text("خوش رہنے کے آسان طریقے") [data-a="like"]');
  const before = await likeBtn.innerText();
  await likeBtn.click();
  await wait(page, () => S.liked.size === 1);
  assert((await likeBtn.innerText()).trim() !== before.trim(), "count changes immediately");
  await page.evaluate(() => window.__mock.failNext("social.unlike", "خرابی"));
  await likeBtn.click();
  await wait(page, () => document.querySelector("#toast").innerText.includes("خرابی"));
  assert(await page.evaluate(() => S.liked.size === 1), "failed unlike rolls back to liked");
  await page.locator('article:has-text("خوش رہنے کے آسان طریقے") [data-a="save"]').click();
  await wait(page, () => S.saved.size === 1);
  assert((await calls(page, "social.bookmark")).length === 1, "bookmark call made");
  return page;
});

await run("article: follow, comments (thread, reply, delete), report, share", async (set) => {
  const page = await open({ signedIn: true }, "#/p/00000000-0000-4000-8000-000000000103"); set(page);
  await has(page, "کتاب آج بھی");
  await page.click('.who [data-a="follow"]');
  await wait(page, () => S.following.has("00000000-0000-4000-8000-000000000004"));
  await page.click('.bar [data-a="comments"]');
  await has(page, "ابھی کوئی تبصرہ نہیں");
  await page.fill("#cin", "پہلا تبصرہ");
  await page.press("#cin", "Enter");
  await has(page, "پہلا تبصرہ");
  await page.click('[data-a="deleteComment"]');
  await has(page, "ابھی کوئی تبصرہ نہیں");
  // reply threading on a post that already has a comment by someone else
  await page.evaluate(() => back());
  await page.evaluate(() => go("comments", { id: "00000000-0000-4000-8000-000000000101" }));
  await has(page, "بہت عمدہ تحریر");
  await page.click('[data-a="reply"]');
  assert((await page.inputValue("#cin")).startsWith("@محمد علی"), "reply prefilled");
  await page.press("#cin", "Enter");
  await wait(page, () => !!document.querySelector(".cm.rep"));
  const sent = (await calls(page, "comments.add")).pop();
  assert(sent[1][0].parentId === "00000000-0000-4000-8000-000000000300", "reply carries parent id");
  await page.click('[data-a="reportComment"]');
  await has(page, "وجہ منتخب کریں");
  await page.click('[data-a="reportSend"]');
  await has(page, "رپورٹ کی وجہ منتخب کریں");
  await page.click('[data-a="reportReason"][data-v="spam"]');
  await page.click('[data-a="reportSend"]');
  await wait(page, () => (window.__reports || []).length === 1);
  return page;
});

await run("composer: autosave draft on leave, restore, publish, edit, delete", async (set) => {
  const page = await open({ signedIn: true }); set(page);
  await has(page, "فالو");
  await tab(page, "write");
  await page.fill("#wt", "میری نئی تحریر");
  await page.fill("#wb", "پہلی سطر\nدوسری سطر");
  await page.click('[data-a="back"]');
  await wait(page, () => window.__mock.state.posts.some((p) => p.status === "draft" && p.title === "میری نئی تحریر"));
  assert(await page.evaluate(() => localStorage.getItem("hl.buf." + S.user.id) === null), "buffer cleared after server save");
  await tab(page, "write");
  await page.click('[data-a="drafts"]');
  await has(page, "میری نئی تحریر");
  await page.click('[data-a="openDraft"]');
  await wait(page, () => document.querySelector("#wt") && document.querySelector("#wt").value === "میری نئی تحریر");
  await page.fill("#wb", "پہلی سطر\nدوسری سطر\nتیسری سطر");
  await page.click('[data-a="publish"]');
  await has(page, "میری نئی تحریر");
  const pubs = await calls(page, "posts.publish");
  assert(pubs.length === 1 && pubs[0][1][0].id, "published the existing draft row, no duplicate");
  assert(await page.evaluate(() => window.__mock.state.posts.filter((p) => p.title === "میری نئی تحریر").length === 1), "exactly one row");
  // empty title is refused
  await tab(page, "write");
  await page.click('[data-a="publish"]');
  await has(page, "پہلے عنوان لکھیں");
  await page.click('[data-a="back"]');
  // edit own published article
  await page.evaluate(() => go("article", { id: "00000000-0000-4000-8000-000000000105" }));
  await has(page, "ہم ایک ایسے دور میں");
  assert(!(await page.locator('.sup [data-a="donate"]').count()), "no support block on own post");
  await page.click('[data-a="postMore"]');
  await page.click('[data-a="editPost"]');
  await wait(page, () => document.querySelector("#wt") && document.querySelector("#wt").value.includes("پاکستان کا مستقبل"));
  await page.fill("#wt", "پاکستان کا مستقبل (ترمیم شدہ)");
  await page.click('[data-a="publish"]');
  await has(page, "ترمیم شدہ");
  return page;
});

await run("offline: publish keeps text in a local buffer, never loses it", async (set) => {
  const page = await open({ signedIn: true }); set(page);
  await has(page, "فالو");
  await tab(page, "write");
  await page.fill("#wt", "آف لائن تحریر");
  await page.fill("#wb", "متن جو ضائع نہیں ہونا چاہیے");
  await page.ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.click('[data-a="publish"]');
  await has(page, "فالو");
  const buf = await page.evaluate(() => JSON.parse(localStorage.getItem("hl.buf." + S.user.id) || "null"));
  assert(buf && buf.t === "آف لائن تحریر" && buf.b.includes("ضائع نہیں"), "local buffer holds the text");
  assert((await calls(page, "posts.publish")).length === 0, "nothing published while offline");
  await page.ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await wait(page, () => window.__mock.state.posts.some((p) => p.status === "draft" && p.title === "آف لائن تحریر"));
  return page;
});

await run("profile edit: handle conflict message, save, avatar removal, payment details", async (set) => {
  const page = await open({ signedIn: true }); set(page);
  await has(page, "فالو");
  await tab(page, "profile");
  await has(page, "پروفائل ایڈٹ کریں");
  await act(page, "editProfile");
  await wait(page, () => S.ed && S.ed.payLoaded);
  await page.fill("#e-user", "sara_khan");
  await page.click('[data-a="saveProfile"]');
  await has(page, "ہینڈل پہلے سے کسی اور");
  await page.fill("#e-user", "Bad Handle!");
  await page.click('[data-a="saveProfile"]');
  await has(page, "ہینڈل 3 سے 24");
  await page.fill("#e-user", "imran_new");
  await page.fill("#e-name", "عمران احمد خان");
  await page.fill('[data-e="bank_name"]', "بینک");
  await page.click('[data-a="saveProfile"]');
  await has(page, "بینک کی تینوں تفصیلات");
  await page.fill('[data-e="bank_title"]', "عمران");
  await page.fill('[data-e="bank_iban"]', "pk36 abcd 0000 1111 2222 3333");
  await page.click('[data-a="saveProfile"]');
  await has(page, "عمران احمد خان");
  const saved = await page.evaluate(() => window.__mock.state.myOptions);
  assert(saved.length === 1 && saved[0].method === "bank_transfer" && saved[0].account_identifier === "PK36ABCD000011112222" + "3333", "bank option saved normalised");
  assert(saved[0].is_public === true, "published because the switch defaults to on");
  return page;
});

await run("support: donate sheet shows only the writer's methods, records a claim, history actions", async (set) => {
  const page = await open({ signedIn: true }, "#/u/sara_khan"); set(page);
  await has(page, "سارہ خان");
  await has(page, "نمایاں لکھاری");
  await page.click('.pad [data-a="donate"]');
  await has(page, "لکھاری کی حوصلہ افزائی");
  await page.fill("#donCustom", "5");
  await page.click('[data-a="donNext"]');
  await has(page, "رقم 10 سے 10,00,000");
  await page.fill("#donCustom", "750");
  await page.click('[data-a="donNext"]');
  await has(page, "ادائیگی کا طریقہ");
  assert(await page.locator('[data-a="donMethod"][data-v="easypaisa"]').isDisabled(), "unavailable method disabled");
  await page.click('[data-a="donMethod"][data-v="jazzcash"]');
  await wait(page, () => !!document.querySelector("#sheet .qrbig"));
  await page.click('[data-a="donMethod"][data-v="bank_transfer"]');
  await has(page, "PK00DEMO0000000000000001");
  await page.click('[data-a="donSent"]');
  await has(page, "شکریہ! تعاون درج ہو گیا");
  const c = (await calls(page, "writerSupport.createTransferClaim"))[0][1][0];
  assert(c.amount === 750 && c.paymentOptionId === "00000000-0000-4000-8000-000000000501", "claim carries amount and option id");
  await page.evaluate(() => go("history", { tab: 1 }));
  await has(page, "750 روپے");
  await has(page, "بھیجنے والے نے اطلاع دی");
  await page.click('[data-a="claimCancel"]');
  await has(page, "منسوخ");
  return page;
});

await run("notifications: unread badge, routing, mark all read", async (set) => {
  const page = await open({ signedIn: true }); set(page);
  await has(page, "فالو");
  assert((await page.locator("#tabbar .bd").innerText()).trim() === "2", "unread badge shows 2");
  await tab(page, "notif");
  await has(page, "سارہ خان نے آپ کی تحریر");
  await page.click('[data-a="notif"][data-id="00000000-0000-4000-8000-000000000400"]');
  await has(page, "ہم ایک ایسے دور میں");
  await page.click('[data-a="back"]');
  await page.click('[data-a="notifAll"]');
  await wait(page, () => S.unread === 0);
  assert(!(await page.locator("#tabbar .bd").count()), "badge gone");
  return page;
});

await run("search and topic filters, empty state, paging footer", async (set) => {
  const page = await open({ signedIn: true }); set(page);
  await has(page, "فالو");
  await tab(page, "explore");
  await has(page, "تازہ ترین تحریریں");
  await page.fill("#qin", "کتاب");
  await has(page, "جدید دور میں کتابوں کی اہمیت");
  assert(await page.evaluate(() => document.activeElement.id === "qin"), "search input keeps focus while results refresh");
  await page.fill("#qin", "ایسا کچھ نہیں");
  await has(page, "کوئی نتیجہ نہیں ملا");
  await page.fill("#qin", "");
  await page.click('[data-a="topic"][data-v="life"]');
  await has(page, "خوش رہنے کے آسان طریقے");
  return page;
});

await run("blocking hides the writer; unblock restores; own content cannot be reported", async (set) => {
  const page = await open({ signedIn: true }, "#/p/00000000-0000-4000-8000-000000000102"); set(page);
  await has(page, "خوشی بڑے فیصلوں");
  await page.click('[data-a="postMore"]');
  await page.click('[data-a="blockAsk"]');
  await has(page, "لکھاری کو بلاک کریں؟");
  await page.click('[data-a="block"]');
  await has(page, "ہم لکھاری");
  await wait(page, () => S.blocked.size === 1);
  await wait(page, () => !document.querySelector("#screen").innerText.includes("خوش رہنے کے آسان طریقے"));
  await page.evaluate(() => go("blocked"));
  await has(page, "محمد علی");
  await page.click('[data-a="unblock"]');
  await wait(page, () => S.blocked.size === 0);
  return page;
});

await run("settings: theme, help ticket + thread, team, badge, platform, delete account", async (set) => {
  const page = await open({ signedIn: true }); set(page);
  await has(page, "فالو");
  await tab(page, "profile");
  await page.click('[data-a="go"][data-v="settings"]');
  await page.click('[data-a="theme"][data-v="dark"]');
  assert((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "theme applied");
  assert((await page.evaluate(() => JSON.parse(localStorage.getItem("hl.prefs")).theme)) === "dark", "theme persisted");
  await page.click('[data-a="settingsGo"][data-v="help"]');
  await page.fill("#f-help_msg", "ab");
  await page.click('[data-a="helpSend"]');
  await has(page, "کم از کم 5 حروف");
  await page.fill("#f-help_msg", "یہ ایک تجرباتی پیغام ہے");
  await page.click('[data-a="helpSend"]');
  await has(page, "نمبر #101");
  await page.click('[data-a="ticket"]');
  await has(page, "یہ ایک تجرباتی پیغام ہے");
  await page.fill("#tin", "شکریہ");
  await page.press("#tin", "Enter");
  await has(page, "شکریہ");
  await page.evaluate(() => { back(); back(); });
  await page.click('[data-a="settingsGo"][data-v="team"]');
  await page.fill("#f-tm_why", "چھوٹا");
  await page.click('[data-a="teamSend"]');
  await has(page, "کم از کم 20 حروف");
  await page.fill("#f-tm_why", "میں اردو پروف ریڈنگ میں مہارت رکھتا ہوں اور وقت دے سکتا ہوں");
  await page.click('[data-a="teamSend"]');
  await has(page, "زیرِ جائزہ");
  await page.click('[data-a="back"]');
  await page.click('[data-a="settingsGo"][data-v="badges"]');
  await page.click('[data-a="badgeSend"]');
  await has(page, "موصول");
  await page.click('[data-a="back"]');
  await page.click('[data-a="settingsGo"][data-v="platform"]');
  await page.fill("#f-pf_amount", "50");
  await page.click('[data-a="platformSend"]');
  await has(page, "100 سے 50,00,000");
  await page.fill("#f-pf_amount", "1500");
  await page.click('[data-a="platformSend"]');
  await has(page, "1,500 روپے");
  await page.click('[data-a="back"]');
  await page.click('[data-a="deleteAccountAsk"]');
  await page.fill("#delConfirm", "nope");
  await page.click('[data-a="deleteAccount"]');
  await has(page, "تصدیق کے لیے DELETE");
  await page.fill("#delConfirm", "delete");
  await page.click('[data-a="deleteAccount"]');
  await has(page, "گوگل سے جاری رکھیں");
  assert(await page.evaluate(() => S.user === null), "state cleared after deletion");
  return page;
});

await run("delete account asks for a fresh sign-in when the server says so", async (set) => {
  const page = await open({ signedIn: true, deleteNeedsRecentLogin: true }); set(page);
  await has(page, "فالو");
  await page.evaluate(() => go("settings"));
  await page.click('[data-a="deleteAccountAsk"]');
  await page.fill("#delConfirm", "DELETE");
  await page.click('[data-a="deleteAccount"]');
  await has(page, "دوبارہ سائن اِن کریں");
  assert(await page.evaluate(() => S.user !== null), "still signed in");
  return page;
});

await run("feed failure shows an error with a working retry", async (set) => {
  const page = await open({ feedFails: true }); set(page);
  await act(page, "guest");
  await has(page, "انٹرنیٹ سے رابطہ نہیں ہو رہا");
  await page.evaluate(() => { window.__feedOk = true; });
  await page.click('[data-a="feedRetry"]');
  await has(page, "زندگی کی خوبصورتی");
  return page;
});

await run("poem rendering: card shows two lines, reader shows couplets", async (set) => {
  const page = await open({}, "#/p/00000000-0000-4000-8000-000000000104"); set(page);
  await has(page, "شام ڈھلتے ہی");
  assert((await page.locator("#screen .cpl").count()) === 2, "four lines become two couplets");
  await page.evaluate(() => go("home"));
  const card = page.locator('article:has-text("شام کے دیے") .poem');
  await card.waitFor();
  assert(((await card.innerText()).match(/\n/g) || []).length <= 1, "card excerpt limited to two lines");
  return page;
});

await run("reader preferences persist", async (set) => {
  const page = await open({}, "#/p/00000000-0000-4000-8000-000000000101"); set(page);
  await has(page, "زندگی چھوٹی ہے");
  await page.click('[data-a="readPrefs"]');
  await page.click('[data-a="fontSize"][data-v="1"]');
  await page.click('[data-a="nastaliq"]');
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("hl.prefs")));
  assert(prefs.fs === 2 && prefs.nk === true, "font size and script persisted");
  return page;
});

await run("keyboard + a11y basics: Escape closes sheets, tabbar labelled, no unlabeled buttons", async (set) => {
  const page = await open({}); set(page);
  await act(page, "guest");
  await has(page, "زندگی کی خوبصورتی");
  await page.click('[data-a="share"]');
  await has(page, "شیئر کریں");
  await page.keyboard.press("Escape");
  await wait(page, () => !document.querySelector("#sheet").classList.contains("on"));
  const unlabeled = await page.evaluate(() => Array.from(document.querySelectorAll("button")).filter((b) => !b.innerText.trim() && !b.getAttribute("aria-label")).length);
  assert(unlabeled === 0, unlabeled + " icon-only buttons without aria-label");
  return page;
});

await closeAll();
console.log(`\n${results.length - failed}/${results.length} end-to-end scenarios passed`);
process.exit(failed ? 1 : 0);
