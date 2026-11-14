"use strict";
/* Join the team, writer badges, platform support (Pakistan pilot). */

/* ---------------- team ---------------- */
L.team = (p, force) => { fetchKey("team", () => BE().team.mine(), { force, ttl: 30000 }); };
R.team = () => {
  const mine = vget("team");
  const pending = (mine.d || []).some((a) => ["received", "in_review"].includes(a.status));
  return h`${hd("ہماری ٹیم میں شامل ہوں")}<div class="pad"><p class="mu">ہم لکھاری کو بہتر بنانے میں مدد کرنا چاہتے ہیں؟ اپنے بارے میں بتائیں، ٹیم جائزہ لے کر رابطہ کرے گی۔</p>
  ${pending ? h`<div class="notice">آپ کی ایک درخواست پہلے سے زیرِ جائزہ ہے۔</div>` : h`
  <label class="mu" for="f-tm_area">کس شعبے میں؟</label><select class="fld" id="f-tm_area" data-f="tm.area">${optionList(TEAM_AREAS, fv("tm.area", "proofreading"))}</select>
  <label class="mu lbl" for="f-tm_why">آپ ہمارے ساتھ کیوں کام کرنا چاہتے ہیں؟ (کم از کم 20 حروف)</label>${fieldArea("tm.why", { rows: 4, max: 3000 })}
  <label class="mu lbl" for="f-tm_skills">مہارتیں (اختیاری)</label>${fieldArea("tm.skills", { rows: 2, max: 1500 })}
  <label class="mu lbl" for="f-tm_avail">دستیاب وقت (اختیاری)</label>${fieldInput("tm.avail", { max: 300 })}
  <div class="mu hint">آپ کی درخواست صرف آپ اور ہماری ٹیم دیکھ سکتی ہے۔</div>
  <button class="btn" style="margin-top:10px" data-a="teamSend">درخواست بھیجیں</button>`}</div>
  <div class="pad" style="padding-bottom:0"><b>میری درخواستیں</b></div>${mine.st === "loading" && !mine.d ? loadingView() : mine.st === "err" && !mine.d ? errorView(mine.e, "teamRetry")
    : (mine.d || []).length ? mine.d.map((a) => h`<div class="li" style="cursor:default;flex-wrap:wrap"><div style="flex:1"><b>${labelOf(TEAM_AREAS, a.team_area)}</b><small>${ago(a.created_at)}</small>${a.staff_note ? h`<small class="note">ٹیم کا جواب: ${a.staff_note}</small>` : ""}</div>${statusChip(STATUS_TEXT.team[a.status] || a.status, statusTone(a.status))}</div>`)
    : emptyView("ابھی کوئی درخواست نہیں۔")}`;
};
Object.assign(ACT, {
  teamRetry: () => { L.team({}, true); render({ keep: true }); },
  teamSend: (el) => guarded("team", el, async () => {
    const why = String(S.fields["tm.why"] || "").trim();
    if (why.length < 20) { toast("اپنے بارے میں کم از کم 20 حروف لکھیں"); return; }
    await BE().team.apply({ area: S.fields["tm.area"] || "proofreading", skills: S.fields["tm.skills"] || "", availability: S.fields["tm.avail"] || "", motivation: why, countryCode: S.me.country || null });
    clearFields("tm."); vclear("team"); L.team({}, true); render({ keep: true, force: true }); toast("آپ کی درخواست موصول ہو گئی");
  }),
});

