"use strict";
/* Writer support (person-to-person transfer). The app never touches money: it shows the writer's own
 * payment details and records the sender's "I sent it" report, which the writer can acknowledge. */

const methodLogo = (method) => method === "jazzcash"
  ? raw('<span class="lg" style="background:#d6232b">Jazz<span style="color:#ffd23f">Cash</span></span>')
  : method === "easypaisa" ? raw('<span class="lg" style="background:#2e9e45">easypaisa</span>')
  : h`<span class="lg" style="background:var(--ink);color:var(--s)">${ic("bank", 18)}</span>`;

async function copyText(text, message) {
  try { await navigator.clipboard.writeText(text); toast(message || "کاپی ہو گیا"); }
  catch (_) {
    const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); toast(message || "کاپی ہو گیا"); } catch (__) { toast("کاپی نہیں ہو سکا"); }
    t.remove();
  }
}

const DONATE_PRESETS = [100, 500, 1000, 2000];
const donateAmount = (s) => Math.floor(Number(s.custom ? s.custom : s.amt) || 0);

ACT.donate = (el) => {
  if (!needAuth("تعاون ریکارڈ کرنے کے لیے سائن اِن کریں۔")) return;
  const creatorId = el.dataset.id;
  if (S.me && creatorId === S.me.id) return;
  openSheet("donate", { creatorId, who: el.dataset.n || "", postId: el.dataset.p || "", step: 0, amt: 500, custom: "", method: "", opts: null, optsErr: "", err: "", qr: {}, note: "" });
  loadDonateOptions();
};
async function loadDonateOptions() {
  const s = S.sheet;
  if (!s || s.name !== "donate") return;
  try { s.opts = await BE().writerSupport.publicOptions(s.creatorId); s.optsErr = ""; }
  catch (e) { s.optsErr = errText(e); }
  if (S.sheet === s) renderSheet();
}
function optionFor(s, method) { return (s.opts || []).find((o) => o.method === method); }

