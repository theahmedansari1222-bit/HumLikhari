"use strict";
/* One delegated listener per event type. Markup only carries data-* attributes; behaviour lives in ACT/INPUT/FILE tables. */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]");
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.a];
  if (!fn) { console.warn("no action registered for", el.dataset.a); return; }
  const out = fn(el, e);
  if (out && typeof out.catch === "function") out.catch((err) => { console.error(err); toast(errText(err)); });
});

document.addEventListener("input", (e) => {
  const t = e.target, d = t.dataset || {};
  if (d.f) S.fields[d.f] = t.value;
  if (d.w) { onWriteInput(d.w, t.value); }
  if (d.e) { S.ed[d.e] = t.value; }
  if (d.i && INPUT[d.i]) INPUT[d.i](t, e);
});

document.addEventListener("change", (e) => {
  const t = e.target, d = t.dataset || {};
  if (d.f && t.type === "checkbox") S.fields[d.f] = t.checked;
  else if (d.f) S.fields[d.f] = t.value;
  if (d.w === "cat" || d.w === "topic") { S.w[d.w] = t.value; S.w.touched = true; scheduleBuffer(); }
  if (d.e && t.tagName === "SELECT") S.ed[d.e] = t.value;
  if (d.file && FILE[d.file] && t.files && t.files[0]) { const f = t.files[0]; t.value = ""; FILE[d.file](f); }
  if (d.i && INPUT[d.i] && t.tagName === "SELECT") INPUT[d.i](t, e);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.sheet) { closeSheet(); return; }
  if (e.key === "Enter" && !e.shiftKey && e.target.dataset && e.target.dataset.enter && !e.isComposing) {
    e.preventDefault();
    const fn = ACT[e.target.dataset.enter];
    if (fn) fn(e.target, e);
  }
});

window.addEventListener("offline", () => { S.online = false; renderChrome(true); toast("انٹرنیٹ نہیں ہے"); });
window.addEventListener("online", () => {
  S.online = true; renderChrome(true); toast("انٹرنیٹ بحال ہو گیا");
  flushDraftNow();
  if (S.user) refreshUnread();
});
window.addEventListener("hashchange", () => {
  const target = parseHash(location.hash);
  if (!target) return;
  if (S.scr === target[0] && (S.params.id === target[1].id && S.params.username === target[1].username)) return;
  go(target[0], target[1]);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.user) return;
  refreshUnread();
  const l = S.lists["feed:" + S.feedTab + ":" + S.cat];
  if (l && Date.now() - l.t > 5 * 60 * 1000 && S.scr === "home") { L.home({}, true); }
});
setInterval(() => { if (S.user && document.visibilityState === "visible" && S.online) refreshUnread(); }, 60000);

/* Header back button. Leaving the composer saves the draft; leaving the editor drops its temporary files. */
ACT.back = () => {
  if (S.scr === "write") leaveWrite();
  else if (S.scr === "editp" && S.ed) { if (S.ed.avatarPreview) URL.revokeObjectURL(S.ed.avatarPreview); ["jc", "ep"].forEach((k) => { if (S.ed[k] && S.ed[k].preview) URL.revokeObjectURL(S.ed[k].preview); }); S.ed = null; }
  else if (S.scr === "crop") S.crop = null;
  back();
};
