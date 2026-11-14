"use strict";
/* Composer: autosaved drafts (server) with a local buffer for offline, publish, edit, cover image. */
const bufKey = () => "hl.buf." + (S.user ? S.user.id : "guest");
const hasContent = (w) => !!(w.t.trim() || w.b.trim());
const wFields = (w) => ({ id: w.id, t: w.t, b: w.b, cat: w.cat, topic: w.topic, support: w.support, coverPath: w.coverPath });

function bufferNow() {
  const w = S.w;
  if (w.editing || !S.user) return;
  if (hasContent(w)) ls.set(bufKey(), Object.assign(wFields(w), { at: Date.now() })); else ls.del(bufKey());
}
const scheduleBuffer = debounce(bufferNow, 600);
const scheduleServerDraft = debounce(() => { saveDraftOf(S.w); }, 5000);

function onWriteInput(key, value) {
  const w = S.w;
  w[key] = value; w.touched = true;
  if (key === "t" && w.bad) { w.bad = false; const el = $("#wt"); if (el) el.classList.remove("bad"); }
  scheduleBuffer();
  if (!w.editing) scheduleServerDraft();
}

/* Save one composer snapshot as a server draft. Serialised per composer so two saves can never create two rows. */
function saveDraftOf(w) {
  if (w.editing || w.dead || !S.user || !navigator.onLine || !hasContent(w)) return Promise.resolve(false);
  w.saving = w.saving.then(async () => {
    if (w.dead) return false;
    const snap = { t: w.t, b: w.b };
    const payload = () => ({ id: w.id, title: w.t, body: w.b, category: w.cat, topic: w.topic, allowSupport: w.support, coverImagePath: w.coverPath });
    let row;
    try { row = await BE().posts.saveDraft(payload()); }
    catch (e) {
      if (w.id && (e.code === "PGRST116")) { w.id = null; try { row = await BE().posts.saveDraft(payload()); } catch (_) { return false; } }   // draft was deleted elsewhere
      else return false;                                                                                 // keep the local buffer
    }
    w.id = row.id;
    const b = ls.get(bufKey(), null);
    if (b && b.t === snap.t && b.b === snap.b) ls.del(bufKey());
    vclear("drafts");
    return true;
  }).catch(() => false);
  return w.saving;
}

/* Leaving the composer: never lose text. */
function leaveWrite() {
  const w = S.w;
  if (w.editing) { S.w = NEW_WRITE(); return; }
  if (!hasContent(w)) { w.dead = true; S.w = NEW_WRITE(); ls.del(bufKey()); return; }
  bufferNow();
  S.w = NEW_WRITE();
  if (!navigator.onLine) { toast("انٹرنیٹ نہیں ہے۔ تحریر آپ کے فون میں محفوظ ہے"); return; }
  saveDraftOf(w).then((ok) => { toast(ok ? "مسودے میں محفوظ ہو گیا" : "مسودہ فون میں محفوظ ہے، انٹرنیٹ آنے پر محفوظ ہو گا"); });
}
/* Called when connectivity returns: push a locally buffered draft to the server. */
async function flushDraftNow() {
  if (!S.user || !navigator.onLine) return;
  const b = ls.get(bufKey(), null);
  if (!b || S.scr === "write") return;
  const w = Object.assign(NEW_WRITE(), { id: b.id || null, t: b.t || "", b: b.b || "", cat: b.cat || "مضمون", topic: b.topic || "ادب", support: b.support !== false, coverPath: b.coverPath || null });
  if (await saveDraftOf(w)) listReset("drafts");
}

function composerFromPost(post, editing) {
  const w = NEW_WRITE();
  Object.assign(w, { id: post.id, t: post.title, b: post.body || "", cat: post.category, topic: post.topic, support: post.allowSupport, coverPath: post.coverPath, coverUrl: post.coverUrl || "", origCover: post.coverPath, editing: !!editing, touched: true });
  return w;
}

L.write = () => {
  if (!S.user) return;
  const w = S.w;
  if (!w.editing && !w.touched && !w.id) {
    const b = ls.get(bufKey(), null);
    if (b && (b.t || b.b)) {
      Object.assign(w, { id: b.id || null, t: b.t || "", b: b.b || "", cat: b.cat || w.cat, topic: b.topic || w.topic, support: b.support !== false, coverPath: b.coverPath || null, touched: true });
      toast("پچھلا نامکمل متن بحال کر دیا گیا");
    }
  }
  fetchKey("drafts", () => BE().posts.drafts().then((rows) => rows.map(mapPost)), { ttl: 20000 });
};

