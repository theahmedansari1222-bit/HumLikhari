"use strict";
/* Registries are filled by the screen modules:
 *   R[screen](params) -> Raw html      L[screen](params, force) -> starts loading (never awaited by the router)
 *   AFTER[screen]()   -> post-render hook      PARTIAL[screen]() -> [[selector, Raw]] used while the user is typing
 *   ACT[name](el, ev) -> delegated click actions (data-a)      SHEET[name](sheetState) -> Raw html
 */
const R = {}, L = {}, AFTER = {}, PARTIAL = {}, ACT = {}, SHEET = {}, INPUT = {}, FILE = {};

const screenEl = () => document.getElementById("screen");
const isTyping = () => {
  const a = document.activeElement;
  return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (screenEl().contains(a) || document.getElementById("sheet").contains(a)));
};

let queued = false;
/* Coalesced re-render used by every async completion. Keeps scroll position. */
function softRender() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; render({ keep: true }); });
}

function go(scr, params, o) {
  const opt = o || {};
  if (!R[scr]) { console.error("unknown screen", scr); return; }
  if (!opt.keep) {
    if (!opt.replace) {
      if (TAB_SCREENS.includes(scr) || scr === "splash") S.stack = [];
      else S.stack.push({ scr: S.scr, params: S.params, y: screenEl() ? screenEl().scrollTop : 0 });
    }
    S.sheet = null;
  }
  S.scr = scr; S.params = params || {}; S.keep = !!opt.keep;
  if (L[scr]) L[scr](S.params, !!opt.force);
  render({ focus: !opt.keep });
  syncHash();
}

function back() {
  const prev = S.stack.pop();
  S.sheet = null;
  if (!prev) { go("home", {}); return; }
  S.scr = prev.scr; S.params = prev.params; S.keep = false; S.scrollY = prev.y;
  if (L[prev.scr]) L[prev.scr](prev.params, false);
  render({ focus: true });
  syncHash();
}

/* ---------- deep links: #/p/<post uuid> and #/u/<username> ---------- */
function parseHash(hash) {
  const p = /^#\/p\/([0-9a-fA-F-]{36})$/.exec(hash || "");
  if (p) return ["article", { id: p[1].toLowerCase() }];
  const u = /^#\/u\/([a-z0-9_]{3,24})$/.exec(hash || "");
  if (u) return ["author", { username: u[1] }];
  return null;
}
function syncHash() {
  let hash = "";
  if (S.scr === "article" && S.params.id) hash = "#/p/" + S.params.id;
  else if (S.scr === "author" && S.params.username) hash = "#/u/" + S.params.username;
  if (hash !== location.hash) { try { history.replaceState(null, "", location.pathname + location.search + hash); } catch (_) { /* sandboxed */ } }
}
function linkFor(kind, value) {
  const base = location.origin === "null" ? "" : location.origin + location.pathname;
  return base + (kind === "post" ? "#/p/" + value : "#/u/" + value);
}

/* ---------- render ---------- */
function captureFocus() {
  const a = document.activeElement;
  if (a && a.id && (screenEl().contains(a) || document.getElementById("sheet").contains(a))) return { id: a.id, s: a.selectionStart, e: a.selectionEnd };
  return null;
}
function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el) return;
  try { el.focus({ preventScroll: true }); if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (_) { /* not focusable */ }
}

function render(o) {
  const opt = o || {};
  const sc = screenEl();
  if (!sc) return;
  if (isTyping() && !opt.force) {
    const part = PARTIAL[S.scr];
    if (part) part().forEach(([sel, html]) => { const t = $(sel); if (t) t.innerHTML = html.s; });
    renderChrome(true);
    return;
  }
  const y = sc.scrollTop;
  const focus = captureFocus();
  let html;
  try { html = R[S.scr](S.params).s; }
  catch (e) {
    console.error("render failed", S.scr, e);
    html = '<div class="empty">اس صفحے میں خرابی آ گئی۔<br><button class="lnk" data-a="tab" data-v="home">ہوم پر جائیں</button></div>';
  }
  sc.innerHTML = html;
  sc.scrollTop = (opt.keep || S.keep) ? y : (S.scrollY || 0);
  S.keep = false; S.scrollY = 0;
  if (AFTER[S.scr]) { try { AFTER[S.scr](); } catch (e) { console.error(e); } }
  restoreFocus(focus);
  renderChrome();
  if (opt.focus) { sc.setAttribute("tabindex", "-1"); try { sc.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
}

function renderChrome(sheetOnly) {
  const phone = $("#phone");
  const tb = TAB_SCREENS.includes(S.scr);
  phone.classList.toggle("tb", tb);
  $("#off").className = S.online ? "" : "on";
  if (!sheetOnly) {
    const tabs = [["home", "home", "ہوم"], ["explore", "search", "تلاش"], ["write", "plus", ""], ["notif", "bell", "اطلاعات"], ["profile", "user", "پروفائل"]];
    $("#tabbar").innerHTML = tabs.map((t) => t[2]
      ? h`<button data-a="tab" data-v="${t[0]}" class="${S.scr === t[0] ? "on" : ""}" ${S.scr === t[0] ? raw('aria-current="page"') : ""}>${ic(t[1], 22)}${t[2]}${t[0] === "notif" && S.unread ? h`<span class="bd" aria-label="${S.unread} نئی اطلاعات">${S.unread > 99 ? "99+" : S.unread}</span>` : ""}</button>`.s
      : h`<button class="plus" data-a="tab" data-v="write" aria-label="نئی تحریر">${ic("plus", 24)}</button>`.s).join("");
  }
  renderSheet();
}

function renderSheet() {
  const el = $("#sheet");
  if (!S.sheet) { if (el.className) { el.className = ""; el.innerHTML = ""; } return; }
  if (isTyping() && el.contains(document.activeElement)) return;      // never rebuild a sheet under the user's cursor
  const focus = captureFocus();
  const body = SHEET[S.sheet.name] ? SHEET[S.sheet.name](S.sheet) : h``;
  el.className = "on";
  el.innerHTML = h`<div class="sb" data-a="closeSheet"></div><div class="sh" role="dialog" aria-modal="true">${body}</div>`.s;
  restoreFocus(focus);
}
function openSheet(name, data) { S.sheet = Object.assign({}, data || {}, { name }); renderSheet(); }   // `name` always wins: it selects the SHEET renderer
function closeSheet() { S.sheet = null; renderSheet(); }

/* Screens that require an account call this first. */
function needAuth(reason) {
  if (S.user) return true;
  openSheet("signin", { reason: reason || "" });
  return false;
}
