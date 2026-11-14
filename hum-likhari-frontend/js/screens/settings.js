"use strict";
/* Settings, support history, help & tickets, blocked people, legal text. */

/* ---------------- preferences ---------------- */
function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}
function loadPrefs() {
  const p = ls.get("hl.prefs", {}) || {};
  if (THEMES.some((t) => t[0] === p.theme)) S.theme = p.theme;
  if (Number.isInteger(p.fs) && p.fs >= 0 && p.fs <= 3) S.fs = p.fs; else S.fs = 1;
  S.nk = !!p.nk;
  applyTheme(S.theme);
}
const savePrefs = () => ls.set("hl.prefs", { theme: S.theme, fs: S.fs, nk: S.nk });

const SETTING_ROWS = [
  ["sliders", "میری پسند", "interests"], ["heart", "تعاون کی تاریخ", "history"], ["block", "بلاک کیے گئے لوگ", "blocked"],
  ["users", "ہماری ٹیم میں شامل ہوں", "team"], ["award", "لکھاری بیج کی درخواست", "badges"], ["gift", "پلیٹ فارم کی معاونت", "platform"],
  ["mail", "مدد اور رابطہ", "help"],
];
R.settings = () => h`${hd("ترتیبات")}<div class="pad" style="padding-bottom:4px"><b>تھیم</b></div>
<div class="thm">${THEMES.map((t) => h`<button data-a="theme" data-v="${t[0]}" class="${S.theme === t[0] ? "on" : ""}" aria-pressed="${S.theme === t[0]}"><i style="background:${t[2]}">${t[3] ? h`<b style="background:${t[3]}"></b>` : ""}</i>${t[1]}</button>`)}</div>
${SETTING_ROWS.map((x) => h`<button class="mrow" data-a="settingsGo" data-v="${x[2]}">${ic(x[0])}${x[1]}<span class="chev">${ic("chev", 16)}</span></button>`)}
${[["doc", "شرائط و ضوابط", "t"], ["lock", "پرائیویسی پالیسی", "p"]].map((x) => h`<button class="mrow" data-a="legal" data-v="${x[2]}">${ic(x[0])}${x[1]}<span class="chev">${ic("chev", 16)}</span></button>`)}
<button class="mrow" data-a="signout">${ic("out")}لاگ آؤٹ</button><button class="mrow rd" data-a="deleteAccountAsk">${ic("trash")}اکاؤنٹ ڈیلیٹ کریں</button>`;
Object.assign(ACT, {
  theme: (el) => { S.theme = el.dataset.v; applyTheme(S.theme); savePrefs(); render({ keep: true }); },
  settingsGo: (el) => { const v = el.dataset.v; go(v, v === "interests" ? { onboarding: false } : {}); },
  legal: (el) => go("legal", { k: el.dataset.v }),
});
R.legal = (p) => {
  const l = LEGAL[p.k] || LEGAL.t;
  return h`${hd(l[0])}<div class="pad body"><div class="mu" style="font-size:12px;margin-bottom:8px">نمونہ متن — اصل ایپ میں قانونی ماہر سے تیار کروائیں۔</div>${l[1].map((t) => h`<p>${t}</p>`)}</div>`;
};

/* ---------------- support history (writer <-> reader) ---------------- */
L.history = (p, force) => { if (S.user) fetchKey("claims", () => BE().writerSupport.history(), { force, ttl: 30000 }); };
function claimRows(tab) {
  const rows = vdata("claims") || [];
  return rows.filter((c) => (tab ? c.sender_id === S.me.id : c.creator_id === S.me.id));
}
R.history = (p) => {
  const tab = p.tab || 0, st = vget("claims");
  const rows = claimRows(tab);
  const total = rows.filter((c) => c.status !== "cancelled").reduce((s, c) => s + Number(c.amount || 0), 0);
  const body = st.st === "loading" && !st.d ? loadingView() : st.st === "err" && !st.d ? errorView(st.e, "historyRetry")
    : rows.length ? rows.map((c) => {
      const other = mapPerson(tab ? (c.creator || {}) : (c.sender || {}));
      const canAck = !tab && c.status === "sender_reported_sent", canCancel = tab && c.status === "sender_reported_sent";
      return h`<div class="li" style="cursor:default;flex-wrap:wrap">${avatar(other)}<div style="flex:1"><b>${other.name || "قاری"}</b><small>${ago(c.created_at)}</small>${c.sender_note ? h`<small class="note">«${c.sender_note}»</small>` : ""}</div><b style="margin-inline-start:auto">${rupees(c.amount)} روپے</b>
      <div style="width:100%;display:flex;gap:8px;align-items:center;margin-top:2px">${statusChip(STATUS_TEXT.claim[c.status] || c.status, statusTone(c.status))}
      ${canAck ? h`<button class="lnk" data-a="claimAck" data-id="${c.id}">رقم موصول ہوئی ✓</button>` : ""}${canCancel ? h`<button class="lnk" data-a="claimCancel" data-id="${c.id}" style="color:var(--hr)">منسوخ کریں</button>` : ""}</div></div>`;
    })
    : emptyView("ابھی کوئی ریکارڈ نہیں۔");
  return h`${hd("تعاون کی تاریخ")}<div class="tabs">${["موصول", "بھیجے گئے"].map((x, i) => h`<button data-a="historyTab" data-v="${i}" class="${i === tab ? "on" : ""}">${x}</button>`)}</div>
  <div class="pad"><span class="mu">کل درج شدہ رقم</span><b style="display:block;font-size:22px">${rupees(total)} روپے</b></div>${body}
  <div class="pad mu" style="font-size:12px">رقم لکھاری کے اپنے اکاؤنٹ میں جاتی ہے۔ ایپ صرف وہی ریکارڈ دکھاتی ہے جو بھیجنے والے نے “میں نے رقم بھیج دی” سے درج کیا ہو۔ لکھاری وصولی کی تصدیق کر سکتا ہے۔</div>`;
};
Object.assign(ACT, {
  historyRetry: () => { L.history({}, true); render({ keep: true }); },
  historyTab: (el) => { S.params = Object.assign({}, S.params, { tab: Number(el.dataset.v) }); render({ keep: true }); },
  claimAck: (el) => guarded("ack:" + el.dataset.id, el, async () => {
    await BE().writerSupport.acknowledgeReceived(el.dataset.id);
    vclear("claims"); L.history({}, true); toast("وصولی کی تصدیق ہو گئی");
  }),
  claimCancel: (el) => guarded("cancel:" + el.dataset.id, el, async () => {
    await BE().writerSupport.cancelClaim(el.dataset.id);
    vclear("claims"); L.history({}, true); toast("اطلاع منسوخ کر دی گئی");
  }),
});

