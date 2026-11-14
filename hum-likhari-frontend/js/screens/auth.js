"use strict";
/* Sign-in (Google / phone OTP), session handling, onboarding (interests + survey), suspended state. */

const GOOGLE_G = raw('<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>');
const AUTH_SCREENS = ["splash", "phone", "otp"];
const OTP_COOLDOWN = 60;
let otpTimer = null;

/* ---------------- session ---------------- */
let sessionJob = null, sessionJobId = null;
function handleSession(session) {
  if (!session || !session.user) return Promise.resolve("none");
  if (S.user && S.user.id === session.user.id && S.me) { S.user = session.user; return Promise.resolve("same"); }
  if (sessionJob && sessionJobId === session.user.id) return sessionJob;
  sessionJobId = session.user.id;
  sessionJob = loadAccount(session.user).then(() => "new").finally(() => { sessionJob = null; sessionJobId = null; });
  return sessionJob;
}

async function loadAccount(user) {
  let row = null, lastError = null;
  for (let i = 0; i < 4 && !row; i++) {
    try { row = await BE().profiles.mine(); } catch (e) { lastError = e; await sleep(400 * (i + 1)); }    // profile row is created by a DB trigger; give it a moment
  }
  if (!row) throw lastError || new Error("profile_missing");
  S.user = user;
  S.me = mapProfile(row);
  S.suspended = !S.me.active;
  const jobs = await Promise.allSettled([
    BE().social.myFollowingIds(), BE().onboarding.myInterests(), BE().notifications.unreadCount(), BE().social.blockedUsers(),
  ]);
  S.blocked = new Set(jobs[3].status === "fulfilled" ? jobs[3].value.map((u) => u.id) : []);
  S.following = new Set(jobs[0].status === "fulfilled" ? jobs[0].value : []);
  S.interests = new Set(jobs[1].status === "fulfilled" ? jobs[1].value : []);
  S.unread = jobs[2].status === "fulfilled" ? jobs[2].value : 0;
  registerPush();
}

function clearAccount() {
  S.user = null; S.me = null; S.suspended = false;
  S.following = new Set(); S.liked = new Set(); S.saved = new Set(); S.blocked = new Set(); S.interests = new Set();
  S.lists = {}; S.v = {}; S.unread = 0; S.fields = {}; S.ed = null; S.sheet = null;
  if (S.w && S.w.coverObjectUrl) URL.revokeObjectURL(S.w.coverObjectUrl);
  S.w = NEW_WRITE(); S.posts = new Map();
}

function onAuthEvent(event, session) {
  if (event === "SIGNED_OUT") { setTimeout(() => { if (S.user) { clearAccount(); go("splash"); } }, 0); return; }
  if (event === "TOKEN_REFRESHED" && session && S.user) { S.user = session.user; return; }
  if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
    setTimeout(() => {
      handleSession(session).then((state) => { if (state === "new" && S.booted && AUTH_SCREENS.includes(S.scr)) afterLogin(); })
        .catch((e) => toast(errText(e)));
    }, 0);                                          // never call the client from inside its own auth callback
  }
}

function needsOnboarding() { return !!S.user && !S.suspended && !S.interests.size && !ls.get("hl.onb." + S.user.id, false); }
function afterLogin() {
  if (!AUTH_SCREENS.includes(S.scr)) return;
  if (S.suspended) go("suspended");
  else if (needsOnboarding()) go("interests", { onboarding: true });
  else go("home");
}

async function registerPush() {
  try {
    const native = window.HLNative;
    if (!native || typeof native.pushToken !== "function") return;     // browser build: push is provided by the native wrapper
    const info = await native.pushToken();
    if (info && info.token) await BE().push.register({ token: info.token, platform: info.platform || "android", deviceLabel: info.label || "" });
  } catch (_) { /* push is best effort */ }
}
async function refreshUnread() {
  if (!S.user) return;
  try { S.unread = await BE().notifications.unreadCount(); renderChrome(); } catch (_) { /* ignore */ }
}

/* ---------------- screens ---------------- */
R.splash = () => h`<div class="splash"><div class="brand"><div class="wm">ہم لکھاری</div><div class="wl">HUM LIKHARI</div></div>
${S.cfgError ? h`<div class="notice bad" role="alert">${S.cfgError}</div>` : h`<div class="go">
  <button class="btn" data-a="google"><span class="gi">${GOOGLE_G}</span>گوگل سے جاری رکھیں</button>
  <button class="btn o" data-a="go" data-v="phone">${ic("phone", 20)}فون نمبر سے جاری رکھیں</button>
  <button class="lnk muted" data-a="guest">اکاؤنٹ کے بغیر پڑھیں</button></div>`}
<div class="mu terms">جاری رکھنے پر آپ <button class="lnk" data-a="legal" data-v="t">شرائط</button> اور <button class="lnk" data-a="legal" data-v="p">پرائیویسی پالیسی</button> سے اتفاق کرتے ہیں۔</div></div>`;

