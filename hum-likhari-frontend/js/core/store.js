"use strict";
/* Data layer: view-model mapping, caches, paged lists and optimistic actions.
 * Nothing here builds HTML. Everything that reaches the screens has been mapped from a database row. */
const BE = () => window.HLBackend;

/* ---------- view-model mapping ---------- */
function avatarUrlOf(path) { return path ? BE().profiles.avatarUrl(path) : null; }

function mapPost(r) {
  const labels = BE().labels;
  const post = {
    id: r.id, authorId: r.author_id, title: r.title || "",
    body: typeof r.body === "string" ? r.body : null,
    excerpt: r.excerpt != null ? String(r.excerpt) : null,
    catSlug: r.category_slug, topicSlug: r.topic_slug,
    category: labels.slugToCategory(r.category_slug), topic: labels.slugToTopic(r.topic_slug),
    allowSupport: r.allow_support !== false,
    coverPath: r.cover_image_path || null,
    coverUrl: r.cover_image_path ? BE().posts.coverUrl(r.cover_image_path) : null,
    at: r.published_at || r.created_at || r.updated_at || "",
    status: r.status || "published",
    likes: Number(r.like_count || 0), comments: Number(r.comment_count || 0),
    name: r.display_name || "", username: r.username || "", avatarUrl: avatarUrlOf(r.avatar_path),
  };
  if (!post.name && S.me && post.authorId === S.me.id) { post.name = S.me.name; post.username = S.me.username; post.avatarUrl = S.me.avatarUrl; }
  return post;
}
function cachePost(post) {
  const old = S.posts.get(post.id);
  if (old) {
    if (post.body == null && old.body != null) post.body = old.body;
    if (!post.name && old.name) { post.name = old.name; post.username = old.username; post.avatarUrl = old.avatarUrl; }
  }
  S.posts.set(post.id, post);
  return post;
}
const mapAndCache = (rows) => rows.map((r) => cachePost(mapPost(r)));
const isPoem = (post) => post.catSlug === "poetry";

function mapProfile(r) {
  return {
    id: r.id, username: r.username || "", name: r.display_name || "", bio: r.bio || "",
    avatarUrl: avatarUrlOf(r.avatar_path), avatarPath: r.avatar_path || null,
    country: r.country_code || "", at: r.created_at || "", active: r.is_active !== false,
  };
}
function mapComment(r) {
  const a = r.author || {};
  return {
    id: r.id, postId: r.post_id, authorId: r.author_id, parentId: r.parent_id || null, body: r.body || "", at: r.created_at,
    name: a.display_name || "", username: a.username || "", avatarUrl: avatarUrlOf(a.avatar_path),
  };
}
function mapNotification(r) {
  const a = r.actor || {};
  const p = r.post || {};
  return {
    id: r.id, type: r.event_type, postId: r.post_id || null, commentId: r.comment_id || null,
    claimId: r.support_claim_id || null, ticketId: r.ticket_id || null, read: !!r.read_at, at: r.created_at,
    actorId: a.id || null, actorName: a.display_name || "", actorUsername: a.username || "", actorAvatar: avatarUrlOf(a.avatar_path),
    postTitle: p.title || "",
  };
}
const mapPerson = (r) => ({ id: r.id, username: r.username || "", name: r.display_name || "", bio: r.bio || "", avatarUrl: avatarUrlOf(r.avatar_path) });

function notificationText(n) {
  const who = n.actorName || "کوئی قاری";
  switch (n.type) {
    case "post_like": return who + " نے آپ کی تحریر" + (n.postTitle ? " «" + n.postTitle + "»" : "") + " پسند کی";
    case "comment": return who + " نے تبصرہ کیا";
    case "new_follower": return who + " نے آپ کو فالو کیا";
    case "writer_support": return who + " نے آپ کو تعاون بھیجنے کی اطلاع دی";
    case "ticket_reply": return "آپ کے پیغام کا جواب آیا ہے";
    case "badge_update": return "آپ کی بیج کی درخواست پر فیصلہ ہو گیا";
    case "team_update": return "ٹیم میں شمولیت کی درخواست کی صورتِ حال تبدیل ہوئی";
    case "platform_donation_update": return "پلیٹ فارم معاونت کی صورتِ حال تبدیل ہوئی";
    case "content_removed": return "آپ کا مواد کمیونٹی اصولوں کی خلاف ورزی پر ہٹا دیا گیا";
    default: return "ہم لکھاری کی طرف سے اطلاع";
  }
}

/* ---------- generic keyed loader (single object results) ---------- */
function fetchKey(key, fn, opts) {
  const o = opts || {};
  const cur = S.v[key];
  if (cur && cur.st === "loading") return cur.p;
  if (cur && cur.st === "ok" && !o.force && Date.now() - cur.t < (o.ttl == null ? 60000 : o.ttl)) return Promise.resolve(cur.d);
  const p = Promise.resolve().then(fn).then(
    (d) => { S.v[key] = { st: "ok", d, t: Date.now() }; softRender(); return d; },
    (e) => { S.v[key] = { st: "err", e: errText(e), t: Date.now(), d: cur && cur.d }; softRender(); return undefined; }
  );
  S.v[key] = { st: "loading", p, d: cur && cur.d };
  return p;
}
const vget = (key) => S.v[key] || { st: "idle" };
const vdata = (key) => (S.v[key] && S.v[key].d) || null;
function vclear(prefix) { Object.keys(S.v).forEach((k) => { if (k.startsWith(prefix)) delete S.v[k]; }); }

