"use strict";
/* Bottom sheets. Each SHEET[name](state) returns markup; S.sheet holds the state. */
const sheetTitle = (t) => h`<h3 class="hl" style="font-size:19px">${t}</h3>`;
const mrow = (action, icon, label, data, cls) => h`<button class="mrow ${cls || ""}" data-a="${action}" ${data ? raw(Object.keys(data).map((k) => 'data-' + k + '="' + esc(data[k]) + '"').join(" ")) : ""} style="padding-inline:4px">${ic(icon)}${label}</button>`;

SHEET.signin = (s) => h`${sheetTitle("سائن اِن ضروری ہے")}<p class="mu">${s.reason || "یہ کام کرنے کے لیے پہلے سائن اِن کریں۔"}</p>
<button class="btn" data-a="signinGo">سائن اِن کریں</button><button class="lnk" style="width:100%;margin-top:4px" data-a="closeSheet">ابھی نہیں</button>`;

SHEET.pic = () => h`${sheetTitle("پروفائل تصویر")}
<label class="mrow" style="cursor:pointer"><input type="file" accept="image/jpeg,image/png,image/webp" data-file="avatar" hidden>${ic("image")}گیلری سے منتخب کریں</label>
<label class="mrow" style="cursor:pointer"><input type="file" accept="image/jpeg,image/png,image/webp" capture="user" data-file="avatar" hidden>${ic("camera")}کیمرہ سے تصویر لیں</label>
${(S.ed && !S.ed.avatarRemoved && (S.ed.avatarPreview || (S.me && S.me.avatarUrl))) ? h`<button class="mrow rd" data-a="avatarRemove">${ic("trash")}موجودہ تصویر ہٹائیں</button>` : ""}`;

function shareText(post) {
  const src = lines(stripMarks(post.body != null ? post.body : post.excerpt || ""));
  const quote = src.slice(0, isPoem(post) ? 2 : 1).join("\n");
  return { quote, text: clampText(quote, 200) + "\n— " + post.name + "، «" + post.title + "» (ہم لکھاری)\n" + linkFor("post", post.id) };
}
SHEET.share = (s) => {
  const post = S.posts.get(s.id);
  if (!post) return h`${sheetTitle("شیئر کریں")}<div class="empty">تحریر نہیں ملی۔</div>`;
  const t = shareText(post);
  return h`${sheetTitle("شیئر کریں")}<div class="sharecard" style="background:${gradientFor(post.id)}"><div class="hl" style="font-size:18px;line-height:2.4">${lines(t.quote).map((l, i) => h`${i ? raw("<br>") : ""}${l}`)}</div><div style="font-size:13px;margin-top:6px;opacity:.9">${post.name} · ${post.title}</div><div class="sharebrand">ہم لکھاری</div></div>
  <a class="btn wa" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(t.text)}">واٹس ایپ پر بھیجیں</a>
  ${navigator.share ? h`<button class="btn o" style="margin-top:8px" data-a="nativeShare" data-id="${post.id}">دوسری ایپ سے شیئر کریں</button>` : ""}
  <button class="btn o" style="margin-top:8px" data-a="copyLink" data-id="${post.id}">لنک کاپی کریں</button>
  <button class="btn o" style="margin-top:8px" data-a="copy" data-t="${t.text}">متن کاپی کریں</button>`;
};

SHEET.more = (s) => {
  const post = S.posts.get(s.id);
  if (!post) return "";
  const mine = S.me && post.authorId === S.me.id;
  return mine
    ? h`${mrow("copyLink", "link", "لنک کاپی کریں", { id: post.id })}${mrow("editPost", "edit", "تحریر ایڈٹ کریں", { id: post.id })}${mrow("deletePostAsk", "trash", "تحریر ڈیلیٹ کریں", { id: post.id }, "rd")}`
    : h`${mrow("copyLink", "link", "لنک کاپی کریں", { id: post.id })}${mrow("reportPost", "flag", "تحریر رپورٹ کریں", { id: post.id })}${mrow("blockAsk", "block", "لکھاری کو بلاک کریں", { id: post.authorId, n: post.name })}`;
};
SHEET.authorMore = (s) => {
  const prof = vdata("profile:" + (S.params.username || S.params.id)) || {};
  const isBlocked = S.blocked.has(s.id);
  const self = S.me && s.id === S.me.id;
  return h`${mrow("copyProfileLink", "link", "پروفائل کا لنک کاپی کریں", { u: prof.username || "" })}
  ${self ? "" : h`${mrow("reportUser", "flag", "لکھاری کو رپورٹ کریں", { id: s.id })}${isBlocked ? mrow("unblock", "block", "ان بلاک کریں", { id: s.id }) : mrow("blockAsk", "block", "لکھاری کو بلاک کریں", { id: s.id, n: prof.name || "" })}`}`;
};

