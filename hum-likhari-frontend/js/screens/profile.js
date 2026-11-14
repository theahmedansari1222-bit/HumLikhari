"use strict";
/* Own profile, profile editor (with avatar crop and payment details). */

/* ---------------- own profile ---------------- */
const mineKey = () => "mine:published";
const savedKey = () => "saved";
function loadMine(force, more) {
  return listLoad(mineKey(), (from, size) => postPage(() => BE().posts.mine({ status: "published", limit: size, from })), { force, more });
}
function loadSaved(force, more) {
  return listLoad(savedKey(), (from, size) => postPage(() => BE().posts.saved({ limit: size, from })), { force, more });
}
L.profile = (p, force) => {
  if (!S.user) return;
  fetchKey("stats:" + S.me.id, () => BE().profiles.stats(S.me.id), { force });
  fetchKey("badges:" + S.me.id, async () => (await BE().profiles.badges(S.me.id)).map((b) => b.badge_type), { force });
  loadMine(force);
  if (S.ptab === 1) loadSaved(force);
};
R.profile = () => {
  const me = S.me;
  const tab = S.ptab || 0;
  const list = listOf(tab ? savedKey() : mineKey());
  const stats = vdata("stats:" + me.id), badges = vdata("badges:" + me.id);
  const actions = h`<div class="pad" style="padding-top:0;display:flex;gap:8px"><button class="btn o" data-a="editProfile">پروفائل ایڈٹ کریں</button><button class="btn o" data-a="shareProfile">شیئر کریں</button></div>`;
  return h`<div class="hdr" style="border:0"><span class="rt"></span><span></span><button class="ic" data-a="go" data-v="settings" aria-label="ترتیبات">${ic("sliders")}</button></div>
  ${profileHeader(me, stats, badges, actions)}
  <div class="tabs">${["میری تحریریں", "محفوظ"].map((t, i) => h`<button data-a="ptab" data-v="${i}" class="${i === tab ? "on" : ""}">${t}</button>`)}</div>
  ${list.items.length ? h`${list.items.map(postRow)}${listFooter(list, "profileMore")}`
    : list.loading ? loadingView() : list.err ? errorView(list.err, "profileMore")
    : emptyView(tab ? "ابھی کوئی تحریر محفوظ نہیں۔ تحریر پر نشان لگا کر بعد میں پڑھیں۔" : "آپ نے ابھی کوئی تحریر شائع نہیں کی۔", tab ? "" : "tab", "پہلی تحریر لکھیں", "write")}`;
};
Object.assign(ACT, {
  ptab: (el) => { S.ptab = Number(el.dataset.v); if (S.ptab === 1) loadSaved(false); render({ keep: true }); },
  profileMore: () => ((S.ptab || 0) ? loadSaved(false, true) : loadMine(false, true)),
  shareProfile: () => copyText(linkFor("user", S.me.username), "پروفائل کا لنک کاپی ہو گیا"),
  editProfile: () => { S.ed = newProfileEditor(); go("editp"); },
});

/* ---------------- editor ---------------- */
function newProfileEditor() {
  const me = S.me;
  return {
    name: me.name, username: me.username, bio: me.bio, country: me.country || "",
    avatarFile: null, avatarPreview: "", avatarRemoved: false,
    payOn: true, payLoaded: false, payLoading: false, payErr: "",
    jc: { path: null, url: "", file: null, preview: "" }, ep: { path: null, url: "", file: null, preview: "" },
    bank_name: "", bank_title: "", bank_iban: "", existing: {},
  };
}
async function loadMyPayments() {
  const e = S.ed;
  e.payLoading = true; e.payErr = "";
  try {
    const opts = await BE().writerSupport.myOptions();
    opts.forEach((o) => {
      e.existing[o.method] = true;
      if (o.method === "bank_transfer") { e.bank_name = o.bank_name || ""; e.bank_title = o.account_title || ""; e.bank_iban = o.account_identifier || ""; }
      else { const k = o.method === "jazzcash" ? "jc" : "ep"; e[k].path = o.qr_object_path; }
    });
    e.payOn = opts.length ? opts.some((o) => o.is_public && o.is_active) : true;
    e.payLoaded = true;
    await Promise.allSettled(["jc", "ep"].map(async (k) => { if (e[k].path) e[k].url = await BE().writerSupport.qrUrl(e[k].path); }));
  } catch (err) { e.payErr = errText(err); }
  e.payLoading = false;
  softRender();
}
L.editp = () => { if (!S.ed) S.ed = newProfileEditor(); if (!S.ed.payLoaded && !S.ed.payLoading) loadMyPayments(); };