R.phone = () => h`${hd("فون نمبر")}<div class="pad"><p class="mu">اپنا موبائل نمبر درج کریں۔ ہم آپ کو 6 ہندسوں کا تصدیقی کوڈ بھیجیں گے۔</p>
${fieldInput("ob.ph", { ph: "03XX XXXXXXX", mode: "tel", label: "موبائل نمبر", cls: "big ltr", enter: "phoneSend" })}
<button class="btn" id="phoneBtn" style="margin-top:12px" data-a="phoneSend">کوڈ بھیجیں</button></div>`;

R.otp = () => {
  const phone = S.fields["ob.phone"] || "";
  return h`${hd("تصدیقی کوڈ")}<div class="pad"><p class="mu">کوڈ <bdi dir="ltr">${phone}</bdi> پر بھیجا گیا ہے۔</p>
  ${fieldInput("ob.otp", { ph: "------", mode: "numeric", max: 6, label: "تصدیقی کوڈ", cls: "otp", enter: "otpVerify" })}
  <button class="btn" style="margin-top:12px" data-a="otpVerify">تصدیق کریں</button>
  <button class="lnk" id="resend" style="width:100%;margin-top:6px" data-a="resend" ${S.otpLeft > 0 ? raw("disabled") : ""}>${S.otpLeft > 0 ? "نیا کوڈ " + S.otpLeft + " سیکنڈ بعد" : "کوڈ دوبارہ بھیجیں"}</button></div>`;
};

R.suspended = () => h`<div class="splash"><div class="brand"><div class="wm">ہم لکھاری</div></div>
<div class="notice bad" role="alert">آپ کا اکاؤنٹ فی الحال معطل ہے۔ اگر آپ سمجھتے ہیں کہ یہ غلطی ہے تو ہم سے رابطہ کریں۔</div>
<div class="go"><button class="btn o" data-a="signout">${ic("out")}لاگ آؤٹ</button></div></div>`;

/* ----- interests ----- */
L.interests = () => { S.fields["int.sel"] = Array.from(S.interests); loadSuggestedWriters(); };
function loadSuggestedWriters() {
  return fetchKey("suggested", async () => {
    const rows = mapAndCache(await BE().posts.feed({ limit: 30 }));
    const seen = new Set(), out = [];
    rows.forEach((p) => { if (!seen.has(p.authorId) && !(S.me && p.authorId === S.me.id)) { seen.add(p.authorId); out.push({ id: p.authorId, username: p.username, name: p.name, bio: "", avatarUrl: p.avatarUrl }); } });
    return out.slice(0, 4);
  }, { ttl: 120000 });
}
R.interests = (p) => {
  const sel = new Set(S.fields["int.sel"] || []);
  const sug = vget("suggested");
  const topics = BE().labels.topics;
  return h`${p.onboarding ? hdTab("اپنی پسند چنیں") : hd("اپنی پسند")}
  <div class="pad" style="padding-bottom:0"><b>آپ کن موضوعات میں دلچسپی رکھتے ہیں؟</b></div>
  <div class="cats wrap">${topics.map((t) => h`<button data-a="pickInterest" data-v="${t.slug}" class="${sel.has(t.slug) ? "on" : ""}" aria-pressed="${sel.has(t.slug)}">${t.label}</button>`)}</div>
  ${sug.st === "ok" && sug.d.length ? h`<div class="pad" style="padding-bottom:0"><b>ان لکھاریوں کو فالو کریں</b></div>${sug.d.map((w) => personRow(w))}` : (sug.st === "loading" ? loadingView() : "")}
  <div class="pad"><button class="btn" data-a="saveInterests">${p.onboarding ? "جاری رکھیں" : "محفوظ کریں"}</button>
  ${p.onboarding ? h`<button class="lnk" style="width:100%;margin-top:4px" data-a="skipOnboarding">ابھی چھوڑیں</button>` : ""}</div>`;
};

