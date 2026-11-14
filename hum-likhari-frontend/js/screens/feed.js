"use strict";
/* Home feed, search/explore and the article reader. */

/* ---------------- home ---------------- */
const feedKey = () => "feed:" + S.feedTab + ":" + S.cat;
function loadFeed(force, more) {
  if (S.feedTab === 1 && !S.user) return Promise.resolve();
  const tab = S.feedTab, cat = S.cat || undefined;
  return listLoad(feedKey(), (from, size) => postPage(() => (tab === 1
    ? BE().posts.followingFeed({ limit: size, from, category: cat })
    : BE().posts.feed({ limit: size, from, category: cat }))), { force, more });
}
L.home = (p, force) => { loadFeed(force); };

R.home = () => {
  const list = listOf(feedKey());
  const guestFollow = S.feedTab === 1 && !S.user;
  let items = list.items.slice();
  if (S.feedTab === 0 && S.interests.size) items.sort((a, b) => (S.interests.has(a.topicSlug) ? 0 : 1) - (S.interests.has(b.topicSlug) ? 0 : 1));
  const cats = [["", "سب"]].concat(CATEGORY_LABELS.map((c) => [c, c]));
  let body;
  if (guestFollow) body = emptyView("فالو کی گئی تحریریں دیکھنے کے لیے سائن اِن کریں۔", "signinPrompt", "سائن اِن");
  else if (!items.length && list.loading) body = loadingView();
  else if (!items.length && list.err) body = errorView(list.err, "feedRetry");
  else if (!items.length) body = S.feedTab
    ? emptyView("آپ نے ابھی کسی لکھاری کو فالو نہیں کیا۔", "tab", "تلاش کھولیں", "explore")
    : emptyView("اس صنف میں ابھی کوئی تحریر نہیں۔", S.user ? "tab" : "", "پہلی تحریر لکھیں", "write");
  else body = h`${items.map(postCard)}${listFooter(list, "feedMore")}`;
  return h`<div class="hdr"><span class="rt"></span><button class="logo" data-a="feedRefresh" aria-label="ہم لکھاری، تازہ کریں">ہم لکھاری</button><span class="rt"></span></div>
  <div class="tabs">${["آپ کے لیے", "فالو"].map((t, i) => h`<button data-a="feedTab" data-v="${i}" class="${i === S.feedTab ? "on" : ""}">${t}</button>`)}</div>
  <div class="cats">${cats.map((c) => h`<button data-a="feedCat" data-v="${c[0]}" class="${c[0] === S.cat ? "on" : ""}">${c[1]}</button>`)}</div>${body}`;
};

/* ---------------- explore ---------------- */
const searchKey = () => "search:" + S.q.trim() + ":" + S.topic;
function loadSearch(force, more) {
  const q = S.q.trim(), topic = S.topic;
  if (!q && !topic) return listLoad(searchKey(), (from, size) => postPage(() => BE().posts.feed({ limit: size, from })), { force, more });
  return listLoad(searchKey(), (from, size) => postPage(() => BE().posts.search({ query: q, topic: topic ? BE().labels.slugToTopic(topic) : null, limit: size, offset: from })), { force, more });
}
L.explore = (p, force) => { loadSearch(force); };
function exploreResults() {
  const list = listOf(searchKey());
  if (!list.items.length && list.loading) return loadingView();
  if (!list.items.length && list.err) return errorView(list.err, "searchRetry");
  if (!list.items.length) return h`<div class="empty">کوئی نتیجہ نہیں ملا۔ کوئی اور لفظ آزمائیں۔</div>`;
  return h`${list.items.map(postRow)}${listFooter(list, "searchMore")}`;
}
R.explore = () => h`<div class="hdr"><label class="search" style="flex:1"><span style="display:inline-flex">${ic("search", 18)}</span><input id="qin" data-i="search" value="${S.q}" maxlength="100" placeholder="تحریر یا لکھاری تلاش کریں…" aria-label="تلاش" enterkeyhint="search"></label></div>
<div class="pad" style="padding-bottom:0"><b>موضوعات</b></div>
<div class="cats wrap">${BE().labels.topics.map((t) => h`<button data-a="topic" data-v="${t.slug}" class="${t.slug === S.topic ? "on" : ""}" aria-pressed="${t.slug === S.topic}">${t.label}</button>`)}</div>
<div class="pad" style="padding-bottom:0"><b>${S.q.trim() || S.topic ? "نتائج" : "تازہ ترین تحریریں"}</b></div><div id="res">${exploreResults()}</div>`;
PARTIAL.explore = () => [["#res", exploreResults()]];
const runSearch = debounce(() => { loadSearch(); render({ keep: true }); }, 350);
INPUT.search = (t) => { S.q = t.value; runSearch(); };

/* ---------------- article ---------------- */
L.article = (p, force) => {
  fetchKey("post:" + p.id, async () => {
    const post = cachePost(mapPost(await BE().posts.get(p.id)));
    hydrateFlags([post]);
    return post.id;
  }, { force, ttl: 30000 });
};
const READ_SIZES = [15, 17, 19, 22];