R.write = () => {
  const w = S.w;
  const drafts = vdata("drafts");
  const poem = w.cat === "شاعری";
  const coverShown = w.coverObjectUrl || w.coverUrl;
  return h`${hd(w.editing ? "تحریر ایڈٹ کریں" : "نئی تحریر", h`<button class="pill" data-a="publish" id="pubBtn">${w.editing ? "اپ ڈیٹ کریں" : "شائع کریں"}</button>`)}
  <div class="pad"><div style="display:flex;align-items:center;justify-content:space-between"><span class="mu" style="font-size:12px">${w.editing ? "تبدیلیاں محفوظ کرنے کے لیے اپ ڈیٹ کریں" : "واپس جانے پر مسودہ خود محفوظ ہو جاتا ہے"}</span>${w.editing ? "" : h`<button class="lnk" data-a="drafts">مسودے${drafts ? " (" + drafts.length + ")" : ""}</button>`}</div>
  <input class="fld ${w.bad ? "bad" : ""}" id="wt" data-w="t" value="${w.t}" maxlength="160" placeholder="عنوان لکھیں" aria-label="عنوان" style="margin-top:4px">
  <label class="row">صنف<select data-w="cat" aria-label="صنف">${optionList(CATEGORY_LABELS.map((c) => [c, c]), w.cat)}</select></label>
  <label class="row">موضوع<select data-w="topic" aria-label="موضوع">${optionList(TOPIC_LABELS.map((c) => [c, c]), w.topic)}</select></label>
  <div class="tools"><button data-a="fmt" data-v="b" aria-label="موٹا"><b>B</b></button><button data-a="fmt" data-v="i" aria-label="ترچھا"><i>I</i></button><button data-a="fmt" data-v="q" aria-label="اقتباس">${ic("quote", 18)}</button></div>
  <textarea class="fld" id="wb" data-w="b" rows="9" aria-label="تحریر" maxlength="100000" style="${poem ? "text-align:center;font-family:'Noto Nastaliq Urdu',serif;line-height:2.3" : ""}" placeholder="${poem ? "ہر مصرع نئی لائن میں لکھیں…" : "اپنی تحریر یہاں لکھیں…"}">${w.b}</textarea>
  <div style="margin-top:10px">
  ${coverShown
    ? h`<div class="row" style="gap:10px"><img class="thumb" src="${coverShown}" alt="کور تصویر"><span>کور تصویر</span><button class="lnk" style="margin-inline-start:auto;color:var(--hr)" data-a="coverRemove">ہٹائیں</button></div>`
    : h`<label class="row" style="cursor:pointer"><input type="file" accept="image/jpeg,image/png,image/webp" data-file="cover" hidden>${ic("image", 18)} کور تصویر شامل کریں<span style="margin-inline-start:auto;display:inline-flex">${ic("chev", 16)}</span></label>`}
  <button class="row" role="switch" aria-checked="${w.support}" data-a="supportSw">تعاون کی سہولت فعال کریں<span class="sw ${w.support ? "on" : ""}"></span></button></div></div>`;
};

