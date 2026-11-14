"use strict";
/* Comments, notifications, public author profile, followers/following. */

/* ---------------- comments ---------------- */
L.comments = (p, force) => {
  fetchKey("post:" + p.id, async () => {
    const post = cachePost(mapPost(await BE().posts.get(p.id)));
    return post.id;
  }, { force, ttl: 120000 });
  fetchKey("comments:" + p.id, async () => (await BE().comments.list(p.id)).map(mapComment), { force, ttl: 20000 });
};
function threadComments(list) {
  const byId = new Map(list.map((c) => [c.id, c]));
  const rootOf = (c) => { let cur = c, guard = 0; while (cur.parentId && byId.has(cur.parentId) && guard++ < 50) cur = byId.get(cur.parentId); return cur; };
  const roots = list.filter((c) => rootOf(c) === c);
  return roots.flatMap((r) => [{ c: r, depth: 0 }].concat(list.filter((c) => c !== r && rootOf(c) === r).map((c) => ({ c, depth: 1, to: byId.get(c.parentId) }))));
}
function commentList(postId) {
  const st = vget("comments:" + postId);
  const post = S.posts.get(postId);
  if (st.st === "loading" && !st.d) return loadingView();
  if (st.st === "err" && !st.d) return errorView(st.e, "commentsRetry", postId);
  const rows = threadComments(st.d || []);
  if (!rows.length) return emptyView("ابھی کوئی تبصرہ نہیں۔ پہلا تبصرہ آپ کریں۔");
  return rows.map(({ c, depth, to }) => {
    const mine = S.me && c.authorId === S.me.id, owner = S.me && post && post.authorId === S.me.id;
    return h`<div class="cm ${depth ? "rep" : ""}"><b>${c.name || "لکھاری"}</b>${to ? h`<small class="mu"> ← ${to.name}</small>` : ""}<div class="ct">${c.body}</div>
    <div class="acts" style="margin:2px 0 0"><small>${ago(c.at)}</small>${mine ? "" : h`<button data-a="reply" data-id="${c.id}" data-n="${c.name}">جواب</button><button data-a="reportComment" data-id="${c.id}">رپورٹ</button>`}${mine || owner ? h`<button data-a="deleteComment" data-id="${c.id}" data-p="${postId}" style="color:var(--hr)">حذف</button>` : ""}</div></div>`;
  });
}
R.comments = (p) => {
  const n = (vdata("comments:" + p.id) || []).length;
  return h`${hd("تبصرے (" + n + ")")}<div id="cl">${commentList(p.id)}</div>
  ${S.user ? h`<div class="cin"><input class="fld" id="cin" data-f="cm.text" data-enter="sendComment" value="${fv("cm.text")}" maxlength="5000" placeholder="تبصرہ لکھیں…" aria-label="تبصرہ"><button class="ic" data-a="sendComment" aria-label="بھیجیں" style="color:var(--g)">${ic("send")}</button></div>`
    : h`<div class="cin"><button class="btn o" data-a="signinPrompt">تبصرہ کرنے کے لیے سائن اِن کریں</button></div>`}`;
};
PARTIAL.comments = () => [["#cl", commentList(S.params.id)]];