R.article = (p) => {
  const st = vget("post:" + p.id);
  const post = S.posts.get(p.id);
  if (!post || post.body == null) {
    return h`${hd("")}${st.st === "err" ? errorView(st.e, "articleRetry", p.id) : loadingView()}`;
  }
  const mine = !!(S.me && post.authorId === S.me.id);
  if (post.status === "removed") {
    return h`${hd("")}<div class="pad"><div class="notice bad">یہ تحریر کمیونٹی اصولوں کی خلاف ورزی کی وجہ سے ہٹا دی گئی ہے۔${mine ? " اگر آپ کو اعتراض ہے تو مدد اور رابطہ میں ہمیں لکھیں۔" : ""}</div></div>`;
  }
  const poem = isPoem(post);
  const ls_ = lines(post.body);
  const fam = S.nk ? "'Noto Nastaliq Urdu',serif" : "inherit";
  const body = poem
    ? ls_.map((l, i) => (i % 2 ? "" : h`<div class="cpl">${formatInline(l)}${raw("<br>")}${ls_[i + 1] ? formatInline(ls_[i + 1]) : ""}</div>`))
    : ls_.map((l) => h`<p>${formatInline(l)}</p>`);
  return h`${hd("", h`<button class="ic" data-a="readPrefs" aria-label="پڑھنے کی ترتیب" aria-expanded="${S.rc}">${ic("type")}</button><button class="ic" data-a="postMore" data-id="${post.id}" aria-label="مزید">${ic("more")}</button>`)}
  ${S.rc ? h`<div class="rp">سائز<button data-a="fontSize" data-v="-1">چھوٹا</button><button data-a="fontSize" data-v="1">بڑا</button><button data-a="nastaliq">${S.nk ? "نسخ میں پڑھیں" : "نستعلیق میں پڑھیں"}</button></div>` : ""}
  ${poem ? "" : h`<div class="hero">${cover(post, 170)}</div>`}
  <div class="pad"><h1 class="hl" style="font-size:24px">${post.title}</h1>
  <div class="who" style="margin:6px 0 12px"><button class="whohit" data-a="author" data-id="${post.authorId}" data-u="${post.username}">${avatar({ name: post.name, avatarUrl: post.avatarUrl })}<div><b>${post.name}</b><small>${ago(post.at)} · ${post.category}</small></div></button>${mine ? "" : followButton(post.authorId)}</div>
  <div class="body" style="font-size:${READ_SIZES[S.fs]}px;line-height:${S.nk ? 2.5 : 2.1};font-family:${fam}">${body}</div>
  ${post.allowSupport && !mine ? h`<div class="sup"><p>تحریر پسند آئی؟ لکھاری کی حوصلہ افزائی کریں۔</p><button class="btn au" data-a="donate" data-id="${post.authorId}" data-n="${post.name}" data-p="${post.id}">تعاون کریں</button></div>` : ""}</div>
  <div class="bar">${postActs(post)}</div>`;
};

Object.assign(ACT, {
  tab: (el) => {
    const v = el.dataset.v;
    if (!S.user && v !== "home" && v !== "explore") { needAuth(v === "write" ? "تحریر لکھنے کے لیے سائن اِن کریں۔" : ""); return; }
    if (S.scr === "write" && v === "write") return;
    if (S.scr === v && v !== "write") { if (v === "home") { listReset("feed"); } if (v === "explore") { listReset("search"); } if (v === "notif") { listReset("notif"); } if (v === "profile") { listReset("mine"); listReset("saved"); vclear("stats:"); } L[v](S.params, true); render({ keep: true }); return; }
    if (S.scr === "write" && v !== "write") { leaveWrite(); }
    go(v, {});
  },
  feedTab: (el) => { const v = +el.dataset.v; S.feedTab = v; L.home({}, false); render({ keep: true }); },
  feedCat: (el) => { S.cat = el.dataset.v; L.home({}, false); render({ keep: true }); },
  feedMore: () => loadFeed(false, true),
  feedRetry: () => loadFeed(true),
  feedRefresh: () => { listReset("feed"); loadFeed(true); softRender(); },
  topic: (el) => { S.topic = S.topic === el.dataset.v ? "" : el.dataset.v; loadSearch(); render({ keep: true }); },
  searchMore: () => loadSearch(false, true),
  searchRetry: () => loadSearch(true),
  signinPrompt: () => openSheet("signin"),
  open: (el) => go("article", { id: el.dataset.id }),
  articleRetry: (el) => { vclear("post:" + el.dataset.id); L.article({ id: el.dataset.id }, true); render({ keep: true }); },
  like: (el) => { if (needAuth("پسند کرنے کے لیے سائن اِن کریں۔")) toggleLike(el.dataset.id); },
  save: (el) => { if (needAuth("تحریر محفوظ کرنے کے لیے سائن اِن کریں۔")) toggleSave(el.dataset.id); },
  follow: (el) => { if (needAuth("فالو کرنے کے لیے سائن اِن کریں۔")) toggleFollow(el.dataset.id); },
  comments: (el) => go("comments", { id: el.dataset.id }),
  author: (el) => {
    const id = el.dataset.id, u = el.dataset.u;
    if (S.me && id === S.me.id) go("profile", {}); else go("author", { id, username: u });
  },
  readPrefs: () => { S.rc = !S.rc; render({ keep: true }); },
  fontSize: (el) => { S.fs = Math.max(0, Math.min(3, S.fs + Number(el.dataset.v))); savePrefs(); render({ keep: true }); },
  nastaliq: () => { S.nk = !S.nk; savePrefs(); render({ keep: true }); },
  postMore: (el) => openSheet("more", { id: el.dataset.id }),
});