SHEET.delart = (s) => h`${sheetTitle("تحریر ڈیلیٹ کریں؟")}<p class="mu">یہ تحریر اور اس کے تبصرے مستقل طور پر حذف ہو جائیں گے۔</p><button class="btn rd" data-a="deletePost" data-id="${s.id}">ڈیلیٹ کریں</button><button class="lnk" style="width:100%;margin-top:4px" data-a="closeSheet">منسوخ</button>`;
SHEET.block = (s) => h`${sheetTitle("لکھاری کو بلاک کریں؟")}<p class="mu">${s.n ? s.n + " کی تحریریں آپ کو نظر نہیں آئیں گی اور وہ آپ کی تحریروں پر تبصرہ یا تعاون نہیں کر سکیں گے۔ فالو بھی ختم ہو جائے گا۔" : "اس لکھاری کی تحریریں آپ کو نظر نہیں آئیں گی اور فالو ختم ہو جائے گا۔"}</p><button class="btn rd" data-a="block" data-id="${s.id}">بلاک کریں</button><button class="lnk" style="width:100%;margin-top:4px" data-a="closeSheet">منسوخ</button>`;
SHEET.removedNotice = () => h`${sheetTitle("مواد ہٹا دیا گیا")}<p class="mu">آپ کا ایک مواد کمیونٹی اصولوں کی خلاف ورزی کی وجہ سے ہٹایا گیا ہے۔ اگر آپ کو لگتا ہے کہ غلطی ہوئی ہے تو مدد اور رابطہ میں ہمیں لکھیں۔</p><button class="btn" data-a="closeSheet">ٹھیک ہے</button>`;

SHEET.report = (s) => h`${sheetTitle(s.target === "post" ? "تحریر رپورٹ کریں" : s.target === "comment" ? "تبصرہ رپورٹ کریں" : "لکھاری کو رپورٹ کریں")}
<div class="mu">وجہ منتخب کریں:</div>
<div class="cats wrap" style="padding-inline:0">${REPORT_REASONS.map((r) => h`<button data-a="reportReason" data-v="${r[0]}" class="${s.reason === r[0] ? "on" : ""}" aria-pressed="${s.reason === r[0]}">${r[1]}</button>`)}</div>
<textarea class="fld" id="repDetails" data-i="repDetails" rows="3" maxlength="2000" placeholder="مزید تفصیل (اختیاری)" aria-label="تفصیل">${s.details || ""}</textarea>
${s.err ? h`<div class="notice bad" role="alert">${s.err}</div>` : ""}
<button class="btn rd" style="margin-top:10px" data-a="reportSend">رپورٹ بھیجیں</button><button class="lnk" style="width:100%;margin-top:4px" data-a="closeSheet">منسوخ</button>`;
INPUT.repDetails = (t) => { if (S.sheet) S.sheet.details = t.value; };

SHEET.delacct = (s) => h`${sheetTitle("اکاؤنٹ ڈیلیٹ کریں؟")}<p class="mu">آپ کی تمام تحریریں اور ڈیٹا مستقل طور پر حذف ہو جائیں گے۔ یہ عمل واپس نہیں ہو سکتا۔ تصدیق کے لیے نیچے <b class="ltr">DELETE</b> لکھیں۔</p>
<input class="fld ltr" id="delConfirm" data-i="delConfirm" value="${s.text || ""}" autocomplete="off" autocapitalize="characters" aria-label="تصدیق" placeholder="DELETE">
${s.err ? h`<div class="notice bad" role="alert">${s.err}</div>` : ""}
<button class="btn rd" style="margin-top:10px" data-a="deleteAccount">مستقل طور پر ڈیلیٹ کریں</button><button class="lnk" style="width:100%;margin-top:4px" data-a="closeSheet">منسوخ</button>`;
INPUT.delConfirm = (t) => { if (S.sheet) S.sheet.text = t.value; };