Object.assign(ACT, {
  fmt: (el) => {
    const x = $("#wb");
    if (!x) return;
    const a = x.selectionStart, z = x.selectionEnd, v = x.value, k = el.dataset.v === "b" ? "**" : el.dataset.v === "i" ? "*" : "";
    const sel = v.slice(a, z) || "متن";
    const next = el.dataset.v === "q" ? v.slice(0, a) + "> " + sel + v.slice(z) : v.slice(0, a) + k + sel + k + v.slice(z);
    x.value = next;
    onWriteInput("b", next);
    x.focus();
    x.setSelectionRange(a, a + (el.dataset.v === "q" ? 2 : k.length) + sel.length);
  },
  supportSw: () => { S.w.support = !S.w.support; S.w.touched = true; scheduleBuffer(); render({ keep: true, force: true }); },
  coverRemove: () => { const w = S.w; if (w.coverObjectUrl) URL.revokeObjectURL(w.coverObjectUrl); Object.assign(w, { coverFile: null, coverObjectUrl: "", coverPath: null, coverUrl: "", touched: true }); render({ keep: true, force: true }); },
  drafts: () => { saveDraftOf(S.w); go("drafts"); },
  publish: (el) => guarded("publish", el, async () => {
    const w = S.w;
    if (!w.t.trim()) { w.bad = true; render({ keep: true, force: true }); toast("پہلے عنوان لکھیں"); return; }
    if (!w.b.trim()) { toast("تحریر خالی ہے"); return; }
    if (!navigator.onLine) {
      if (w.editing) { toast("انٹرنیٹ نہیں ہے۔ اپ ڈیٹ بعد میں کریں"); return; }
      bufferNow(); const keep = S.w; S.w = NEW_WRITE(); keep.dead = true; go("home");
      toast("انٹرنیٹ نہیں ہے۔ تحریر مسودے میں محفوظ کر دی گئی"); return;
    }
    await w.saving;                                           // let a pending autosave finish so we reuse its row
    let coverPath = w.coverPath;
    if (w.coverFile) coverPath = (await BE().posts.uploadCover(w.coverFile)).path;
    const res = await BE().posts.publish({ id: w.id, title: w.t, body: w.b, category: w.cat, topic: w.topic, allowSupport: w.support, coverImagePath: coverPath });
    w.dead = true; ls.del(bufKey());
    if (w.origCover && w.origCover !== coverPath) BE().posts.discardCover(w.origCover);
    if (w.coverObjectUrl) URL.revokeObjectURL(w.coverObjectUrl);
    const editing = w.editing;
    S.w = NEW_WRITE();
    invalidatePosts(); S.posts.delete(res.id); vclear("post:" + res.id);
    if (editing) { S.stack.pop(); go("article", { id: res.id }, { replace: true }); toast("تحریر اپ ڈیٹ ہو گئی"); }
    else { S.feedTab = 0; S.cat = ""; go("home", {}); toast("تحریر شائع ہو گئی"); }
  }),
  editPost: (el) => {
    const post = S.posts.get(el.dataset.id);
    if (!post || post.body == null) return;
    closeSheet();
    S.w = composerFromPost(post, true);
    go("write");
  },
});

FILE.cover = async (file) => {
  try {
    const small = await resizeImage(file, 1600, "image/jpeg", 0.86);
    if (small.size > BE().LIMITS.coverBytes) { toast("تصویر بہت بڑی ہے"); return; }
    const w = S.w;
    if (w.coverObjectUrl) URL.revokeObjectURL(w.coverObjectUrl);
    Object.assign(w, { coverFile: small, coverObjectUrl: URL.createObjectURL(small), touched: true });
    render({ keep: true, force: true });
  } catch (_) { toast("تصویر کھل نہیں سکی"); }
};

/* ---------------- drafts ---------------- */
L.drafts = (p, force) => { fetchKey("drafts", () => BE().posts.drafts().then((rows) => rows.map(mapPost)), { force, ttl: 20000 }); };
R.drafts = () => {
  const st = vget("drafts");
  const rows = st.d || [];
  return h`${hd("مسودے")}${st.st === "loading" && !rows.length ? loadingView() : st.st === "err" ? errorView(st.e, "draftsRetry")
    : rows.length ? rows.map((d) => h`<div class="li"><button class="lhit" data-a="openDraft" data-id="${d.id}"><div style="flex:1"><b>${d.title || "بغیر عنوان"}</b><small>${teaser(d.body, 50) || "خالی"} · ${d.category} · ${ago(d.at)}</small></div></button><button class="lnk" data-a="deleteDraft" data-id="${d.id}" style="color:var(--hr)">ڈیلیٹ</button></div>`)
    : emptyView("کوئی مسودہ نہیں۔ لکھتے ہوئے واپس جائیں تو مسودہ یہاں محفوظ ہو جاتا ہے۔")}`;
};
Object.assign(ACT, {
  draftsRetry: () => { L.drafts({}, true); render({ keep: true }); },
  openDraft: (el) => {
    const d = (vdata("drafts") || []).find((x) => x.id === el.dataset.id);
    if (!d) return;
    if (S.w.touched && hasContent(S.w) && S.w.id !== d.id) saveDraftOf(S.w);
    S.w = composerFromPost(d, false);
    S.w.status = "draft";
    S.stack.pop();                                            // drafts -> write replaces the drafts screen
    go("write", {}, { replace: true });
  },
  deleteDraft: (el) => guarded("draft:" + el.dataset.id, el, async () => {
    await BE().posts.remove(el.dataset.id);
    vclear("drafts"); L.drafts({}, true); render({ keep: true }); toast("مسودہ ڈیلیٹ ہو گیا");
  }),
});