/* ---------------- badges ---------------- */
L.badges = (p, force) => {
  fetchKey("mybadges", async () => (await BE().badges.mine()), { force, ttl: 30000 });
  fetchKey("badges:" + S.me.id, async () => (await BE().profiles.badges(S.me.id)).map((b) => b.badge_type), { force });
};
R.badges = () => {
  const apps = vget("mybadges"), active = vdata("badges:" + S.me.id) || [];
  const pendingOf = (t) => (apps.d || []).some((a) => a.badge_type === t && ["received", "in_review"].includes(a.status));
  const choices = BADGE_TYPES.filter((b) => !active.includes(b[0]) && !pendingOf(b[0]));
  const sel = S.fields["bd.type"] || (choices[0] && choices[0][0]) || "";
  return h`${hd("لکھاری بیج")}<div class="pad"><p class="mu">بیج آپ کے پروفائل پر نظر آتا ہے۔ درخواست کا فیصلہ ہماری ٹیم کرتی ہے۔</p>
  ${active.length ? h`<div class="chips" style="justify-content:flex-start">${badgeChips(active)}</div>` : ""}
  ${choices.length ? h`<div class="cats wrap" style="padding-inline:0">${choices.map((b) => h`<button data-a="pickBadge" data-v="${b[0]}" class="${sel === b[0] ? "on" : ""}" aria-pressed="${sel === b[0]}">${b[1]}</button>`)}</div>
    <div class="mu hint">${BADGE_HELP[sel] || ""}</div>
    <label class="mu lbl" for="f-bd_note">اپنے کام کے بارے میں (اختیاری)</label>${fieldArea("bd.note", { rows: 3, max: 2000, ph: "اپنی بہترین تحریروں کا ذکر کریں" })}
    <button class="btn" style="margin-top:10px" data-a="badgeSend">درخواست بھیجیں</button>` : h`<div class="notice">اس وقت کوئی نئی درخواست ممکن نہیں۔</div>`}</div>
  <div class="pad" style="padding-bottom:0"><b>میری درخواستیں</b></div>${apps.st === "loading" && !apps.d ? loadingView() : apps.st === "err" && !apps.d ? errorView(apps.e, "badgesRetry")
    : (apps.d || []).length ? apps.d.map((a) => h`<div class="li" style="cursor:default;flex-wrap:wrap"><div style="flex:1"><b>${labelOf(BADGE_TYPES, a.badge_type)}</b><small>${ago(a.created_at)}</small>${a.staff_note ? h`<small class="note">ٹیم کا جواب: ${a.staff_note}</small>` : ""}</div>${statusChip(STATUS_TEXT.badge[a.status] || a.status, statusTone(a.status))}</div>`)
    : emptyView("ابھی کوئی درخواست نہیں۔")}`;
};
Object.assign(ACT, {
  badgesRetry: () => { L.badges({}, true); render({ keep: true }); },
  pickBadge: (el) => { S.fields["bd.type"] = el.dataset.v; render({ keep: true }); },
  badgeSend: (el) => guarded("badge", el, async () => {
    const apps = vdata("mybadges") || [], active = vdata("badges:" + S.me.id) || [];
    const type = S.fields["bd.type"] || (BADGE_TYPES.find((b) => !active.includes(b[0]) && !apps.some((a) => a.badge_type === b[0] && ["received", "in_review"].includes(a.status))) || [])[0];
    if (!type) return;
    await BE().badges.apply({ badgeType: type, portfolioNote: S.fields["bd.note"] || "" });
    clearFields("bd."); vclear("mybadges"); L.badges({}, true); render({ keep: true, force: true }); toast("آپ کی درخواست موصول ہو گئی");
  }),
});