function qrField(k, method, name) {
  const m = S.ed[k], shown = m.preview || m.url;
  return h`<div class="qrf"><div class="mu lbl">${methodLogo(method)}${name} کا QR کوڈ</div><div class="row" style="margin-top:4px">${shown
    ? h`<img class="qrthumb" src="${shown}" alt="${name} QR"><label class="lnk" style="cursor:pointer"><input type="file" accept="image/jpeg,image/png,image/webp" data-file="qr${k}" hidden>تبدیل کریں</label><button class="lnk" data-a="qrRemove" data-v="${k}" style="color:var(--hr);margin-inline-start:auto">ہٹائیں</button>`
    : h`<label class="lnk" style="cursor:pointer"><input type="file" accept="image/jpeg,image/png,image/webp" data-file="qr${k}" hidden>${name} ایپ سے QR کی تصویر اپ لوڈ کریں</label>`}</div></div>`;
}
function paySection() {
  const e = S.ed;
  if (e.payErr) return h`<div class="notice bad">${e.payErr} <button class="lnk" data-a="payRetry">دوبارہ کوشش کریں</button></div>`;
  if (!e.payLoaded) return loadingView();
  return h`<div class="mu" style="font-size:12px">جاز کیش اور ایزی پیسہ ایپ میں اپنا QR کوڈ کھول کر اس کا اسکرین شاٹ لیں اور یہاں اپ لوڈ کریں۔ اس طرح آپ کا نمبر ظاہر نہیں ہوتا۔</div>
  ${qrField("jc", "jazzcash", "جاز کیش")}${qrField("ep", "easypaisa", "ایزی پیسہ")}
  <div class="mu lbl">${methodLogo("bank_transfer")}بینک کا نام</div><input class="fld" data-e="bank_name" value="${e.bank_name}" maxlength="80" aria-label="بینک کا نام">
  <div class="mu lbl">اکاؤنٹ ٹائٹل</div><input class="fld" data-e="bank_title" value="${e.bank_title}" maxlength="80" aria-label="اکاؤنٹ ٹائٹل">
  <div class="mu lbl">اکاؤنٹ نمبر / IBAN</div><input class="fld ltr" data-e="bank_iban" value="${e.bank_iban}" maxlength="40" inputmode="text" placeholder="PK00 XXXX XXXX XXXX XXXX XXXX" aria-label="اکاؤنٹ نمبر">
  <button class="row" role="switch" aria-checked="${e.payOn}" data-a="payOnSw" style="margin-top:12px">قارئین کو یہ تفصیل دکھائیں<span class="sw ${e.payOn ? "on" : ""}"></span></button>`;
}
PARTIAL.editp = () => [["#paysec", paySection()]];

R.editp = () => {
  const e = S.ed;
  if (!e) return h`${hd("")}${loadingView()}`;
  const preview = e.avatarRemoved ? null : (e.avatarPreview || (S.me && S.me.avatarUrl));
  return h`${hd("پروفائل ایڈٹ کریں", h`<button class="pill" data-a="saveProfile">محفوظ کریں</button>`)}
  <div class="pad" style="text-align:center"><button class="avw" data-a="avatarSheet" aria-label="تصویر تبدیل کریں"><span class="av" style="width:96px;height:96px;font-size:40px;margin:0;background:${preview ? "var(--g)" : "hsl(" + avatarHue(e.name || "؟") + " 38% 36%)"}">${preview ? h`<img src="${preview}" alt="">` : (e.name || "؟").trim().charAt(0)}</span><span class="cam">${ic("camera", 16)}</span></button><div><button class="lnk" data-a="avatarSheet">تصویر تبدیل کریں</button></div></div>
  <div class="pad" style="padding-top:0"><label class="mu" for="e-name">نام</label><input class="fld" id="e-name" data-e="name" value="${e.name}" maxlength="80">
  <label class="mu lbl" for="e-user">ہینڈل</label><input class="fld ltr" id="e-user" data-e="username" value="${e.username}" maxlength="24" autocapitalize="none" autocomplete="off" spellcheck="false">
  <div class="mu hint">صرف انگریزی چھوٹے حروف، اعداد اور _ (3 سے 24 حروف)</div>
  <label class="mu lbl" for="e-bio">تعارف</label><textarea class="fld" id="e-bio" data-e="bio" rows="3" maxlength="300" placeholder="اپنے بارے میں چند الفاظ…">${e.bio}</textarea>
  <label class="mu lbl" for="e-country">ملک</label><select class="fld" id="e-country" data-e="country">${optionList(COUNTRIES, e.country)}</select></div>
  <div class="pad" style="padding-top:0"><b>تعاون وصول کرنے کی تفصیل</b><div class="mu" style="font-size:12px">یہ تفصیل قارئین کو تعاون بھیجتے وقت دکھائی جائے گی۔ جو خانہ خالی ہو گا وہ نہیں دکھایا جائے گا۔</div><div id="paysec">${paySection()}</div></div>`;
};

