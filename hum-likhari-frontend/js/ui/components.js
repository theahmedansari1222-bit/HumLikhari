"use strict";
/* Reusable view fragments. Every function returns a Raw produced by h``, so values are escaped automatically. */

function avatar(p, size) {
  const name = (p && p.name) || "؟";
  const style = (size ? "width:" + size + "px;height:" + size + "px;font-size:" + Math.round(size * 0.4) + "px;margin:0 auto 4px;" : "") +
    "background:hsl(" + avatarHue(name) + " 38% 36%)";
  return h`<span class="av" style="${style}">${p && p.avatarUrl ? h`<img src="${p.avatarUrl}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : name.trim().charAt(0) || "؟"}</span>`;
}

function cover(post, height) {
  if (post.coverUrl) {
    return h`<div class="art" style="height:${height}px"><img src="${post.coverUrl}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`;
  }
  return h`<div class="art" style="height:${height}px;background:${gradientFor(post.id)}"><svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><circle cx="82" cy="10" r="34" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="82" cy="10" r="20" fill="none" stroke="#fff" stroke-width="1.5"/></svg></div>`;
}

const hd = (title, right) => h`<div class="hdr"><button class="ic" data-a="back" aria-label="واپس">${ic("back")}</button><h2>${title}</h2><span class="rt">${right || ""}</span></div>`;
const hdTab = (title, right) => h`<div class="hdr"><span class="rt"></span><h2>${title}</h2><span class="rt">${right || ""}</span></div>`;

const loadingView = () => h`<div class="empty" role="status" aria-live="polite"><span class="spin" aria-hidden="true"></span> لوڈ ہو رہا ہے…</div>`;
const errorView = (message, retry, id) => h`<div class="empty" role="alert">${message}<br><button class="lnk" data-a="${retry}" data-id="${id || ""}">دوبارہ کوشش کریں</button></div>`;
const emptyView = (message, action, label, v) => h`<div class="empty">${message}${action ? h`<br><button class="lnk" data-a="${action}" data-v="${v || ""}">${label}</button>` : ""}</div>`;

/* Footer of a paged list: spinner, retry or "more" button. */
function listFooter(list, moreAction, id) {
  if (list.loading) return loadingView();
  if (list.err) return errorView(list.err, moreAction, id);
  if (!list.done && list.items.length) return h`<div class="pad"><button class="btn o" data-a="${moreAction}" data-id="${id || ""}">مزید دیکھیں</button></div>`;
  return "";
}

function followButton(userId) {
  if (S.me && S.me.id === userId) return "";
  const on = S.following.has(userId);
  return h`<button class="fol ${on ? "on" : ""}" data-a="follow" data-id="${userId}" aria-pressed="${on}">${on ? "فالو کر رہے ہیں" : "فالو"}</button>`;
}

function postActs(p) {
  const on = S.liked.has(p.id), sv = S.saved.has(p.id);
  return h`<div class="acts">
    <button data-a="like" data-id="${p.id}" class="${on ? "on" : ""}" aria-pressed="${on}" aria-label="پسند">${ic("heart", 18, on)} ${fm(p.likes)}</button>
    <button data-a="comments" data-id="${p.id}" aria-label="تبصرے">${ic("comment", 18)} ${fm(p.comments)}</button>
    <button class="sv end ${sv ? "on" : ""}" data-a="save" data-id="${p.id}" aria-pressed="${sv}" aria-label="محفوظ کریں">${ic("bookmark", 18, sv)}</button>
    <button data-a="share" data-id="${p.id}" aria-label="شیئر">${ic("share", 18)}</button>
  </div>`;
}

function postCard(p) {
  const poem = isPoem(p);
  const ex = p.excerpt || "";
  return h`<article class="card">
    <button class="who" data-a="author" data-id="${p.authorId}" data-u="${p.username}">${avatar({ name: p.name, avatarUrl: p.avatarUrl })}<div><b>${p.name}</b><small>${ago(p.at)} · ${p.category}</small></div></button>
    <h3 class="hl"><button data-a="open" data-id="${p.id}">${p.title}</button></h3>
    ${poem
      ? h`<button class="poem" data-a="open" data-id="${p.id}">${lines(stripMarks(ex)).slice(0, 2).map((l, i) => h`${i ? raw("<br>") : ""}${l}`)}</button>`
      : h`<p>${teaser(ex, 110)}</p>${cover(p, 120)}`}
    ${postActs(p)}
  </article>`;
}
function postRow(p) {
  return h`<button class="li" data-a="open" data-id="${p.id}">${cover(p, 58)}<div><b>${p.title}</b><small>${p.name} · ${ago(p.at)}</small></div></button>`;
}
function personRow(p, trailing) {
  return h`<div class="li"><button class="lhit" data-a="author" data-id="${p.id}" data-u="${p.username}">${avatar(p)}<div><b>${p.name}</b><small class="ltr">@${p.username}</small></div></button>${trailing === undefined ? followButton(p.id) : trailing}</div>`;
}
const statusChip = (text, tone) => h`<span class="chip ${tone || ""}">${text}</span>`;

/* Form helpers: values come from S.fields so a re-render never loses what the user typed. */
const fv = (key, fallback) => (S.fields[key] != null ? S.fields[key] : (fallback == null ? "" : fallback));
const fieldInput = (key, o) => {
  const x = o || {};
  return h`<input class="fld ${x.cls || ""}" data-f="${key}" id="f-${key.replace(/\W/g, "_")}" value="${fv(key)}" ${x.ph ? raw('placeholder="' + esc(x.ph) + '"') : ""} ${x.max ? raw('maxlength="' + Number(x.max) + '"') : ""} ${x.mode ? raw('inputmode="' + esc(x.mode) + '"') : ""} ${x.enter ? raw('data-enter="' + esc(x.enter) + '"') : ""} ${x.label ? raw('aria-label="' + esc(x.label) + '"') : ""} ${x.ltr ? raw('style="direction:ltr;text-align:left"') : ""}>`;
};
const fieldArea = (key, o) => {
  const x = o || {};
  return h`<textarea class="fld" data-f="${key}" id="f-${key.replace(/\W/g, "_")}" rows="${x.rows || 4}" ${x.max ? raw('maxlength="' + Number(x.max) + '"') : ""} ${x.ph ? raw('placeholder="' + esc(x.ph) + '"') : ""} ${x.label ? raw('aria-label="' + esc(x.label) + '"') : ""}>${fv(key)}</textarea>`;
};
const optionList = (list, selected) => list.map((o) => h`<option value="${o[0]}" ${o[0] === selected ? raw("selected") : ""}>${o[1]}</option>`);
function clearFields(prefix) { Object.keys(S.fields).forEach((k) => { if (k.startsWith(prefix)) delete S.fields[k]; }); }

/* Run an async action once at a time, showing the busy state on the triggering element. */
async function guarded(key, el, fn) {
  if (S.busy.has(key)) return undefined;
  S.busy.add(key);
  if (el) { el.disabled = true; el.setAttribute("aria-busy", "true"); }
  try { return await fn(); }
  catch (e) { toast(errText(e)); return undefined; }
  finally {
    S.busy.delete(key);
    if (el && el.isConnected) { el.disabled = false; el.removeAttribute("aria-busy"); }
  }
}