SHEET.donate = (s) => (s.step ? donatePay(s) : donateAmountStep(s));
function donateAmountStep(s) {
  const amount = donateAmount(s);
  const ready = s.opts && s.opts.length;
  return h`<h3 class="hl" style="font-size:19px">لکھاری کی حوصلہ افزائی</h3><div class="mu">اپنی پسند کی رقم منتخب کریں۔ رقم آپ براہِ راست لکھاری کے اپنے اکاؤنٹ میں بھیجتے ہیں۔</div>
  <div class="amts">${DONATE_PRESETS.map((v) => h`<button data-a="donAmt" data-v="${v}" class="${!s.custom && v === s.amt ? "on" : ""}" aria-pressed="${!s.custom && v === s.amt}">${v} روپے</button>`)}</div>
  <input class="fld ltr" id="donCustom" data-i="donCustom" value="${s.custom}" inputmode="numeric" maxlength="7" placeholder="دوسری رقم (10 سے 10,00,000)" aria-label="دوسری رقم">
  ${s.optsErr ? h`<div class="notice bad">${s.optsErr} <button class="lnk" data-a="donRetry">دوبارہ کوشش کریں</button></div>` : !s.opts ? loadingView()
    : !ready ? h`<div class="notice">اس لکھاری نے ابھی تعاون کی تفصیل شامل نہیں کی۔</div>` : ""}
  ${s.err ? h`<div class="notice bad" role="alert">${s.err}</div>` : ""}
  <button class="btn au" style="margin-top:12px" data-a="donNext" ${ready ? "" : raw("disabled")}>${amount >= 10 ? rupees(amount) + " روپے بھیجنے کا طریقہ دیکھیں" : "بھیجنے کا طریقہ دیکھیں"}</button>`;
}
function donatePay(s) {
  const amount = donateAmount(s);
  const chosen = (s.opts || []).find((o) => o.id === s.method);
  return h`<h3 class="hl" style="font-size:19px">ادائیگی کا طریقہ</h3><div class="mu">${rupees(amount)} روپے ${s.who || "لکھاری"} کو بھیجنے کے لیے طریقہ منتخب کریں۔</div>
  ${["jazzcash", "easypaisa", "bank_transfer"].map((m) => {
    const o = optionFor(s, m), open = chosen && chosen.method === m;
    return h`<button class="pm ${open ? "on" : ""}" data-a="donMethod" data-v="${m}" ${o ? "" : raw("disabled")} aria-expanded="${!!open}">${methodLogo(m)}<b style="flex:1;text-align:start">${METHOD_LABEL[m]}</b>${o ? ic(open ? "down" : "chev", 16) : h`<span class="mu" style="font-size:12px">دستیاب نہیں</span>`}</button>
    ${open ? h`<div class="pd">${m === "bank_transfer"
      ? [["بینک", o.bank_name], ["اکاؤنٹ ٹائٹل", o.account_title], ["اکاؤنٹ نمبر / IBAN", o.account_identifier]].map((r) => h`<div class="dv"><span class="mu">${r[0]}</span><b>${r[1]}</b><button class="lnk" data-a="copy" data-t="${r[1]}">کاپی</button></div>`)
      : h`<div style="text-align:center;padding:8px 0">${s.qr[o.id] ? h`<img src="${s.qr[o.id]}" alt="QR کوڈ" class="qrbig"><div class="mu" style="font-size:12px">${METHOD_LABEL[m]} ایپ سے QR اسکین کریں</div>` : (s.qr[o.id] === false ? h`<div class="mu">QR لوڈ نہیں ہو سکا</div>` : loadingView())}</div>`}</div>` : ""}`;
  })}
  ${s.err ? h`<div class="notice bad" role="alert">${s.err}</div>` : ""}
  ${chosen ? h`<input class="fld" style="margin-top:10px" data-i="donNote" value="${s.note}" maxlength="500" placeholder="لکھاری کے لیے پیغام (اختیاری)" aria-label="پیغام">
  <button class="btn au" style="margin-top:10px" data-a="donSent">میں نے رقم بھیج دی</button>
  <div class="mu" style="font-size:12px;margin-top:4px">یہ بٹن صرف آپ کی اطلاع درج کرتا ہے، رقم ایپ کے ذریعے منتقل نہیں ہوتی۔</div>` : ""}
  <button class="lnk" style="width:100%;margin-top:6px" data-a="donBack">رقم تبدیل کریں</button>`;
}
INPUT.donCustom = (t) => { const s = S.sheet; if (!s) return; t.value = t.value.replace(/\D/g, ""); s.custom = t.value; };
INPUT.donNote = (t) => { if (S.sheet) S.sheet.note = t.value; };

Object.assign(ACT, {
  copy: (el) => copyText(el.dataset.t),
  donAmt: (el) => { S.sheet.amt = Number(el.dataset.v); S.sheet.custom = ""; S.sheet.err = ""; renderSheet(); },
  donRetry: () => { S.sheet.optsErr = ""; S.sheet.opts = null; renderSheet(); loadDonateOptions(); },
  donBack: () => { S.sheet.step = 0; S.sheet.err = ""; renderSheet(); },
  donNext: () => {
    const s = S.sheet, a = donateAmount(s);
    if (a < 10 || a > 1000000) { s.err = "رقم 10 سے 10,00,000 روپے کے درمیان ہونی چاہیے۔"; renderSheet(); return; }
    s.err = ""; s.step = 1; s.method = ""; renderSheet();
  },
  donMethod: async (el) => {
    const s = S.sheet, o = optionFor(s, el.dataset.v);
    if (!o) return;
    s.method = s.method === o.id ? "" : o.id; s.err = "";
    renderSheet();
    if (s.method && o.qr_object_path && s.qr[o.id] === undefined) {
      try { s.qr[o.id] = await BE().writerSupport.qrUrl(o.qr_object_path); } catch (_) { s.qr[o.id] = false; }
      if (S.sheet === s) renderSheet();
    }
  },
  donSent: (el) => guarded("claim", el, async () => {
    const s = S.sheet;
    try {
      await BE().writerSupport.createTransferClaim({ creatorId: s.creatorId, paymentOptionId: s.method, amount: donateAmount(s), note: s.note });
    } catch (e) { s.err = errText(e); renderSheet(); return; }
    vclear("claims"); closeSheet(); toast("شکریہ! تعاون درج ہو گیا");
  }),
});