Object.assign(ACT, {
  payRetry: () => { S.ed.payErr = ""; loadMyPayments(); render({ keep: true, force: true }); },
  payOnSw: () => { S.ed.payOn = !S.ed.payOn; render({ keep: true, force: true }); },
  avatarSheet: () => openSheet("pic"),
  avatarRemove: () => { S.ed.avatarFile = null; S.ed.avatarPreview = ""; S.ed.avatarRemoved = true; closeSheet(); render({ keep: true, force: true }); toast("تصویر ہٹا دی جائے گی، محفوظ کریں پر ٹیپ کریں"); },
  qrRemove: (el) => { const m = S.ed[el.dataset.v]; if (m.preview) URL.revokeObjectURL(m.preview); S.ed[el.dataset.v] = { path: null, url: "", file: null, preview: "" }; render({ keep: true, force: true }); },
  saveProfile: (el) => guarded("psave", el, async () => {
    const e = S.ed;
    const name = e.name.trim();
    const username = e.username.trim().toLowerCase();
    if (!name) { toast("نام خالی نہیں ہو سکتا"); return; }
    if (!/^[a-z0-9_]{3,24}$/.test(username)) { toast("ہینڈل 3 سے 24 حروف کا ہو: انگریزی چھوٹے حروف، اعداد اور _"); return; }
    const bank = [e.bank_name, e.bank_title, e.bank_iban].map((x) => x.trim());
    if (bank.some(Boolean) && !bank.every(Boolean)) { toast("بینک کی تینوں تفصیلات (نام، ٹائٹل، اکاؤنٹ نمبر) لکھیں"); return; }
    const iban = bank[2].toUpperCase().replace(/\s+/g, "");
    if (bank.every(Boolean) && !/^[A-Z0-9]{6,34}$/.test(iban)) { toast("اکاؤنٹ نمبر / IBAN درست نہیں"); return; }
    let row = await BE().profiles.update({ displayName: name, username, bio: e.bio.trim(), countryCode: e.country || null });
    if (e.avatarFile) row = (await BE().profiles.uploadAvatar(e.avatarFile)).profile;
    else if (e.avatarRemoved && S.me.avatarPath) row = await BE().profiles.removeAvatar();
    S.me = mapProfile(row);
    if (e.payLoaded) await savePayments(e, bank, iban);
    S.posts.forEach((p) => { if (p.authorId === S.me.id) { p.name = S.me.name; p.username = S.me.username; p.avatarUrl = S.me.avatarUrl; } });
    vclear("profile:"); vclear("stats:");
    if (e.avatarPreview) URL.revokeObjectURL(e.avatarPreview);
    S.ed = null;
    back(); toast("پروفائل محفوظ ہو گیا");
  }),
});

async function savePayments(e, bank, iban) {
  const on = e.payOn;
  const W = BE().writerSupport;
  for (const [k, method] of [["jc", "jazzcash"], ["ep", "easypaisa"]]) {
    const m = e[k];
    if (m.file) {
      const path = await W.uploadQr(m.file);
      await W.saveOption({ method, displayLabel: METHOD_LABEL[method], qrObjectPath: path, isPublic: on, isActive: on });
    } else if (m.path) {
      await W.saveOption({ method, displayLabel: METHOD_LABEL[method], qrObjectPath: m.path, isPublic: on, isActive: on });
    } else if (e.existing[method]) await W.removeOption(method);
  }
  if (bank.every(Boolean)) await W.saveOption({ method: "bank_transfer", displayLabel: bank[0], bankName: bank[0], accountTitle: bank[1], accountIdentifier: iban, isPublic: on, isActive: on });
  else if (e.existing.bank_transfer) await W.removeOption("bank_transfer");
}

/* QR pickers */
async function pickQr(k, file) {
  try {
    const png = await resizeImage(file, 640, "image/png");
    const m = S.ed[k];
    if (m.preview) URL.revokeObjectURL(m.preview);
    S.ed[k] = { path: null, url: "", file: png, preview: URL.createObjectURL(png) };
    render({ keep: true, force: true });
  } catch (_) { toast("تصویر کھل نہیں سکی"); }
}
FILE.qrjc = (f) => pickQr("jc", f);
FILE.qrep = (f) => pickQr("ep", f);

