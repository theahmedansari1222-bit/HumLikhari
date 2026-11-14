/*
 * Hum Likhari — Supabase adapter v2 (classic script, no build step).
 *
 * Load @supabase/supabase-js UMD (pinned) first, then:
 *   HLBackend.configure({ url: 'https://PROJECT.supabase.co', publishableKey: 'sb_publishable_...' })
 *
 * Responsibilities
 *  - the ONLY place that knows table / RPC / bucket names;
 *  - every failure leaves as an Error that carries `.userMessage` (Urdu, safe to show) and `.code`;
 *  - never trusts the client for ownership: RLS and triggers in the database are the real guard,
 *    ownership filters here only keep queries narrow.
 *
 * Canonical copy lives in hum-likhari-backend/integration/; the frontend ships an identical copy
 * (scripts/validate.mjs fails the build if the two ever differ).
 */
(function (global) {
  "use strict";

  let client = null;
  let cachedSession = null;

  // ---------------------------------------------------------------- taxonomy (mirrors supabase/seed.sql)
  const CATEGORIES = [
    ["poetry", "شاعری"], ["fiction", "افسانہ"], ["column", "کالم"], ["essay", "مضمون"], ["travelogue", "سفرنامہ"],
  ];
  const TOPICS = [
    ["literature", "ادب"], ["love", "محبت"], ["society", "سماج"], ["life", "زندگی"], ["travel", "سفر"], ["technology", "ٹیکنالوجی"],
  ];
  const categoryToSlug = (label) => (CATEGORIES.find((c) => c[1] === label) || CATEGORIES[3])[0];
  const topicToSlug = (label) => (TOPICS.find((t) => t[1] === label) || TOPICS[0])[0];
  const slugToCategory = (slug) => (CATEGORIES.find((c) => c[0] === slug) || [slug, slug])[1];
  const slugToTopic = (slug) => (TOPICS.find((t) => t[0] === slug) || [slug, slug])[1];

  const LIMITS = {
    avatarBytes: 5 * 1024 * 1024,
    coverBytes: 8 * 1024 * 1024,
    qrBytes: 2 * 1024 * 1024,
    attachmentBytes: 5 * 1024 * 1024,
  };

  // ---------------------------------------------------------------- errors
  class UserError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "UserError";
      this.userMessage = message;
      this.code = code || "user_error";
    }
  }

  function userMessage(err, path) {
    if (!err) return "کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔";
    if (err.userMessage) return err.userMessage;
    const text = String(err.message || err.error_description || err.msg || "");
    const code = String(err.code || err.error_code || "");
    const status = Number(err.status || err.statusCode || 0);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
      return "انٹرنیٹ سے رابطہ نہیں ہو رہا۔ کنکشن چیک کر کے دوبارہ کوشش کریں۔";
    }
    if (/rate_limited/.test(text) || code === "over_request_rate_limit" || status === 429) {
      return "بہت زیادہ درخواستیں ہو گئیں۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔";
    }
    if (code === "over_sms_send_rate_limit") return "بار بار کوڈ منگوایا گیا ہے۔ کچھ دیر بعد دوبارہ کوشش کریں۔";
    if (code === "otp_expired" || /token has expired or is invalid|otp.*(expired|invalid)/i.test(text)) {
      return "کوڈ غلط ہے یا اس کی مدت ختم ہو چکی ہے۔";
    }
    if (code === "sms_send_failed") return "SMS بھیجا نہیں جا سکا۔ نمبر چیک کریں یا بعد میں کوشش کریں۔";
    if (code === "phone_provider_disabled" || /unsupported phone provider/i.test(text)) {
      return "فون نمبر سے سائن اِن فی الحال دستیاب نہیں۔ گوگل سے سائن اِن کریں۔";
    }
    if (code === "user_banned") return "یہ اکاؤنٹ فی الحال معطل ہے۔";
    if (/recent_login_required/.test(text)) return "حفاظت کے لیے دوبارہ سائن اِن کریں، پھر فوراً یہی کارروائی دہرائیں۔";
    if (/cannot_report_own_content/.test(text)) return "آپ اپنی ہی تحریر یا تبصرہ رپورٹ نہیں کر سکتے۔";
    if (code === "PGRST301" || /jwt expired|invalid jwt/i.test(text) || status === 401) {
      return "آپ کا سیشن ختم ہو گیا۔ دوبارہ سائن اِن کریں۔";
    }
    if (code === "23505") {
      if (/username/i.test(text) || path === "profiles.update") return "یہ ہینڈل پہلے سے کسی اور کے پاس ہے۔ کوئی اور چنیں۔";
      if (path === "social.report") return "آپ یہ رپورٹ پہلے ہی بھیج چکے ہیں۔ ہماری ٹیم جائزہ لے رہی ہے۔";
      if (path === "team.apply" || path === "badges.apply") return "آپ کی ایک درخواست پہلے سے زیرِ جائزہ ہے۔";
      return "یہ پہلے سے موجود ہے۔";
    }
    if (code === "42501" || /row-level security|permission denied/i.test(text)) {
      return "اس کارروائی کی اجازت نہیں۔ اگر آپ کا اکاؤنٹ فعال ہے تو دوبارہ سائن اِن کریں۔";
    }
    if (code === "PGRST116") return "مطلوبہ چیز نہیں ملی، یا اس میں تبدیلی کی اجازت نہیں۔";
    if (code === "23514" || code === "22001" || code === "23502") return "درج کی گئی معلومات درست یا مکمل نہیں۔";
    if (code === "23503") return "متعلقہ چیز اب موجود نہیں۔";
    return "کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔";
  }

  function decorate(err, path) {
    const out = err && typeof err === "object" ? err : new Error(String(err));
    try { out.userMessage = userMessage(out, path); } catch (_) { /* frozen error object */ }
    return out;
  }

  function wrapGroup(name, group) {
    Object.keys(group).forEach((key) => {
      const fn = group[key];
      if (typeof fn !== "function") return;
      const path = name + "." + key;
      group[key] = function wrapped() {
        let result;
        try { result = fn.apply(this, arguments); } catch (e) { throw decorate(e, path); }
        if (result && typeof result.then === "function") return result.catch((e) => { throw decorate(e, path); });
        return result;
      };
    });
  }

  // ---------------------------------------------------------------- helpers
  function requireClient() {
    if (!client) throw new UserError("ایپ کی ترتیب (configuration) مکمل نہیں۔", "not_configured");
    return client;
  }

  function unwrap(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  async function currentUser() {
    const db = requireClient();
    if (!cachedSession) {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      cachedSession = data.session;
    }
    if (!cachedSession || !cachedSession.user) throw new UserError("اس کارروائی کے لیے سائن اِن ضروری ہے۔", "auth_required");
    return cachedSession.user;
  }

  const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const DOC_TYPES = IMAGE_TYPES.concat(["application/pdf"]);

  function assertFile(file, types, maxBytes) {
    if (!file || typeof file.type !== "string" || typeof file.size !== "number") {
      throw new UserError("فائل درست نہیں۔", "bad_file");
    }
    if (!types.includes(file.type)) {
      throw new UserError(types === IMAGE_TYPES ? "صرف JPG، PNG یا WebP تصویر منتخب کریں۔" : "صرف JPG، PNG، WebP یا PDF فائل منتخب کریں۔", "bad_file_type");
    }
    if (file.size > maxBytes) {
      throw new UserError("فائل مقررہ سائز (" + Math.round(maxBytes / 1048576) + " MB) سے بڑی ہے۔", "file_too_large");
    }
  }

  async function upload(bucket, file, types, maxBytes) {
    const db = requireClient();
    const user = await currentUser();
    assertFile(file, types, maxBytes);
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    const path = user.id + "/" + crypto.randomUUID() + "." + extension;
    const { error } = await db.storage.from(bucket).upload(path, file, {
      cacheControl: "3600", contentType: file.type, upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async function removeObject(bucket, path) {
    if (!path) return;
    try { await requireClient().storage.from(bucket).remove([path]); } catch (_) { /* best effort cleanup */ }
  }

  function clean(text) { return String(text == null ? "" : text); }

  const FEED_COLUMNS = "id,author_id,title,excerpt,category_slug,topic_slug,allow_support,cover_image_path," +
    "published_at,created_at,updated_at,display_name,username,avatar_path,like_count,comment_count";
  const PROFILE_PUBLIC = "id,username,display_name,bio,avatar_path,country_code,created_at";
  const EMBED_PROFILE = "id,username,display_name,avatar_path";

  const range = (from, limit) => [from, from + limit - 1];

  // ---------------------------------------------------------------- API
  const api = {
    UserError,
    LIMITS,
    labels: {
      categories: CATEGORIES.map((c) => ({ slug: c[0], label: c[1] })),
      topics: TOPICS.map((t) => ({ slug: t[0], label: t[1] })),
      categoryToSlug, topicToSlug, slugToCategory, slugToTopic,
    },
    userMessage,

    configure({ url, publishableKey, options }) {
      if (!global.supabase || typeof global.supabase.createClient !== "function") {
        throw new UserError("Supabase لائبریری لوڈ نہیں ہوئی۔", "no_library");
      }
      if (!url || !publishableKey) throw new UserError("Supabase URL اور publishable key ضروری ہیں۔", "no_config");
      client = global.supabase.createClient(url, publishableKey, options || {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
      });
      client.auth.onAuthStateChange((_event, session) => { cachedSession = session; });
      return api;
    },
    isConfigured() { return !!client; },
    rawClient() { return requireClient(); },

    auth: {
      async sendPhoneCode(phone) {
        return unwrap(await requireClient().auth.signInWithOtp({ phone }));
      },
      async verifyPhoneCode(phone, token) {
        return unwrap(await requireClient().auth.verifyOtp({ phone, token, type: "sms" }));
      },
      async signInWithGoogle(redirectTo) {
        return unwrap(await requireClient().auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: redirectTo || global.location.origin + global.location.pathname },
        }));
      },
      async getSession() {
        const data = unwrap(await requireClient().auth.getSession());
        cachedSession = data.session;
        return data;
      },
      onChange(callback) {
        const { data } = requireClient().auth.onAuthStateChange((event, session) => {
          cachedSession = session;
          callback(event, session);
        });
        return () => data.subscription.unsubscribe();
      },
      async signOut() {
        const out = unwrap(await requireClient().auth.signOut());
        cachedSession = null;
        return out;
      },
      async deleteMyAccount() {
        const db = requireClient();
        const { data, error } = await db.functions.invoke("delete-account", { body: { confirm: "DELETE" } });
        if (error) {
          let reason = "";
          try { reason = (await error.context.json()).error || ""; } catch (_) { /* no body */ }
          const e = new Error(reason || error.message);
          e.code = reason;
          throw e;
        }
        await db.auth.signOut();
        cachedSession = null;
        return data;
      },
    },

    profiles: {
      async mine() {
        const user = await currentUser();
        return unwrap(await requireClient().from("profiles").select("*").eq("id", user.id).single());
      },
      async byId(id) {
        return unwrap(await requireClient().from("profiles").select(PROFILE_PUBLIC).eq("id", id).single());
      },
      async byIds(ids) {
        const list = Array.from(new Set((ids || []).filter(Boolean)));
        if (!list.length) return [];
        return unwrap(await requireClient().from("profiles").select(PROFILE_PUBLIC).in("id", list));
      },
      async byUsername(username) {
        return unwrap(await requireClient().from("profiles").select(PROFILE_PUBLIC)
          .eq("username", clean(username).toLowerCase()).single());
      },
      async stats(userId) {
        const rows = unwrap(await requireClient().rpc("profile_stats", { p_user_id: userId }));
        const row = Array.isArray(rows) ? rows[0] : rows;
        return {
          posts: Number(row && row.posts_count || 0),
          followers: Number(row && row.followers_count || 0),
          following: Number(row && row.following_count || 0),
        };
      },
      async update({ displayName, username, bio, countryCode, locale }) {
        const user = await currentUser();
        const patch = {};
        if (displayName !== undefined) patch.display_name = clean(displayName).trim();
        if (username !== undefined) patch.username = clean(username).trim().toLowerCase();
        if (bio !== undefined) patch.bio = clean(bio).trim();
        if (countryCode !== undefined) patch.country_code = countryCode;
        if (locale !== undefined) patch.locale = locale;
        if (patch.display_name !== undefined && (patch.display_name.length < 1 || patch.display_name.length > 80)) {
          throw new UserError("نام 1 سے 80 حروف کے درمیان ہونا چاہیے۔", "bad_name");
        }
        if (patch.username !== undefined && !/^[a-z0-9_]{3,24}$/.test(patch.username)) {
          throw new UserError("ہینڈل میں صرف انگریزی چھوٹے حروف، اعداد اور _ ہو سکتے ہیں (3 سے 24 حروف)۔", "bad_username");
        }
        if (patch.bio !== undefined && patch.bio.length > 300) throw new UserError("تعارف 300 حروف سے زیادہ نہیں ہو سکتا۔", "bad_bio");
        return unwrap(await requireClient().from("profiles").update(patch).eq("id", user.id).select().single());
      },
      avatarUrl(path) {
        if (!path) return null;
        return requireClient().storage.from("avatars").getPublicUrl(path).data.publicUrl;
      },
      async uploadAvatar(file) {
        const db = requireClient();
        const user = await currentUser();
        const before = unwrap(await db.from("profiles").select("avatar_path").eq("id", user.id).single());
        const path = await upload("avatars", file, IMAGE_TYPES, LIMITS.avatarBytes);
        let profile;
        try {
          profile = unwrap(await db.from("profiles").update({ avatar_path: path }).eq("id", user.id).select().single());
        } catch (e) {
          await removeObject("avatars", path);
          throw e;
        }
        if (before && before.avatar_path && before.avatar_path !== path) await removeObject("avatars", before.avatar_path);
        return { profile, publicUrl: api.profiles.avatarUrl(path) };
      },
      async removeAvatar() {
        const db = requireClient();
        const user = await currentUser();
        const before = unwrap(await db.from("profiles").select("avatar_path").eq("id", user.id).single());
        const profile = unwrap(await db.from("profiles").update({ avatar_path: null }).eq("id", user.id).select().single());
        if (before && before.avatar_path) await removeObject("avatars", before.avatar_path);
        return profile;
      },
      async badges(userId) {
        return unwrap(await requireClient().from("writer_badges").select("badge_type,reason,issued_at")
          .eq("user_id", userId).is("revoked_at", null).order("issued_at", { ascending: false }));
      },
      /** { userId: ['featured_writer', ...] } for a batch of authors (one query). */
      async badgesFor(userIds) {
        const list = Array.from(new Set((userIds || []).filter(Boolean)));
        const map = {};
        if (!list.length) return map;
        const rows = unwrap(await requireClient().from("writer_badges").select("user_id,badge_type")
          .in("user_id", list).is("revoked_at", null));
        rows.forEach((r) => { (map[r.user_id] = map[r.user_id] || []).push(r.badge_type); });
        return map;
      },
    },

    posts: {
      async feed({ limit = 20, from = 0, category, topic, authorId } = {}) {
        const [a, b] = range(from, limit);
        let query = requireClient().from("post_feed_cards").select(FEED_COLUMNS)
          .order("published_at", { ascending: false }).order("id", { ascending: false }).range(a, b);
        if (category) query = query.eq("category_slug", categoryToSlug(category));
        if (topic) query = query.eq("topic_slug", topicToSlug(topic));
        if (authorId) query = query.eq("author_id", authorId);
        return unwrap(await query);
      },
      async followingFeed({ limit = 20, from = 0, category } = {}) {
        await currentUser();
        return unwrap(await requireClient().rpc("following_feed", {
          p_category_slug: category ? categoryToSlug(category) : null, p_limit: limit, p_offset: from,
        }));
      },
      async saved({ limit = 30, from = 0 } = {}) {
        await currentUser();
        return unwrap(await requireClient().rpc("saved_posts", { p_limit: limit, p_offset: from }));
      },
      async search({ query = "", topic, category, limit = 20, offset = 0 } = {}) {
        return unwrap(await requireClient().rpc("search_posts", {
          p_query: clean(query).slice(0, 100),
          p_topic_slug: topic ? topicToSlug(topic) : null,
          p_category_slug: category ? categoryToSlug(category) : null,
          p_limit: limit,
          p_offset: offset,
        }));
      },
      async mine({ status = "published", limit = 30, from = 0 } = {}) {
        const user = await currentUser();
        const [a, b] = range(from, limit);
        return unwrap(await requireClient().from("posts")
          .select("id,author_id,title,body,category_slug,topic_slug,status,allow_support,cover_image_path,like_count,comment_count,published_at,created_at,updated_at")
          .eq("author_id", user.id).eq("status", status)
          .order("updated_at", { ascending: false }).range(a, b));
      },
      async drafts() { return api.posts.mine({ status: "draft", limit: 50 }); },
      /** Full post (with body) plus a flat author block; `status` lets the author see removed notices. */
      async get(postId) {
        const row = unwrap(await requireClient().from("posts").select(
          "id,author_id,title,body,category_slug,topic_slug,status,allow_support,cover_image_path,like_count,comment_count,published_at,created_at,updated_at," +
          "author:profiles!posts_author_id_fkey(id,username,display_name,avatar_path,bio)"
        ).eq("id", postId).single());
        const author = row.author || {};
        return Object.assign({}, row, {
          display_name: author.display_name || "", username: author.username || "", avatar_path: author.avatar_path || null,
        });
      },
      async saveDraft({ id, title, body, category, topic, allowSupport = true, coverImagePath }) {
        const user = await currentUser();
        const row = {
          title: clean(title).trim().slice(0, 160) || "بغیر عنوان",
          body: clean(body).slice(0, 100000),
          category_slug: categoryToSlug(category || "مضمون"),
          topic_slug: topicToSlug(topic || "ادب"),
          allow_support: !!allowSupport,
          cover_image_path: coverImagePath || null,
        };
        if (id) {
          return unwrap(await requireClient().from("posts").update(row)
            .eq("id", id).eq("author_id", user.id).eq("status", "draft").select("id,status,updated_at").single());
        }
        return unwrap(await requireClient().from("posts")
          .insert(Object.assign({ author_id: user.id, status: "draft" }, row)).select("id,status,updated_at").single());
      },
      async publish({ id, title, body, category, topic, allowSupport = true, coverImagePath }) {
        if (!clean(title).trim()) throw new UserError("تحریر کا عنوان ضروری ہے۔", "no_title");
        if (!clean(body).trim()) throw new UserError("تحریر خالی نہیں ہو سکتی۔", "no_body");
        if (clean(title).trim().length > 160) throw new UserError("عنوان 160 حروف سے لمبا نہیں ہو سکتا۔", "long_title");
        const user = await currentUser();
        const row = {
          title: clean(title).trim(),
          body: clean(body),
          category_slug: categoryToSlug(category || "مضمون"),
          topic_slug: topicToSlug(topic || "ادب"),
          status: "published",
          allow_support: !!allowSupport,
          cover_image_path: coverImagePath || null,
        };
        if (id) {
          return unwrap(await requireClient().from("posts").update(row)
            .eq("id", id).eq("author_id", user.id).select("id,status,published_at").single());
        }
        return unwrap(await requireClient().from("posts")
          .insert(Object.assign({ author_id: user.id }, row)).select("id,status,published_at").single());
      },
      async update(postId, patch) {
        const row = {};
        if (patch.title !== undefined) row.title = clean(patch.title).trim();
        if (patch.body !== undefined) row.body = clean(patch.body);
        if (patch.category !== undefined) row.category_slug = categoryToSlug(patch.category);
        if (patch.topic !== undefined) row.topic_slug = topicToSlug(patch.topic);
        if (patch.allowSupport !== undefined) row.allow_support = !!patch.allowSupport;
        if (patch.coverImagePath !== undefined) row.cover_image_path = patch.coverImagePath;
        if (patch.status !== undefined) row.status = patch.status;
        return unwrap(await requireClient().from("posts").update(row).eq("id", postId).select("id,status").single());
      },
      async remove(postId) {
        const { data } = await requireClient().from("posts").select("cover_image_path").eq("id", postId).maybeSingle();
        unwrap(await requireClient().from("posts").delete().eq("id", postId));
        if (data && data.cover_image_path) await removeObject("post-covers", data.cover_image_path);
        return true;
      },
      coverUrl(path) {
        if (!path) return null;
        return requireClient().storage.from("post-covers").getPublicUrl(path).data.publicUrl;
      },
      /** Best-effort removal of a cover that is no longer referenced (e.g. after it was replaced). */
      async discardCover(path) { await removeObject("post-covers", path); return true; },
      async uploadCover(file) {
        const path = await upload("post-covers", file, IMAGE_TYPES, LIMITS.coverBytes);
        return { path, publicUrl: api.posts.coverUrl(path) };
      },
    },

    social: {
      async myLikes(postIds) {
        const user = await currentUser();
        if (!Array.isArray(postIds) || !postIds.length) return [];
        return unwrap(await requireClient().from("post_likes").select("post_id")
          .eq("user_id", user.id).in("post_id", postIds)).map((r) => r.post_id);
      },
      async myBookmarkIds(postIds) {
        const user = await currentUser();
        if (!Array.isArray(postIds) || !postIds.length) return [];
        return unwrap(await requireClient().from("post_bookmarks").select("post_id")
          .eq("user_id", user.id).in("post_id", postIds)).map((r) => r.post_id);
      },
      async like(postId) {
        const user = await currentUser();
        const { error } = await requireClient().from("post_likes").insert({ post_id: postId, user_id: user.id });
        if (error && error.code !== "23505") throw error;     // already liked is success
        return true;
      },
      async unlike(postId) {
        const user = await currentUser();
        unwrap(await requireClient().from("post_likes").delete().eq("post_id", postId).eq("user_id", user.id));
        return true;
      },
      async bookmark(postId) {
        const user = await currentUser();
        const { error } = await requireClient().from("post_bookmarks").insert({ post_id: postId, user_id: user.id });
        if (error && error.code !== "23505") throw error;
        return true;
      },
      async unbookmark(postId) {
        const user = await currentUser();
        unwrap(await requireClient().from("post_bookmarks").delete().eq("post_id", postId).eq("user_id", user.id));
        return true;
      },
      async myFollowingIds() {
        const user = await currentUser();
        return unwrap(await requireClient().from("follows").select("following_id")
          .eq("follower_id", user.id).limit(5000)).map((r) => r.following_id);
      },
      async follow(userId) {
        const user = await currentUser();
        const { error } = await requireClient().from("follows").insert({ follower_id: user.id, following_id: userId });
        if (error && error.code !== "23505") throw error;
        return true;
      },
      async unfollow(userId) {
        const user = await currentUser();
        unwrap(await requireClient().from("follows").delete().eq("follower_id", user.id).eq("following_id", userId));
        return true;
      },
      async removeFollower(followerId) {
        const user = await currentUser();
        unwrap(await requireClient().from("follows").delete().eq("follower_id", followerId).eq("following_id", user.id));
        return true;
      },
      /** People who follow `userId`. */
      async followers(userId, { limit = 100, from = 0 } = {}) {
        const [a, b] = range(from, limit);
        const rows = unwrap(await requireClient().from("follows")
          .select("created_at,profile:profiles!follows_follower_id_fkey(" + EMBED_PROFILE + ",bio)")
          .eq("following_id", userId).order("created_at", { ascending: false }).range(a, b));
        return rows.map((r) => r.profile).filter(Boolean);
      },
      /** People `userId` follows. */
      async following(userId, { limit = 100, from = 0 } = {}) {
        const [a, b] = range(from, limit);
        const rows = unwrap(await requireClient().from("follows")
          .select("created_at,profile:profiles!follows_following_id_fkey(" + EMBED_PROFILE + ",bio)")
          .eq("follower_id", userId).order("created_at", { ascending: false }).range(a, b));
        return rows.map((r) => r.profile).filter(Boolean);
      },
      async block(userId) {
        const user = await currentUser();
        if (userId === user.id) throw new UserError("آپ خود کو بلاک نہیں کر سکتے۔", "self_block");
        const { error } = await requireClient().from("user_blocks").insert({ blocker_id: user.id, blocked_id: userId });
        if (error && error.code !== "23505") throw error;
        return true;
      },
      async unblock(userId) {
        const user = await currentUser();
        unwrap(await requireClient().from("user_blocks").delete().eq("blocker_id", user.id).eq("blocked_id", userId));
        return true;
      },
      async blockedUsers() {
        const user = await currentUser();
        const rows = unwrap(await requireClient().from("user_blocks")
          .select("created_at,profile:profiles!user_blocks_blocked_id_fkey(" + EMBED_PROFILE + ")")
          .eq("blocker_id", user.id).order("created_at", { ascending: false }));
        return rows.map((r) => r.profile).filter(Boolean);
      },
      async report({ targetType, postId, commentId, reportedUserId, reason, details = "" }) {
        const user = await currentUser();
        unwrap(await requireClient().from("content_reports").insert({
          reporter_id: user.id,
          target_type: targetType,
          post_id: postId || null,
          comment_id: commentId || null,
          reported_user_id: reportedUserId || null,
          reason,
          details: clean(details).slice(0, 2000),
        }));
        return true;
      },
    },

    comments: {
      async list(postId, { limit = 100, from = 0 } = {}) {
        const [a, b] = range(from, limit);
        return unwrap(await requireClient().from("comments")
          .select("id,post_id,author_id,parent_id,body,created_at,author:profiles!comments_author_id_fkey(" + EMBED_PROFILE + ")")
          .eq("post_id", postId).eq("status", "visible")
          .order("created_at", { ascending: true }).range(a, b));
      },
      async add({ postId, body, parentId = null }) {
        const user = await currentUser();
        const text = clean(body).trim();
        if (!text) throw new UserError("تبصرہ خالی نہیں ہو سکتا۔", "no_body");
        if (text.length > 5000) throw new UserError("تبصرہ 5000 حروف سے لمبا نہیں ہو سکتا۔", "long_body");
        return unwrap(await requireClient().from("comments").insert({
          post_id: postId, author_id: user.id, body: text, parent_id: parentId,
        }).select("id,post_id,author_id,parent_id,body,created_at").single());
      },
      async remove(commentId) {
        unwrap(await requireClient().from("comments").delete().eq("id", commentId));
        return true;
      },
    },

    notifications: {
      async list({ limit = 40, from = 0 } = {}) {
        const user = await currentUser();
        const [a, b] = range(from, limit);
        return unwrap(await requireClient().from("notifications")
          .select("id,event_type,post_id,comment_id,support_claim_id,ticket_id,read_at,created_at," +
            "actor:profiles!notifications_actor_id_fkey(" + EMBED_PROFILE + ")," +
            "post:posts!notifications_post_id_fkey(id,title)")
          .eq("recipient_id", user.id).order("created_at", { ascending: false }).range(a, b));
      },
      async unreadCount() {
        const user = await currentUser();
        const { count, error } = await requireClient().from("notifications")
          .select("id", { count: "exact", head: true }).eq("recipient_id", user.id).is("read_at", null);
        if (error) throw error;
        return count || 0;
      },
      async markRead(notificationId) {
        unwrap(await requireClient().from("notifications")
          .update({ read_at: new Date().toISOString() }).eq("id", notificationId).is("read_at", null));
        return true;
      },
      async markAllRead() {
        const user = await currentUser();
        unwrap(await requireClient().from("notifications")
          .update({ read_at: new Date().toISOString() }).eq("recipient_id", user.id).is("read_at", null));
        return true;
      },
    },

    feedback: {
      async submit({ type, message, attachmentPath }) {
        const user = await currentUser();
        const text = clean(message).trim();
        if (text.length < 5) throw new UserError("پیغام کم از کم 5 حروف کا ہونا چاہیے۔", "short_message");
        return unwrap(await requireClient().from("feedback_tickets").insert({
          user_id: user.id,
          feedback_type: type || "question",
          message: text.slice(0, 5000),
          attachment_path: attachmentPath || null,
        }).select("id,ticket_number,status,created_at").single());
      },
      async uploadAttachment(file) { return upload("feedback-attachments", file, DOC_TYPES, LIMITS.attachmentBytes); },
      async mine() {
        const user = await currentUser();
        return unwrap(await requireClient().from("feedback_tickets")
          .select("id,ticket_number,feedback_type,message,status,staff_reply,created_at,updated_at")
          .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50));
      },
    },

    ticketMessages: {
      async list(ticketId) {
        await currentUser();
        return unwrap(await requireClient().from("feedback_ticket_messages")
          .select("id,ticket_id,author_id,message,is_internal,created_at")
          .eq("ticket_id", ticketId).eq("is_internal", false).order("created_at", { ascending: true }));
      },
      async add({ ticketId, message }) {
        const user = await currentUser();
        const text = clean(message).trim();
        if (!text) throw new UserError("پیغام خالی نہیں ہو سکتا۔", "no_body");
        return unwrap(await requireClient().from("feedback_ticket_messages").insert({
          ticket_id: ticketId, author_id: user.id, message: text.slice(0, 4000), is_internal: false,
        }).select().single());
      },
    },

    writerSupport: {
      async publicOptions(creatorId) {
        return unwrap(await requireClient().from("writer_payment_options").select(
          "id,creator_id,method,display_label,bank_name,account_title,account_identifier,qr_object_path,sort_order"
        ).eq("creator_id", creatorId).eq("is_public", true).eq("is_active", true).order("sort_order", { ascending: true }));
      },
      async myOptions() {
        const user = await currentUser();
        return unwrap(await requireClient().from("writer_payment_options").select("*")
          .eq("creator_id", user.id).order("sort_order", { ascending: true }));
      },
      async uploadQr(file) { return upload("writer-payment-qr", file, IMAGE_TYPES, LIMITS.qrBytes); },
      /** Create or update the writer's single option for `method`. Not public until `isPublic` is true. */
      async saveOption(option) {
        const db = requireClient();
        const user = await currentUser();
        const row = {
          method: option.method,
          display_label: clean(option.displayLabel).slice(0, 80),
          bank_name: option.bankName || null,
          account_title: option.accountTitle || null,
          account_identifier: option.accountIdentifier || null,
          qr_object_path: option.qrObjectPath || null,
          is_public: option.isPublic === true,
          is_active: option.isActive === true,
          sort_order: option.sortOrder || 0,
        };
        const existing = unwrap(await db.from("writer_payment_options").select("id,qr_object_path")
          .eq("creator_id", user.id).eq("method", row.method).maybeSingle());
        if (existing) {
          const saved = unwrap(await db.from("writer_payment_options").update(row)
            .eq("id", existing.id).eq("creator_id", user.id).select().single());
          if (existing.qr_object_path && existing.qr_object_path !== row.qr_object_path) {
            await removeObject("writer-payment-qr", existing.qr_object_path);
          }
          return saved;
        }
        return unwrap(await db.from("writer_payment_options").insert(Object.assign({ creator_id: user.id }, row)).select().single());
      },
      async removeOption(method) {
        const db = requireClient();
        const user = await currentUser();
        const existing = unwrap(await db.from("writer_payment_options").select("id,qr_object_path")
          .eq("creator_id", user.id).eq("method", method).maybeSingle());
        if (!existing) return true;
        unwrap(await db.from("writer_payment_options").delete().eq("id", existing.id).eq("creator_id", user.id));
        await removeObject("writer-payment-qr", existing.qr_object_path);
        return true;
      },
      async createTransferClaim({ creatorId, paymentOptionId, amount, note = "" }) {
        const user = await currentUser();
        const value = Number(amount);
        if (!Number.isFinite(value) || value < 10 || value > 1000000) {
          throw new UserError("رقم 10 سے 10,00,000 روپے کے درمیان ہونی چاہیے۔", "bad_amount");
        }
        return unwrap(await requireClient().from("writer_support_claims").insert({
          sender_id: user.id, creator_id: creatorId, payment_option_id: paymentOptionId,
          amount: value, sender_note: clean(note).slice(0, 500),
        }).select().single());
      },
      async acknowledgeReceived(claimId) {
        const user = await currentUser();
        return unwrap(await requireClient().from("writer_support_claims").update({ status: "creator_acknowledged" })
          .eq("id", claimId).eq("creator_id", user.id).eq("status", "sender_reported_sent").select().single());
      },
      async cancelClaim(claimId) {
        const user = await currentUser();
        return unwrap(await requireClient().from("writer_support_claims").update({ status: "cancelled" })
          .eq("id", claimId).eq("sender_id", user.id).eq("status", "sender_reported_sent").select().single());
      },
      async history() {
        const user = await currentUser();
        return unwrap(await requireClient().from("writer_support_claims")
          .select("id,sender_id,creator_id,amount,currency,sender_note,status,created_at," +
            "sender:profiles!writer_support_claims_sender_id_fkey(" + EMBED_PROFILE + ")," +
            "creator:profiles!writer_support_claims_creator_id_fkey(" + EMBED_PROFILE + ")")
          .or("sender_id.eq." + user.id + ",creator_id.eq." + user.id)
          .order("created_at", { ascending: false }).limit(200));
      },
      async qrUrl(path, expiresInSeconds = 900) {
        const { data, error } = await requireClient().storage.from("writer-payment-qr").createSignedUrl(path, expiresInSeconds);
        if (error) throw error;
        return data.signedUrl;
      },
    },

    onboarding: {
      async myInterests() {
        const user = await currentUser();
        return unwrap(await requireClient().from("user_interests").select("topic_slug").eq("user_id", user.id))
          .map((r) => r.topic_slug);
      },
      async saveInterests(topicSlugs) {
        await currentUser();
        return unwrap(await requireClient().rpc("replace_my_interests", { p_topic_slugs: topicSlugs }));
      },
      async surveyDone() {
        const user = await currentUser();
        const row = unwrap(await requireClient().from("onboarding_surveys").select("user_id").eq("user_id", user.id).maybeSingle());
        return !!row;
      },
      async submitAcquisitionSource(source, otherText = "") {
        const user = await currentUser();
        return unwrap(await requireClient().from("onboarding_surveys").insert({
          user_id: user.id, source, other_text: source === "other" ? clean(otherText).slice(0, 200) : "",
        }).select().single());
      },
    },

    team: {
      async apply({ area, skills = "", availability = "", motivation, countryCode = null, attachmentPath = null }) {
        const user = await currentUser();
        const why = clean(motivation).trim();
        if (why.length < 20) throw new UserError("اپنے بارے میں کم از کم 20 حروف لکھیں۔", "short_motivation");
        return unwrap(await requireClient().from("volunteer_applications").insert({
          applicant_id: user.id, team_area: area, skills: clean(skills).slice(0, 1500),
          availability: clean(availability).slice(0, 300), motivation: why.slice(0, 3000),
          country_code: countryCode, attachment_path: attachmentPath,
        }).select().single());
      },
      async mine() {
        const user = await currentUser();
        return unwrap(await requireClient().from("volunteer_applications")
          .select("id,team_area,status,staff_note,created_at,updated_at")
          .eq("applicant_id", user.id).order("created_at", { ascending: false }));
      },
      async uploadAttachment(file) { return upload("team-applications", file, DOC_TYPES, LIMITS.attachmentBytes); },
    },

    badges: {
      async apply({ badgeType, portfolioNote = "" }) {
        const user = await currentUser();
        return unwrap(await requireClient().from("badge_applications").insert({
          user_id: user.id, badge_type: badgeType, portfolio_note: clean(portfolioNote).slice(0, 2000),
        }).select().single());
      },
      async mine() {
        const user = await currentUser();
        return unwrap(await requireClient().from("badge_applications")
          .select("id,badge_type,status,staff_note,created_at,updated_at")
          .eq("user_id", user.id).order("created_at", { ascending: false }));
      },
      async active(userId) { return api.profiles.badges(userId); },
    },

    platformDonations: {
      async accounts() {
        return unwrap(await requireClient().from("platform_donation_accounts")
          .select("id,method,label,bank_name,account_title,account_identifier,instructions,sort_order")
          .eq("is_active", true).order("sort_order", { ascending: true }));
      },
      async submit({ amount, method, transactionReference = "", note = "" }) {
        const user = await currentUser();
        const value = Number(amount);
        if (!Number.isFinite(value) || value < 100 || value > 5000000) {
          throw new UserError("رقم 100 سے 50,00,000 روپے کے درمیان ہونی چاہیے۔", "bad_amount");
        }
        const profile = unwrap(await requireClient().from("profiles").select("country_code").eq("id", user.id).single());
        if (profile.country_code !== "PK") {
          throw new UserError("فی الحال پلیٹ فارم معاونت صرف پاکستان کے لیے دستیاب ہے۔", "country_not_supported");
        }
        return unwrap(await requireClient().from("platform_donation_intents").insert({
          donor_id: user.id, claimed_country_code: "PK", amount: value, currency: "PKR", method,
          transaction_reference: clean(transactionReference).slice(0, 120), donor_note: clean(note).slice(0, 1000),
        }).select().single());
      },
      async mine() {
        const user = await currentUser();
        return unwrap(await requireClient().from("platform_donation_intents")
          .select("id,amount,currency,method,status,created_at,staff_note")
          .eq("donor_id", user.id).order("created_at", { ascending: false }));
      },
    },

    push: {
      /** Registers (or re-assigns) this device's token to the signed-in user. */
      async register({ token, platform, deviceLabel = "" }) {
        await currentUser();
        if (!token || !["android", "ios", "web"].includes(platform)) {
          throw new UserError("درست push token اور platform ضروری ہیں۔", "bad_push");
        }
        return unwrap(await requireClient().rpc("register_push_device", {
          p_token: token, p_platform: platform, p_label: deviceLabel,
        }));
      },
      async unregister(token) {
        await currentUser();
        return unwrap(await requireClient().rpc("unregister_push_device", { p_token: token }));
      },
    },

    admin: {
      async isStaff() { await currentUser(); return unwrap(await requireClient().rpc("is_staff")); },
      async dispatchPush(limit = 50) { return unwrap(await requireClient().functions.invoke("push-dispatch", { body: { limit } })); },
      async setUserRole({ userId, role, operation = "grant" }) {
        return unwrap(await requireClient().rpc("manage_user_role", { p_user_id: userId, p_role: role, p_operation: operation }));
      },
      async reviewBadge({ applicationId, decision, staffNote = "" }) {
        return unwrap(await requireClient().rpc("review_badge_application", {
          p_application_id: applicationId, p_decision: decision, p_staff_note: staffNote,
        }));
      },
    },
  };

  ["auth", "profiles", "posts", "social", "comments", "notifications", "feedback", "ticketMessages",
    "writerSupport", "onboarding", "team", "badges", "platformDonations", "push", "admin"]
    .forEach((name) => wrapGroup(name, api[name]));

  global.HLBackend = api;
})(window);