/* ---------------- platform support (Pakistan pilot) ---------------- */
L.platform = (p, force) => {
  fetchKey("pf:accounts", () => BE().platformDonations.accounts(), { force, ttl: 60000 });
  fetchKey("pf:mine", () => BE().platformDonations.mine(), { force, ttl: 30000 });
};
R.platform = () => {
  const acc = vget("pf:accounts"), mine = vget("pf:mine");
  const pk = S.me.country === "PK";
  const accounts = acc.d || [];
  const method = S.fields["pf.method"] || (accounts[0] && accounts[0].method) || "";
  return h`${hd("پلیٹ فارم کی معاونت")}<div class="pad"><p class="mu">ہم لکھاری کو چلانے میں مدد کے لیے نیچے دیے گئے اکاؤنٹ میں رقم بھیجیں، پھر یہاں اطلاع درج کریں۔ ٹیم تصدیق کے بعد آپ کو بتائے گی۔ فی الحال یہ سہولت صرف پاکستان کے لیے ہے۔</p>
  ${!pk ? h`<div class="notice">اس سہولت کے لیے پروفائل میں ملک “پاکستان” منتخب ہونا ضروری ہے۔ <button class="lnk" data-a="editProfile">پروفائل ایڈٹ کریں</button></div>`
    : acc.st === "loading" && !acc.d ? loadingView() : acc.st === "err" && !acc.d ? errorView(acc.e, "platformRetry")
    : !accounts.length ? h`<div class="notice">ابھی کوئی اکاؤنٹ دستیاب نہیں۔ کچھ دیر بعد دیکھیں۔</div>`
    : h`${accounts.map((a) => h`<div class="acc"><div class="row" style="border:0;margin:0;padding:0">${methodLogo(a.method)}<b>${a.label || METHOD_LABEL[a.method]}</b></div>
      ${[["بینک", a.bank_name], ["اکاؤنٹ ٹائٹل", a.account_title], ["اکاؤنٹ نمبر / IBAN", a.account_identifier]].filter((r) => r[1]).map((r) => h`<div class="dv"><span class="mu">${r[0]}</span><b>${r[1]}</b><button class="lnk" data-a="copy" data-t="${r[1]}">کاپی</button></div>`)}
      ${a.instructions ? h`<div class="mu" style="font-size:13px">${a.instructions}</div>` : ""}</div>`)}
    <b style="display:block;margin-top:14px">رقم بھیجنے کے بعد اطلاع دیں</b>
    <label class="mu lbl" for="f-pf_amount">رقم (روپے، کم از کم 100)</label>${fieldInput("pf.amount", { mode: "numeric", max: 7, ltr: true })}
    <label class="mu lbl" for="pf-method">طریقہ</label><select class="fld" id="pf-method" data-f="pf.method">${optionList(Array.from(new Set(accounts.map((a) => a.method))).map((m) => [m, METHOD_LABEL[m]]), method)}</select>
    <label class="mu lbl" for="f-pf_ref">ٹرانزیکشن نمبر (اختیاری)</label>${fieldInput("pf.ref", { max: 120, ltr: true })}
    <label class="mu lbl" for="f-pf_note">پیغام (اختیاری)</label>${fieldArea("pf.note", { rows: 2, max: 1000 })}
    <button class="btn" style="margin-top:10px" data-a="platformSend">اطلاع بھیجیں</button>`}</div>
  <div class="pad" style="padding-bottom:0"><b>میری اطلاعات</b></div>${mine.st === "loading" && !mine.d ? loadingView() : mine.st === "err" && !mine.d ? errorView(mine.e, "platformRetry")
    : (mine.d || []).length ? mine.d.map((d) => h`<div class="li" style="cursor:default;flex-wrap:wrap"><div style="flex:1"><b>${rupees(d.amount)} روپے</b><small>${METHOD_LABEL[d.method] || d.method} · ${ago(d.created_at)}</small>${d.staff_note ? h`<small class="note">ٹیم کا جواب: ${d.staff_note}</small>` : ""}</div>${statusChip(STATUS_TEXT.platform[d.status] || d.status, statusTone(d.status))}</div>`)
    : emptyView("ابھی کوئی اطلاع نہیں۔")}`;
};
Object.assign(ACT, {
  platformRetry: () => { L.platform({}, true); render({ keep: true }); },
  platformSend: (el) => guarded("platform", el, async () => {
    const amount = Number(String(S.fields["pf.amount"] || "").replace(/\D/g, ""));
    if (!(amount >= 100 && amount <= 5000000)) { toast("رقم 100 سے 50,00,000 روپے کے درمیان ہونی چاہیے"); return; }
    const accounts = vdata("pf:accounts") || [];
    const method = S.fields["pf.method"] || (accounts[0] && accounts[0].method);
    await BE().platformDonations.submit({ amount, method, transactionReference: S.fields["pf.ref"] || "", note: S.fields["pf.note"] || "" });
    clearFields("pf."); vclear("pf:mine"); L.platform({}, true); render({ keep: true, force: true }); toast("شکریہ! آپ کی اطلاع موصول ہو گئی");
  }),
});