/* ---------------- avatar crop ---------------- */
FILE.avatar = (file) => {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast("صرف JPG، PNG یا WebP تصویر منتخب کریں"); return; }
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    URL.revokeObjectURL(url);
    const k = Math.min(1, 1600 / Math.max(im.width, im.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    S.crop = { im: c, rot: 0, z: 1, x: 0, y: 0 };
    closeSheet(); go("crop");
  };
  im.onerror = () => { URL.revokeObjectURL(url); toast("تصویر کھل نہیں سکی"); };
  im.src = url;
};
const CP = new Map();
let cd0 = 1, cz0 = 1;
function cropClamp() {
  const C = S.crop, r = C.rot % 2, w = r ? C.im.height : C.im.width, hgt = r ? C.im.width : C.im.height;
  const k = 600 / Math.min(w, hgt) * C.z, mx = (w * k - 600) / 2, my = (hgt * k - 600) / 2;
  C.x = Math.max(-mx, Math.min(mx, C.x)); C.y = Math.max(-my, Math.min(my, C.y));
}
function cropDraw(canvas, V) {
  const C = S.crop, g = canvas.getContext("2d"), r = C.rot % 2, w = r ? C.im.height : C.im.width, hgt = r ? C.im.width : C.im.height;
  const k = V / Math.min(w, hgt) * C.z, f = V / 600;
  g.fillStyle = "#000"; g.fillRect(0, 0, V, V); g.save();
  g.translate(V / 2 + C.x * f, V / 2 + C.y * f); g.rotate(C.rot * Math.PI / 2); g.scale(k, k);
  g.drawImage(C.im, -C.im.width / 2, -C.im.height / 2); g.restore();
}
function cropUpdate() { const c = $("#cc"); if (!c || !S.crop) return; cropClamp(); cropDraw(c, 600); const z = $("#czm"); if (z) z.value = S.crop.z; }
AFTER.crop = cropUpdate;
R.crop = () => h`${hd("تصویر ایڈجسٹ کریں", h`<button class="pill" data-a="cropDone">ہو گیا</button>`)}
<div class="pad" style="text-align:center"><div class="cw"><canvas id="cc" width="600" height="600" aria-label="تصویر کا پیش منظر"></canvas><div class="cmk"></div></div>
<div class="mu" style="font-size:13px;margin-top:10px">کھینچ کر جگہ درست کریں، دو انگلیوں سے زوم کریں</div>
<div class="crow"><button class="ic" data-a="cropRotate" aria-label="گھمائیں">${ic("rotate")}</button><input type="range" id="czm" data-i="cropZoom" min="1" max="4" step="0.01" value="1" aria-label="زوم"><button class="lnk" data-a="cropReset">ری سیٹ</button></div></div>`;
INPUT.cropZoom = (t) => { if (S.crop) { S.crop.z = Number(t.value); cropUpdate(); } };
Object.assign(ACT, {
  cropRotate: () => { S.crop.rot = (S.crop.rot + 1) % 4; S.crop.x = S.crop.y = 0; cropUpdate(); },
  cropReset: () => { Object.assign(S.crop, { z: 1, x: 0, y: 0, rot: 0 }); cropUpdate(); },
  cropDone: (el) => guarded("crop", el, async () => {
    const c = document.createElement("canvas"); c.width = c.height = 480; cropDraw(c, 480);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    if (!blob) throw new Error("image_encode_failed");
    const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
    if (S.ed.avatarPreview) URL.revokeObjectURL(S.ed.avatarPreview);
    Object.assign(S.ed, { avatarFile: file, avatarPreview: URL.createObjectURL(file), avatarRemoved: false });
    S.crop = null; back(); toast("تصویر لگ گئی");
  }),
});
document.addEventListener("pointerdown", (e) => {
  if (e.target.id !== "cc" || !S.crop) return;
  e.target.setPointerCapture(e.pointerId); CP.set(e.pointerId, [e.clientX, e.clientY]);
  if (CP.size === 2) { const [a, b] = Array.from(CP.values()); cd0 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; cz0 = S.crop.z; }
});
document.addEventListener("pointermove", (e) => {
  const p = CP.get(e.pointerId);
  if (!p || !S.crop) return;
  const f = 600 / $("#cc").getBoundingClientRect().width;
  if (CP.size === 1) { S.crop.x += (e.clientX - p[0]) * f; S.crop.y += (e.clientY - p[1]) * f; }
  CP.set(e.pointerId, [e.clientX, e.clientY]);
  if (CP.size === 2) { const [a, b] = Array.from(CP.values()); S.crop.z = Math.max(1, Math.min(4, cz0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / cd0)); }
  cropUpdate();
});
const cropPointerEnd = (e) => CP.delete(e.pointerId);
document.addEventListener("pointerup", cropPointerEnd);
document.addEventListener("pointercancel", cropPointerEnd);
document.addEventListener("wheel", (e) => {
  if (e.target.id !== "cc" || !S.crop) return;
  e.preventDefault(); S.crop.z = Math.max(1, Math.min(4, S.crop.z * (e.deltaY < 0 ? 1.08 : 0.93))); cropUpdate();
}, { passive: false });