Object.assign(ACT, {
  commentsRetry: (el) => { L.comments({ id: el.dataset.id }, true); render({ keep: true }); },
  reply: (el) => {
    if (!needAuth("جواب دینے کے لیے سائن اِن کریں۔")) return;
    S.fields["cm.parent"] = el.dataset.id;
    S.fields["cm.text"] = "@" + el.dataset.n + " ";
    render({ keep: true });
    const i = $("#cin"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  },
  sendComment: (el) => guarded("comment", el, async () => {
    if (!needAuth("تبصرہ کرنے کے لیے سائن اِن کریں۔")) return;
    const id = S.params.id, text = String(S.fields["cm.text"] || "").trim();
    if (!text) { toast("پہلے تبصرہ لکھیں"); return; }
    const row = await BE().comments.add({ postId: id, body: text, parentId: S.fields["cm.parent"] || null });
    const list = (vdata("comments:" + id) || []).slice();
    list.push(Object.assign(mapComment(row), { name: S.me.name, username: S.me.username, avatarUrl: S.me.avatarUrl }));
    S.v["comments:" + id] = { st: "ok", d: list, t: Date.now() };
    const post = S.posts.get(id); if (post) post.comments += 1;
    clearFields("cm."); render({ keep: true, force: true });
  }),
  deleteComment: (el) => guarded("cdel:" + el.dataset.id, el, async () => {
    const id = el.dataset.p;
    await BE().comments.remove(el.dataset.id);
    const removed = new Set([el.dataset.id]);
    let list = vdata("comments:" + id) || [];
    let grew = true;
    while (grew) { grew = false; list.forEach((c) => { if (c.parentId && removed.has(c.parentId) && !removed.has(c.id)) { removed.add(c.id); grew = true; } }); }   // replies go with their parent (ON DELETE CASCADE)
    S.v["comments:" + id] = { st: "ok", d: list.filter((c) => !removed.has(c.id)), t: Date.now() };
    const post = S.posts.get(id); if (post) post.comments = Math.max(0, post.comments - removed.size);
    render({ keep: true, force: true }); toast("تبصرہ حذف ہو گیا");
  }),
  reportComment: (el) => { if (needAuth("رپورٹ کرنے کے لیے سائن اِن کریں۔")) openSheet("report", { target: "comment", id: el.dataset.id }); },
});

/* ---------------- notifications ---------------- */
const notifKey = () => "notif";
function loadNotifs(force, more) {
  return listLoad(notifKey(), async (from, size) => (await BE().notifications.list({ limit: size, from })).map(mapNotification), { force, more, size: 30 });
}
L.notif = (p, force) => { if (S.user) { loadNotifs(force); refreshUnread(); } };
R.notif = () => {
  const list = listOf(notifKey());
  const unread = list.items.filter((n) => !n.read).length;
  return h`<div class="hdr"><span class="rt"></span><h2>اطلاعات</h2><span class="rt">${S.unread || unread ? h`<button class="lnk" data-a="notifAll" style="font-size:13px">سب پڑھ لیے</button>` : ""}</span></div>
  ${!list.items.length && list.loading ? loadingView() : !list.items.length && list.err ? errorView(list.err, "notifRetry")
    : list.items.length ? h`${list.items.map((n) => h`<button class="li" data-a="notif" data-id="${n.id}" style="${n.read ? "" : "background:var(--gs)"}">${avatar({ name: n.actorName || "ہ", avatarUrl: n.actorAvatar })}<div><b style="font-weight:${n.read ? 400 : 700}">${notificationText(n)}</b><small>${ago(n.at)}</small></div></button>`)}${listFooter(list, "notifMore")}`
    : emptyView("کوئی نئی اطلاع نہیں۔")}`;
};
Object.assign(ACT, {
  notifRetry: () => { loadNotifs(true); },
  notifMore: () => loadNotifs(false, true),
  notifAll: () => guarded("notifall", null, async () => {
    await BE().notifications.markAllRead();
    listOf(notifKey()).items.forEach((n) => { n.read = true; }); S.unread = 0; render({ keep: true });
  }),
  notif: (el) => {
    const n = listOf(notifKey()).items.find((x) => x.id === el.dataset.id);
    if (!n) return;
    if (!n.read) { n.read = true; S.unread = Math.max(0, S.unread - 1); BE().notifications.markRead(n.id).catch(() => { n.read = false; S.unread += 1; softRender(); }); }
    switch (n.type) {
      case "post_like": if (n.postId) go("article", { id: n.postId }); break;
      case "comment": if (n.postId) go("comments", { id: n.postId }); break;
      case "new_follower": if (n.actorId) go("author", { id: n.actorId, username: n.actorUsername }); break;
      case "writer_support": go("history", { tab: 0 }); break;
      case "ticket_reply": if (n.ticketId) go("ticket", { id: n.ticketId }); else go("help"); break;
      case "badge_update": go("badges"); break;
      case "team_update": go("team"); break;
      case "platform_donation_update": go("platform"); break;
      case "content_removed": openSheet("removedNotice"); break;
      default: render({ keep: true });
    }
  },
});

/* ---------------- author (public profile) ---------------- */
const profKey = (p) => "profile:" + (p.username || p.id);
L.author = (p, force) => {
  fetchKey(profKey(p), async () => {
    const row = p.username ? await BE().profiles.byUsername(p.username) : await BE().profiles.byId(p.id);
    const prof = mapProfile(row);
    fetchKey("stats:" + prof.id, () => BE().profiles.stats(prof.id), { force });
    fetchKey("badges:" + prof.id, async () => (await BE().profiles.badges(prof.id)).map((b) => b.badge_type), { force });
    loadAuthorPosts(prof.id, force);
    return prof;
  }, { force, ttl: 30000 });
};
const authorKey = (id) => "author:" + id;
function loadAuthorPosts(id, force, more) {
  return listLoad(authorKey(id), (from, size) => postPage(() => BE().posts.feed({ limit: size, from, authorId: id })), { force, more });
}
const badgeChips = (types) => (types || []).map((t) => h`<span class="chip ok">${ic("award", 12)} ${labelOf(BADGE_TYPES, t)}</span>`);

function profileHeader(prof, stats, badges, opts) {
  return h`<div style="text-align:center;padding:14px 16px 0">${avatar(prof, 88)}<div style="font-size:20px;font-weight:700">${prof.name}</div><div class="mu ltr">@${prof.username}</div>
  ${badges && badges.length ? h`<div class="chips">${badgeChips(badges)}</div>` : ""}
  ${prof.bio ? h`<div class="mu" style="margin:2px 16px 0;font-size:14px">${prof.bio}</div>` : ""}</div>
  <div class="stats"><div><b>${stats ? fm(stats.posts) : "–"}</b><span>تحریریں</span></div>
  <button data-a="people" data-id="${prof.id}" data-n="${prof.name}" data-t="0"><b>${stats ? fm(stats.followers) : "–"}</b><span>فالوورز</span></button>
  <button data-a="people" data-id="${prof.id}" data-n="${prof.name}" data-t="1"><b>${stats ? fm(stats.following) : "–"}</b><span>فالونگ</span></button></div>${opts || ""}`;
}
R.author = (p) => {
  const st = vget(profKey(p));
  const prof = st.d;
  if (!prof) return h`${hd("")}${st.st === "err" ? errorView(st.e, "authorRetry") : loadingView()}`;
  const stats = vdata("stats:" + prof.id), badges = vdata("badges:" + prof.id);
  const list = listOf(authorKey(prof.id));
  const on = S.following.has(prof.id);
  const self = !!(S.me && prof.id === S.me.id);
  const actions = self
    ? h`<div class="pad" style="padding-top:0"><button class="btn o" data-a="editProfile">پروفائل ایڈٹ کریں</button></div>`
    : h`<div class="pad" style="padding-top:0;display:flex;gap:8px"><button class="btn ${on ? "o" : ""}" data-a="follow" data-id="${prof.id}" aria-pressed="${on}">${on ? "فالو کر رہے ہیں" : "فالو"}</button><button class="btn au" data-a="donate" data-id="${prof.id}" data-n="${prof.name}">تعاون کریں</button></div>`;
  return h`${hd(prof.name, h`<button class="ic" data-a="authorMore" data-id="${prof.id}" aria-label="مزید">${ic("more")}</button>`)}${profileHeader(prof, stats, badges, actions)}
  <div class="tabs"><button class="on">تحریریں</button></div>
  ${list.items.length ? h`${list.items.map(postRow)}${listFooter(list, "authorMore2", prof.id)}` : list.loading ? loadingView() : list.err ? errorView(list.err, "authorMore2", prof.id) : emptyView("اس لکھاری نے ابھی کوئی تحریر شائع نہیں کی۔")}`;
};
Object.assign(ACT, {
  authorRetry: () => { vclear("profile:"); L.author(S.params, true); render({ keep: true }); },
  authorMore: (el) => openSheet("authorMore", { id: el.dataset.id }),
  authorMore2: (el) => loadAuthorPosts(el.dataset.id, false, true),
  people: (el) => go("people", { id: el.dataset.id, name: el.dataset.n, tab: Number(el.dataset.t) }),
});

/* ---------------- followers / following ---------------- */
const peopleKey = (id, tab) => (tab ? "following:" : "followers:") + id;
function loadPeople(p, force, more) {
  const fn = p.tab ? BE().social.following : BE().social.followers;
  return listLoad(peopleKey(p.id, p.tab), async (from, size) => (await fn(p.id, { limit: size, from })).map(mapPerson), { force, more, size: 30 });
}
L.people = (p, force) => { loadPeople(p, force); };
R.people = (p) => {
  const mine = S.me && p.id === S.me.id;
  const list = listOf(peopleKey(p.id, p.tab));
  const stats = vdata("stats:" + p.id);
  const cnt = [stats ? fm(stats.followers) : "", stats ? fm(stats.following) : ""];
  return h`${hd(p.name || "")}<div class="tabs">${["فالوورز", "فالونگ"].map((x, i) => h`<button data-a="peopleTab" data-t="${i}" class="${i === p.tab ? "on" : ""}">${x}${cnt[i] ? " (" + cnt[i] + ")" : ""}</button>`)}</div>
  ${!list.items.length && list.loading ? loadingView() : !list.items.length && list.err ? errorView(list.err, "peopleRetry")
    : list.items.length ? h`${list.items.map((x) => personRow(x, mine && !p.tab ? h`<button class="lnk" data-a="removeFollower" data-id="${x.id}" style="margin-inline-start:auto;color:var(--hr)">ہٹائیں</button>` : undefined))}${listFooter(list, "peopleMore")}`
    : emptyView("ابھی یہاں کوئی نہیں۔")}`;
};
Object.assign(ACT, {
  peopleTab: (el) => { S.params = Object.assign({}, S.params, { tab: Number(el.dataset.t) }); L.people(S.params, false); render({ keep: true }); },
  peopleMore: () => loadPeople(S.params, false, true),
  peopleRetry: () => loadPeople(S.params, true),
  removeFollower: (el) => guarded("rmf:" + el.dataset.id, el, async () => {
    await BE().social.removeFollower(el.dataset.id);
    const l = listOf(peopleKey(S.params.id, 0)); l.items = l.items.filter((x) => x.id !== el.dataset.id);
    bumpStat(S.me.id, "followers", -1); render({ keep: true }); toast("فالوور ہٹا دیا گیا");
  }),
});