function errText(e) {
  if (!e) return "کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔";
  if (e.userMessage) return e.userMessage;
  try { return BE().userMessage(e); } catch (_) { return "کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔"; }
}

/* ---------- paged lists ---------- */
function listOf(key) { return S.lists[key] || (S.lists[key] = { items: [], from: 0, done: false, loading: false, err: "", t: 0, loaded: false }); }
function listReset(prefix) { Object.keys(S.lists).forEach((k) => { if (k.startsWith(prefix)) delete S.lists[k]; }); }
/* fetchPage(from, size) -> Promise<array of items>. Items must have a stable `id`. */
async function listLoad(key, fetchPage, o) {
  const opt = o || {};
  const list = listOf(key);
  if (list.loading) return list;
  if (!opt.more && list.loaded && !opt.force && Date.now() - list.t < (opt.ttl == null ? 60000 : opt.ttl)) return list;
  if (opt.more && list.done) return list;
  list.loading = true; list.err = "";
  const from = opt.more ? list.from : 0;
  softRender();
  try {
    const rows = await fetchPage(from, opt.size || FEED_PAGE);
    if (!opt.more) list.items = [];
    const seen = new Set(list.items.map((x) => x.id));
    rows.forEach((x) => { if (!seen.has(x.id)) list.items.push(x); });
    list.from = from + rows.length;
    list.done = rows.length < (opt.size || FEED_PAGE);
    list.loaded = true; list.t = Date.now();
  } catch (e) {
    list.err = errText(e);
  }
  list.loading = false;
  softRender();
  return list;
}

/* ---------- per-user flags for post lists ---------- */
async function hydrateFlags(posts) {
  if (!S.user || !posts.length) return;
  const ids = posts.map((p) => p.id);
  try {
    const [liked, saved] = await Promise.all([BE().social.myLikes(ids), BE().social.myBookmarkIds(ids)]);
    ids.forEach((id) => { liked.includes(id) ? S.liked.add(id) : S.liked.delete(id); saved.includes(id) ? S.saved.add(id) : S.saved.delete(id); });
    softRender();
  } catch (_) { /* flags are cosmetic; failures surface on the action itself */ }
}

/* post pages -> cached view models + flags */
async function postPage(fetcher) {
  const rows = await fetcher();
  const posts = mapAndCache(rows);
  hydrateFlags(posts);
  return posts;
}

/* ---------- optimistic social actions ---------- */
async function toggleLike(postId) {
  const post = S.posts.get(postId);
  if (!post) return;
  const key = "like:" + postId;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  const was = S.liked.has(postId);
  was ? S.liked.delete(postId) : S.liked.add(postId);
  post.likes = Math.max(0, post.likes + (was ? -1 : 1));
  softRender();
  try { was ? await BE().social.unlike(postId) : await BE().social.like(postId); }
  catch (e) {
    was ? S.liked.add(postId) : S.liked.delete(postId);
    post.likes = Math.max(0, post.likes + (was ? 1 : -1));
    toast(errText(e));
  } finally { S.busy.delete(key); softRender(); }
}
async function toggleSave(postId) {
  const key = "save:" + postId;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  const was = S.saved.has(postId);
  was ? S.saved.delete(postId) : S.saved.add(postId);
  softRender();
  try {
    was ? await BE().social.unbookmark(postId) : await BE().social.bookmark(postId);
    listReset("saved");
    toast(was ? "محفوظ سے ہٹا دی گئی" : "محفوظ کر لی گئی");
  } catch (e) {
    was ? S.saved.add(postId) : S.saved.delete(postId);
    toast(errText(e));
  } finally { S.busy.delete(key); softRender(); }
}
async function toggleFollow(userId) {
  if (!userId || (S.me && userId === S.me.id)) return;
  const key = "follow:" + userId;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  const was = S.following.has(userId);
  was ? S.following.delete(userId) : S.following.add(userId);
  bumpStat(userId, "followers", was ? -1 : 1);
  bumpStat(S.me && S.me.id, "following", was ? -1 : 1);
  softRender();
  try {
    was ? await BE().social.unfollow(userId) : await BE().social.follow(userId);
    listReset("feed:1");
  } catch (e) {
    was ? S.following.add(userId) : S.following.delete(userId);
    bumpStat(userId, "followers", was ? 1 : -1);
    bumpStat(S.me && S.me.id, "following", was ? 1 : -1);
    toast(errText(e));
  } finally { S.busy.delete(key); softRender(); }
}
function bumpStat(userId, field, delta) {
  const e = userId && S.v["stats:" + userId];
  if (e && e.d) e.d[field] = Math.max(0, (e.d[field] || 0) + delta);
}

/* ---------- invalidation after writes ---------- */
function invalidatePosts() { listReset("feed"); listReset("mine"); listReset("search"); listReset("author"); vclear("drafts"); }
