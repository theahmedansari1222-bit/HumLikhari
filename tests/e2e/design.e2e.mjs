/* Browser checks for the design files in design/ (app preview + admin preview). No backend involved.
 * Run: node tests/e2e/design.e2e.mjs   (needs Playwright + Chromium; set PLAYWRIGHT_REQUIRE if not globally resolvable) */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_REQUIRE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP = "file://" + path.join(root, "design/HumLikhari_app_design_v1.html");
const ADMIN = "file://" + path.join(root, "design/HumLikhari_admin_preview.html");
execFileSync(process.execPath, [path.join(root, "scripts/build-admin-preview.mjs")], { stdio: "ignore" }); // preview is always built from the current admin/ sources
let fails = 0;
const b = await chromium.launch();
{
  const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_NAME|ERR_INTERNET|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await p.goto(APP);
  const T = async () => (await p.locator(".phone").innerText()).replace(/\s+/g, " ");
  const toastT = async () => (await p.locator("#toast").innerText()).trim();
  const ok = async (name, cond, extra) => { const c = typeof cond === "function" ? await cond() : cond; if (!c) fails++; console.log((c ? "  ✓ " : "  ✗ ") + name + (c ? "" : "  " + (extra ? await extra() : ""))); };
  const click = async (sel) => { await p.click(sel); await p.waitForTimeout(80); };
  // 1. login -> interests -> survey
  await click('[data-x="login"]');
  await ok('login -> interests', async () => (await T()).includes('جاری رکھیں'));
  await click('[data-go="survey"]');
  await ok('interests -> survey', async () => (await T()).includes('آپ نے ہمارے بارے میں کیسے سنا؟'));
  await click('[data-x="svs"][data-v="1"]');
  await ok('survey submit without answer is refused', async () => (await toastT()).includes('پہلے ایک جواب'));
  await click('[data-x="src"][data-v="other"]');
  await ok('"other" shows free-text input', async () => (await p.locator('[data-fx="sv.other"]').count()) == 1);
  await click('[data-x="svs"][data-v="1"]');
  await ok('survey -> home', async () => (await p.evaluate(() => S.scr)) == 'home');

  // 2. own article has no support panel; others do
  await p.evaluate(() => { S.art = 'a1'; go('article'); });
  await ok('own post: no support panel', async () => !(await T()).includes('تحریر پسند آئی؟'));
  await p.evaluate(() => { S.art = 'a2'; go('article'); });
  await ok('other post: support panel', async () => (await T()).includes('تحریر پسند آئی؟'));

  // 3. donate flow
  await click('[data-sheet="donate"]');
  await p.fill('[data-cust]', '5');
  await click('#dnb');
  await ok('custom amount 5 -> error', async () => (await T()).includes('10 سے 10,00,000'));
  await p.fill('[data-cust]', '250');
  await ok('button label reflects amount', async () => (await p.locator('#dnb').innerText()).includes('250 روپے بھیجنے کا طریقہ'));
  await click('#dnb');
  await ok('step 2 shows method chooser with 250', async () => (await T()).includes('250 روپے'));
  // pick first method (jc or whichever)
  const meth = p.locator('[data-pm]').first();
  if (await meth.count()) await meth.click();
  await p.waitForTimeout(80);
  await ok('disclaimer shown after choosing method', async () => (await T()).includes('رقم ایپ کے ذریعے منتقل نہیں ہوتی'), T);
  await p.fill('[data-dn]', 'اللہ آپ کو برکت دے');
  await click('[data-paid]');
  await ok('paid toast', async () => (await toastT()).includes('تعاون درج ہو گیا'));
  await p.evaluate(() => { S.ht = 1; go('history'); });
  await ok('history (sent) shows note + status + cancel', async () => { const t = await T(); return t.includes('اللہ آپ کو برکت دے') && t.includes('بھیجنے والے نے اطلاع دی') && t.includes('منسوخ کریں') && t.includes('250 روپے'); }, T);
  await click('[data-x="cnl"][data-v="0"]');
  await ok('cancel -> status منسوخ and total excludes it', async () => (await T()).includes('کل درج شدہ رقم 0 روپے'), T);
  await p.evaluate(() => { S.ht = 0; go('history'); });
  await click('[data-x="ack"][data-v="0"]');
  await ok('received tab: acknowledge', async () => (await T()).includes('لکھاری نے وصولی کی تصدیق کی'));


  // 4. report flow
  await p.evaluate(() => { S.art = 'a2'; go('article'); });
  await click('[data-sheet="more"]');
  await ok('more sheet (other post): report + block, no edit/delete', async () => { const t = await T(); return t.includes('تحریر رپورٹ کریں') && t.includes('لکھاری کو بلاک کریں') && !t.includes('تحریر ڈیلیٹ کریں'); }, T);
  await click('[data-x="rep"][data-v="post"]');
  await click('[data-x="rsend"]');
  await ok('report without reason refused', async () => (await T()).includes('پہلے وجہ منتخب کریں'));
  await click('[data-x="rr"][data-v="spam"]');
  await click('[data-x="rsend"]');
  await ok('report sent', async () => (await toastT()).includes('رپورٹ موصول ہو گئی'));

  // 5. block flow + feed hiding
  const a2by = await p.evaluate(() => A.a2.by);
  await click('[data-sheet="more"]');
  await click('[data-x="blk"]');
  await ok('block confirm sheet', async () => (await T()).includes('لکھاری کو بلاک کریں؟'));
  await click('[data-x="blkdo"]');
  await ok('block -> toast', async () => (await toastT()).includes('بلاک'));
  await p.evaluate(() => go('home'));
  await ok('blocked writer removed from home', async () => !(await p.evaluate(() => S.home.filter(i => !S.bl[A[i].by]).some(i => A[i].by === A.a2.by))));
  await p.evaluate(() => go('blocked'));
  await ok('blocked list has writer', async () => (await T()).includes(a2by));
  await click('[data-x="unb"]');
  await ok('unblock removes the writer from the list', async () => !(await T()).includes('بلال احمد'));

  // 6. comments: reply indentation + report
  await p.evaluate(() => { S.art = 'a1'; go('comments'); });
  await ok('reply rendered indented', async () => (await p.locator('.cm.rep').count()) >= 1);

  // 7. edit profile validation
  await p.evaluate(() => { go('settings'); });
  await ok('settings has all new rows', async () => { const t = await T(); return ['میری پسند','تعاون کی تاریخ','بلاک کیے گئے لوگ','ہماری ٹیم میں شامل ہوں','لکھاری بیج کی درخواست','پلیٹ فارم کی معاونت','مدد اور رابطہ','شرائط و ضوابط','پرائیویسی پالیسی'].every(x => t.includes(x)); }, T);
  await p.evaluate(() => { S.ed = { ...S.me }; go('editp'); });
  await p.fill('[data-e="h"]', 'AB');
  await click('[data-psave]');
  await ok('handle too short -> toast', async () => (await toastT()).includes('3 سے 24'), toastT);
  await p.fill('[data-e="h"]', 'ImranAhmad_1');
  await p.fill('[data-e="bn"]', 'کوئی بینک').catch(() => {});
  await click('[data-psave]');
  await ok('bank partial -> toast', async () => (await toastT()).includes('بینک کی تینوں'), toastT);

  // 8. help ticket
  await p.evaluate(() => go('help'));
  await p.fill('#hm', 'abc');
  await click('[data-hsend]');
  await ok('short message refused', async () => (await toastT()).includes('کم از کم 5'));
  await p.fill('#hm', 'میری تحریر شائع نہیں ہو رہی');
  await click('[data-hsend]');
  await ok('ticket created HL-0003', async () => (await T()).includes('HL-0003'), T);

  // 9. team + badge + platform
  await p.evaluate(() => go('team'));
  await click('[data-x="tms"]');
  await ok('team motivation < 20 refused', async () => (await toastT()).includes('20'));
  await p.fill('[data-fx="tm.why"]', 'میں اردو ادب سے محبت کرتا ہوں اور پروف ریڈنگ میں مدد دے سکتا ہوں۔');
  await click('[data-x="tms"]');
  await ok('team request created + pending notice', async () => (await T()).includes('پہلے سے زیرِ جائزہ'));
  await p.evaluate(() => go('badges'));
  await click('[data-x="bds"]');
  await ok('badge request created', async () => (await T()).includes('اس وقت کوئی نئی درخواست ممکن نہیں') || (await T()).includes('زیرِ جائزہ') || (await T()).includes('موصول'), T);
  await p.evaluate(() => go('platform'));
  await p.fill('[data-fx="pf.amount"]', '50');
  await click('[data-x="pfs"]');
  await ok('platform amount < 100 refused', async () => (await toastT()).includes('100'));
  await p.fill('[data-fx="pf.amount"]', '1500');
  await click('[data-x="pfs"]');
  await ok('platform report added', async () => (await T()).includes('1500 روپے'));
  await p.evaluate(() => { S.me.c = 'IN'; go('platform'); });
  await ok('non-PK country -> notice, no accounts', async () => { const t = await T(); return t.includes('پاکستان') && !t.includes('اکاؤنٹ ٹائٹل'); });
  await p.evaluate(() => { S.me.c = 'PK'; });

  // 10. delete flow
  await p.evaluate(() => go('settings'));
  await click('[data-sheet="del"]');
  await click('[data-del]');
  await ok('delete without typing refused', async () => (await T()).includes('DELETE لکھیں'));
  await p.fill('[data-dc]', ' delete ');
  await click('[data-del]');
  await ok('delete -> splash + signed out', async () => (await p.evaluate(() => S.scr == 'splash' && !S.user)));

  // 11. guest gating
  await click('[data-x="guest"]');
  for (const [sel, nm] of [['[data-go="write"]', 'write'], ['[data-go="notif"]', 'notif'], ['[data-go="profile"]', 'profile']]) {
    await click(sel);
    await ok('guest ' + nm + ' -> signin sheet', async () => (await T()).includes('سائن اِن ضروری ہے'));
    await click('[data-close]');
  }
  await click('[data-x="login"]').catch(() => {});

  // 12. cover image upload
  await p.evaluate(() => { S.user = 1; S.sheet = ''; S.w = H0(); go('write'); });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
  await p.setInputFiles('[data-cov]', { name: 'c.png', mimeType: 'image/png', buffer: png });
  await p.waitForTimeout(400);
  await ok('cover chosen -> thumbnail + remove', async () => (await p.locator('img.thumb').count()) == 1 && (await T()).includes('ہٹائیں'), T);
  await click('[data-x="covx"]');
  await ok('cover removed', async () => (await p.locator('img.thumb').count()) == 0);


  // every extra screen/sheet reachable from the dev bar renders its key text (fresh page: the flows above changed the demo state)
  await p.goto(APP);
  for (const [k, must] of [["states",["لوڈ ہو رہا ہے"]],["survey",["آپ نے ہمارے بارے میں کیسے سنا؟","فیس بک"]],["team",["ہماری ٹیم میں شامل ہوں","پروف ریڈنگ"]],["badges",["لکھاری بیج","مستقل مزاج لکھاری"]],["platform",["پلیٹ فارم کی معاونت","جاز کیش"]],["blocked",["بلاک کیے گئے لوگ","بلال احمد"]],["ticket",["پیغام","HL-0001"]],["suspended",["معطل"]],["sh:signin",["سائن اِن ضروری ہے"]],["sh:report",["اسپام"]],["sh:block",["بلاک کریں"]],["sh:del",["DELETE"]],["sh:removed",["مواد ہٹا دیا گیا"]]]) {
    await p.evaluate(() => { if (S.scr === "splash") { S.user = 1; go("home"); } });
    await click(`[data-x="dev"][data-v="${k}"]`);
    await ok("dev bar: " + k, async () => { const t = await T(); return must.every((m) => t.includes(m)); }, T);
  }

  await ok("app design: no console/page errors", errs.length === 0, async () => JSON.stringify(errs));
  await p.close();
}
{
  for (const [role, expect] of [["admin", 11], ["moderator", 4], ["support_agent", 6]]) {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load|net::ERR/.test(m.text())) errs.push(m.text()); });
    await p.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
    await p.goto(ADMIN + "?role=" + role);
    await p.waitForFunction(() => !document.querySelector("#app").classList.contains("hidden") && !document.querySelector("#content").textContent.includes("لوڈ ہو رہا ہے"), null, { timeout: 5000 }).catch((e) => errs.push("timeout: " + e.message.split("\n")[0]));
    const n = (await p.$$eval("#nav button", (x) => x.length));
    const good = errs.length === 0 && n === expect;
    if (!good) fails++;
    console.log((good ? "  ✓ " : "  ✗ ") + "admin preview as " + role + ": " + n + " sections (expected " + expect + ")" + (errs.length ? " " + JSON.stringify(errs) : ""));
    await p.close();
  }
}
await b.close();
console.log(fails ? "\n" + fails + " design check(s) FAILED" : "\nall design checks passed");
process.exit(fails ? 1 : 0);