/* ----- acquisition survey ----- */
L.survey = () => { if (!S.fields["sv.src"]) S.fields["sv.src"] = ""; };
R.survey = () => {
  const sel = S.fields["sv.src"] || "";
  return h`${hdTab("آپ نے ہمارے بارے میں کیسے سنا؟")}
  <div class="pad" style="padding-bottom:0"><span class="mu">یہ جواب صرف یہ سمجھنے کے لیے ہے کہ لوگ ہم تک کیسے پہنچتے ہیں۔</span></div>
  <div class="cats wrap">${SURVEY_SOURCES.map((s) => h`<button data-a="pickSource" data-v="${s[0]}" class="${sel === s[0] ? "on" : ""}" aria-pressed="${sel === s[0]}">${s[1]}</button>`)}</div>
  ${sel === "other" ? h`<div class="pad" style="padding-top:0">${fieldInput("sv.other", { ph: "مختصراً بتائیں", max: 200, label: "دیگر ذریعہ" })}</div>` : ""}
  <div class="pad"><button class="btn" data-a="saveSurvey">جمع کریں</button><button class="lnk" style="width:100%;margin-top:4px" data-a="skipSurvey">ابھی چھوڑیں</button></div>`;
};

/* ---------------- actions ---------------- */
function startOtpCooldown() {
  clearInterval(otpTimer);
  S.otpLeft = OTP_COOLDOWN;
  otpTimer = setInterval(() => {
    S.otpLeft = Math.max(0, S.otpLeft - 1);
    const b = $("#resend");
    if (b) { b.disabled = S.otpLeft > 0; b.textContent = S.otpLeft > 0 ? "نیا کوڈ " + S.otpLeft + " سیکنڈ بعد" : "کوڈ دوبارہ بھیجیں"; }
    if (S.otpLeft === 0) clearInterval(otpTimer);
  }, 1000);
}

Object.assign(ACT, {
  go: (el) => { const v = el.dataset.v; clearFields("ob."); go(v); },
  guest: () => go("home"),
  google: (el) => guarded("auth", el, () => BE().auth.signInWithGoogle()),
  phoneSend: (el) => guarded("auth", el, async () => {
    const phone = toE164(S.fields["ob.ph"]);
    if (!phone) { toast("درست موبائل نمبر درج کریں (مثلاً 0300 1234567)"); return; }
    await BE().auth.sendPhoneCode(phone);
    S.fields["ob.phone"] = phone; S.fields["ob.otp"] = "";
    startOtpCooldown();
    go("otp");
  }),
  resend: (el) => guarded("auth", el, async () => {
    await BE().auth.sendPhoneCode(S.fields["ob.phone"]);
    startOtpCooldown(); toast("نیا کوڈ بھیج دیا گیا"); render({ keep: true });
  }),
  otpVerify: (el) => guarded("auth", el, async () => {
    const code = String(S.fields["ob.otp"] || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(code)) { toast("6 ہندسوں کا کوڈ درج کریں"); return; }
    const data = await BE().auth.verifyPhoneCode(S.fields["ob.phone"], code);
    const session = data && data.session;
    if (!session) throw new Error("no_session");
    await handleSession(session);
    clearFields("ob."); clearInterval(otpTimer);
    afterLogin();
  }),
  signout: (el) => guarded("auth", el, async () => { await BE().auth.signOut(); clearAccount(); go("splash"); }),
  pickInterest: (el) => {
    const set = new Set(S.fields["int.sel"] || []);
    const v = el.dataset.v;
    set.has(v) ? set.delete(v) : set.add(v);
    S.fields["int.sel"] = Array.from(set);
    render({ keep: true });
  },
  saveInterests: (el) => guarded("interests", el, async () => {
    const slugs = S.fields["int.sel"] || [];
    await BE().onboarding.saveInterests(slugs);
    S.interests = new Set(slugs);
    listReset("feed");
    if (S.params.onboarding) await finishInterests(); else { toast("آپ کی پسند محفوظ ہو گئی"); back(); }
  }),
  skipOnboarding: () => { ls.set("hl.onb." + S.user.id, true); finishInterests(true); },
  pickSource: (el) => { S.fields["sv.src"] = S.fields["sv.src"] === el.dataset.v ? "" : el.dataset.v; render({ keep: true }); },
  saveSurvey: (el) => guarded("survey", el, async () => {
    const src = S.fields["sv.src"];
    if (!src) { toast("ایک ذریعہ منتخب کریں"); return; }
    await BE().onboarding.submitAcquisitionSource(src, S.fields["sv.other"] || "");
    clearFields("sv."); ls.set("hl.sv." + S.user.id, true); go("home"); toast("شکریہ!");
  }),
  skipSurvey: () => { ls.set("hl.sv." + S.user.id, true); clearFields("sv."); go("home"); },
});

async function finishInterests(skipped) {
  ls.set("hl.onb." + S.user.id, true);
  let done = true;
  if (!ls.get("hl.sv." + S.user.id, false)) { try { done = await BE().onboarding.surveyDone(); } catch (_) { done = true; } }
  if (!done && !ls.get("hl.sv." + S.user.id, false)) go("survey"); else go("home");
  if (!skipped) toast("آپ کی پسند محفوظ ہو گئی");
}