/* ---------------- help, tickets ---------------- */
L.help = (p, force) => { if (S.user) fetchKey("tickets", () => BE().feedback.mine(), { force, ttl: 30000 }); };
R.help = () => {
  const tk = vget("tickets");
  const file = S.helpFile;
  return h`${hd("مدد اور رابطہ")}${FAQ.map((f, i) => h`<button class="mrow" data-a="faq" data-v="${i}" aria-expanded="${S.fq === i}" style="flex-wrap:wrap"><b style="flex:1;text-align:start">${f[0]}</b>${ic(S.fq === i ? "down" : "chev", 16)}${S.fq === i ? h`<div class="mu" style="width:100%;text-align:start;font-size:14px">${f[1]}</div>` : ""}</button>`)}
  <div class="pad"><b>ہم سے رابطہ کریں</b>
  <select class="fld" data-f="help.type" aria-label="پیغام کی قسم" style="margin-top:6px">${optionList(FEEDBACK_TYPES, fv("help.type", "question"))}</select>
  <div style="margin-top:6px">${fieldArea("help.msg", { rows: 4, max: 5000, ph: "اپنا مسئلہ یا تجویز لکھیں…", label: "پیغام" })}</div>
  ${file ? h`<div class="row" style="margin-top:6px">${ic("doc", 18)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${file.name}</span><button class="lnk" data-a="helpFileRemove" style="color:var(--hr)">ہٹائیں</button></div>`
    : h`<label class="row" style="margin-top:6px;cursor:pointer"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-file="helpAttach" hidden>${ic("image", 18)} اسکرین شاٹ یا PDF لگائیں (اختیاری)</label>`}
  <button class="btn" style="margin-top:8px" data-a="helpSend">پیغام بھیجیں</button></div>
  ${S.user ? h`<div class="pad" style="padding-bottom:0"><b>میرے پیغامات</b></div>${tk.st === "loading" && !tk.d ? loadingView() : tk.st === "err" && !tk.d ? errorView(tk.e, "helpRetry")
    : (tk.d || []).length ? (tk.d || []).map((t) => h`<button class="li" data-a="ticket" data-id="${t.id}"><div style="flex:1"><b>${teaser(t.message, 60)}</b><small>#${t.ticket_number} · ${labelOf(FEEDBACK_TYPES, t.feedback_type)} · ${ago(t.created_at)}</small></div>${statusChip(STATUS_TEXT.ticket[t.status] || t.status, statusTone(t.status))}</button>`)
    : emptyView("آپ نے ابھی کوئی پیغام نہیں بھیجا۔")}` : ""}`;
};
FILE.helpAttach = (f) => {
  if (f.size > BE().LIMITS.attachmentBytes) { toast("فائل 5 MB سے بڑی ہے"); return; }
  S.helpFile = f; render({ keep: true, force: true });
};
Object.assign(ACT, {
  faq: (el) => { S.fq = S.fq === Number(el.dataset.v) ? -1 : Number(el.dataset.v); render({ keep: true }); },
  helpRetry: () => { L.help({}, true); render({ keep: true }); },
  helpFileRemove: () => { S.helpFile = null; render({ keep: true, force: true }); },
  helpSend: (el) => guarded("help", el, async () => {
    if (!needAuth("پیغام بھیجنے کے لیے سائن اِن کریں۔")) return;
    const message = String(S.fields["help.msg"] || "").trim();
    if (message.length < 5) { toast("پہلے پیغام لکھیں (کم از کم 5 حروف)"); return; }
    let attachmentPath = null;
    if (S.helpFile) attachmentPath = await BE().feedback.uploadAttachment(S.helpFile);
    const t = await BE().feedback.submit({ type: S.fields["help.type"] || "question", message, attachmentPath });
    clearFields("help."); S.helpFile = null; vclear("tickets"); L.help({}, true);
    render({ keep: true, force: true }); toast("آپ کا پیغام بھیج دیا گیا، نمبر #" + t.ticket_number);
  }),
  ticket: (el) => go("ticket", { id: el.dataset.id }),
});

L.ticket = (p, force) => {
  fetchKey("tickets", () => BE().feedback.mine(), { force, ttl: 30000 });
  fetchKey("tmsgs:" + p.id, async () => BE().ticketMessages.list(p.id), { force, ttl: 10000 });
};
function ticketThread(id) {
  const msgs = vget("tmsgs:" + id);
  const t = (vdata("tickets") || []).find((x) => x.id === id);
  if (!t) return vget("tickets").st === "err" ? errorView(vget("tickets").e, "ticketRetry", id) : loadingView();
  const bubbles = [{ mine: true, text: t.message, at: t.created_at }];
  if (t.staff_reply) bubbles.push({ mine: false, text: t.staff_reply, at: t.updated_at });
  (msgs.d || []).forEach((m) => bubbles.push({ mine: m.author_id === S.me.id, text: m.message, at: m.created_at }));
  return h`<div class="pad"><div>${statusChip(STATUS_TEXT.ticket[t.status] || t.status, statusTone(t.status))} <small class="mu">#${t.ticket_number} · ${labelOf(FEEDBACK_TYPES, t.feedback_type)}</small></div></div>
  ${bubbles.map((b) => h`<div class="bub ${b.mine ? "me" : "them"}"><div>${b.text}</div><small>${b.mine ? "آپ" : "ہم لکھاری ٹیم"} · ${ago(b.at)}</small></div>`)}
  ${msgs.st === "loading" && !msgs.d ? loadingView() : msgs.st === "err" ? errorView(msgs.e, "ticketRetry", id) : ""}`;
}
/* The reply box lives OUTSIDE #tk so a late thread load (partial re-render while the user is typing) never replaces the focused input. */
function ticketComposer(id) {
  const t = (vdata("tickets") || []).find((x) => x.id === id);
  if (!t) return h``;
  return t.status === "closed" ? h`<div class="pad mu">یہ پیغام بند ہو چکا ہے۔ نیا مسئلہ ہو تو نیا پیغام بھیجیں۔</div>`
    : h`<div class="cin"><input class="fld" id="tin" data-f="tk.text" data-enter="ticketSend" value="${fv("tk.text")}" maxlength="4000" placeholder="جواب لکھیں…" aria-label="جواب"><button class="ic" data-a="ticketSend" data-id="${id}" aria-label="بھیجیں" style="color:var(--g)">${ic("send")}</button></div>`;
}
R.ticket = (p) => h`${hd("پیغام")}<div id="tk">${ticketThread(p.id)}</div><div id="tkc">${ticketComposer(p.id)}</div>`;
PARTIAL.ticket = () => [["#tk", ticketThread(S.params.id)]];
Object.assign(ACT, {
  ticketRetry: (el) => { L.ticket({ id: el.dataset.id || S.params.id }, true); render({ keep: true }); },
  ticketSend: (el) => guarded("tsend", el, async () => {
    const id = S.params.id, text = String(S.fields["tk.text"] || "").trim();
    if (!text) { toast("پہلے جواب لکھیں"); return; }
    await BE().ticketMessages.add({ ticketId: id, message: text });
    clearFields("tk."); vclear("tmsgs:" + id); L.ticket({ id }, true); render({ keep: true, force: true });
  }),
});

/* ---------------- blocked people ---------------- */
L.blocked = (p, force) => {
  fetchKey("blocked", async () => { const rows = (await BE().social.blockedUsers()).map(mapPerson); S.blocked = new Set(rows.map((r) => r.id)); return rows; }, { force, ttl: 10000 });
};
R.blocked = () => {
  const st = vget("blocked");
  return h`${hd("بلاک کیے گئے لوگ")}${st.st === "loading" && !st.d ? loadingView() : st.st === "err" && !st.d ? errorView(st.e, "blockedRetry")
    : (st.d || []).length ? st.d.map((x) => personRow(x, h`<button class="fol" data-a="unblock" data-id="${x.id}" style="margin-inline-start:auto">ان بلاک</button>`))
    : emptyView("آپ نے کسی کو بلاک نہیں کیا۔")}`;
};
ACT.blockedRetry = () => { L.blocked({}, true); render({ keep: true }); };