Object.assign(ACT, {
  closeSheet: () => closeSheet(),
  signinGo: () => { closeSheet(); go("splash"); },
  share: (el) => openSheet("share", { id: el.dataset.id }),
  copyLink: (el) => { closeSheet(); copyText(linkFor("post", el.dataset.id), "لنک کاپی ہو گیا"); },
  copyProfileLink: (el) => { closeSheet(); copyText(linkFor("user", el.dataset.u), "پروفائل کا لنک کاپی ہو گیا"); },
  nativeShare: async (el) => {
    const post = S.posts.get(el.dataset.id);
    if (!post) return;
    try { await navigator.share({ title: post.title, text: shareText(post).quote, url: linkFor("post", post.id) }); closeSheet(); } catch (_) { /* cancelled */ }
  },
  deletePostAsk: (el) => openSheet("delart", { id: el.dataset.id }),
  deletePost: (el) => guarded("delpost", el, async () => {
    const id = el.dataset.id;
    await BE().posts.remove(id);
    S.posts.delete(id); S.liked.delete(id); S.saved.delete(id);
    invalidatePosts(); listReset("saved"); vclear("stats:");
    closeSheet(); back(); toast("تحریر ڈیلیٹ ہو گئی");
  }),
  reportPost: (el) => openSheet("report", { target: "post", id: el.dataset.id }),
  reportUser: (el) => openSheet("report", { target: "user", id: el.dataset.id }),
  reportReason: (el) => { S.sheet.reason = el.dataset.v; S.sheet.err = ""; renderSheet(); },
  reportSend: (el) => guarded("report", el, async () => {
    const s = S.sheet;
    if (!s.reason) { s.err = "رپورٹ کی وجہ منتخب کریں۔"; renderSheet(); return; }
    try {
      await BE().social.report({
        targetType: s.target, postId: s.target === "post" ? s.id : null, commentId: s.target === "comment" ? s.id : null,
        reportedUserId: s.target === "user" ? s.id : null, reason: s.reason, details: s.details || "",
      });
    } catch (e) { s.err = errText(e); renderSheet(); return; }
    closeSheet(); toast("رپورٹ موصول ہو گئی۔ شکریہ");
  }),
  blockAsk: (el) => openSheet("block", { id: el.dataset.id, n: el.dataset.n || "" }),
  block: (el) => guarded("block", el, async () => {
    const id = el.dataset.id;
    await BE().social.block(id);
    S.blocked.add(id); S.following.delete(id);
    invalidatePosts(); listReset("saved"); listReset("notif"); vclear("blocked");
    closeSheet(); go("home", {}); toast("لکھاری بلاک کر دیا گیا");
  }),
  unblock: (el) => guarded("unblock", el, async () => {
    const id = el.dataset.id;
    await BE().social.unblock(id);
    S.blocked.delete(id); invalidatePosts(); vclear("blocked");
    closeSheet(); render({ keep: true }); toast("ان بلاک کر دیا گیا");
  }),
  deleteAccountAsk: () => openSheet("delacct", { text: "", err: "" }),
  deleteAccount: (el) => guarded("delacct", el, async () => {
    const s = S.sheet;
    if (String(s.text || "").trim().toUpperCase() !== "DELETE") { s.err = "تصدیق کے لیے DELETE لکھیں۔"; renderSheet(); return; }
    try { await BE().auth.deleteMyAccount(); }
    catch (e) { s.err = errText(e); renderSheet(); return; }
    clearAccount(); go("splash"); toast("آپ کا اکاؤنٹ ڈیلیٹ کر دیا گیا");
  }),
});
