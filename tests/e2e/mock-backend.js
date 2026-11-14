/* In-memory stand-in for the Supabase-backed groups of window.HLBackend. It is appended AFTER the real
 * adapter (labels, userMessage, error classes stay real) so the frontend is exercised exactly as in production,
 * minus the network. Rows use the same snake_case shapes the real adapter returns.
 * Test hooks: window.__mock = { calls, state, failNext(name, message) }. */
(function () {
  const B = window.HLBackend;
  const cfg = window.__mockConfig || {};
  const delay = (ms) => new Promise((r) => setTimeout(r, ms == null ? 4 : ms));
  const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  let seq = 1000;
  const newId = () => id(++seq);

  const ME = id(1);
  const profiles = {
    [ME]: { id: ME, username: "imran_ahmad", display_name: "عمران احمد", bio: "", avatar_path: null, country_code: "PK", created_at: iso(9999), is_active: true },
    [id(2)]: { id: id(2), username: "sara_khan", display_name: "سارہ خان", bio: "کہانیاں اور روزمرہ زندگی پر لکھتی ہوں۔", avatar_path: null, country_code: "PK", created_at: iso(9000), is_active: true },
    [id(3)]: { id: id(3), username: "muhammad_ali", display_name: "محمد علی", bio: "کالم نگار۔", avatar_path: null, country_code: "PK", created_at: iso(8000), is_active: true },
    [id(4)]: { id: id(4), username: "ayesha_malik", display_name: "عائشہ ملک", bio: "", avatar_path: null, country_code: "PK", created_at: iso(7000), is_active: true },
  };
  const post = (n, author, title, body, cat, topic, mins, extra) => Object.assign({ id: id(100 + n), author_id: author, title, body, category_slug: cat, topic_slug: topic, status: "published", allow_support: true, cover_image_path: null, like_count: 0, comment_count: 0, published_at: iso(mins), created_at: iso(mins), updated_at: iso(mins) }, extra || {});
  const posts = [
    post(1, id(2), "زندگی کی خوبصورتی", "زندگی چھوٹی ہے، اسے **خوشیوں** میں گزاریں۔\nچھوٹی چھوٹی باتوں میں خوشی تلاش کرنا ایک ہنر ہے۔", "column", "life", 180, { like_count: 2800 }),
    post(2, id(3), "خوش رہنے کے آسان طریقے", "خوشی بڑے فیصلوں سے کم اور روزمرہ عادتوں سے زیادہ آتی ہے۔", "column", "life", 120),
    post(3, id(4), "جدید دور میں کتابوں کی اہمیت", "کتاب آج بھی سوچنے کا سب سے پرسکون ذریعہ ہے۔", "essay", "literature", 60),
    post(4, id(2), "شام کے دیے", "شام ڈھلتے ہی دیے دل میں جلا لیتا ہوں\nمیں اندھیروں سے بھی رشتہ سا نبھا لیتا ہوں\nلفظ میرے ہیں مگر درد زمانے کا ہے\nہر غزل میں کوئی چہرہ سا چھپا لیتا ہوں", "poetry", "love", 1500),
    post(5, ME, "پاکستان کا مستقبل اور نوجوان", "ہم ایک ایسے دور میں ہیں جہاں نوجوانوں کے پاس بے پناہ صلاحیتیں ہیں۔\n> تعلیم، ہنر اور اعتماد", "essay", "society", 240, { like_count: 4500 }),
    post(6, id(3), "<img src=x onerror=\"window.__xss=1\">خطرناک عنوان", "متن <script>window.__xss=2</script> **موٹا** *ترچھا*", "essay", "technology", 30),
  ];
  const comments = [{ id: id(300), post_id: id(101), author_id: id(3), parent_id: null, body: "بہت عمدہ تحریر۔", created_at: iso(50), status: "visible" }];
  const likes = new Set(), bookmarks = new Set(), follows = new Set([id(2)]), blocks = new Set();
  let interests = cfg.signedIn ? ["life"] : [], surveyDone = !!cfg.signedIn;
  const notifications = [
    { id: id(400), event_type: "post_like", post_id: id(105), comment_id: null, support_claim_id: null, ticket_id: null, read_at: null, created_at: iso(5), actor: { id: id(2), username: "sara_khan", display_name: "سارہ خان", avatar_path: null }, post: { id: id(105), title: "پاکستان کا مستقبل اور نوجوان" } },
    { id: id(401), event_type: "new_follower", post_id: null, comment_id: null, support_claim_id: null, ticket_id: null, read_at: null, created_at: iso(120), actor: { id: id(4), username: "ayesha_malik", display_name: "عائشہ ملک", avatar_path: null }, post: null },
    { id: id(402), event_type: "system", post_id: null, comment_id: null, support_claim_id: null, ticket_id: null, read_at: iso(300), created_at: iso(400), actor: null, post: null },
  ];
  const tickets = [], ticketMsgs = [], claims = [], teamApps = [], badgeApps = [], platformIntents = [];
  const payOptions = { [id(2)]: [
    { id: id(500), creator_id: id(2), method: "jazzcash", display_label: "جاز کیش", bank_name: null, account_title: null, account_identifier: null, qr_object_path: id(2) + "/qr1.png", sort_order: 0, is_public: true, is_active: true },
    { id: id(501), creator_id: id(2), method: "bank_transfer", display_label: "بینک", bank_name: "نمونہ بینک", account_title: "سارہ خان", account_identifier: "PK00DEMO0000000000000001", qr_object_path: null, sort_order: 1, is_public: true, is_active: true },
  ] };
  const myOptions = [];
  const platformAccounts = [{ id: id(600), method: "bank_transfer", label: "ہم لکھاری — بینک", bank_name: "نمونہ بینک", account_title: "Hum Likhari", account_identifier: "PK00DEMO0000000000009999", instructions: "رقم بھیجنے کے بعد اطلاع درج کریں۔", sort_order: 0 }];
  let session = cfg.signedIn ? { user: { id: ME } } : null;
  let authListener = null;

  const state = { posts, comments, likes, bookmarks, follows, blocks, notifications, tickets, claims, profiles, myOptions, platformIntents, teamApps, badgeApps };
  const calls = [];
  const failures = {};
  window.__mock = { calls, state, failNext(name, message, code) { failures[name] = { message, code }; }, setOffline: null };

  function guard(name, fn) {
    return async function () {
      calls.push([name, Array.from(arguments)]);
      await delay(cfg.latency);
      if (failures[name]) {
        const f = failures[name]; delete failures[name];
        const e = new Error(f.message || "boom"); e.code = f.code || ""; e.userMessage = f.message || "کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔"; throw e;
      }
      return fn.apply(null, arguments);
    };
  }
  function group(name, methods) {
    const out = {};
    Object.keys(methods).forEach((k) => { out[k] = guard(name + "." + k, methods[k]); });
    return out;
  }
  const need = () => { if (!session) { const e = new Error("auth"); e.userMessage = "اس کارروائی کے لیے سائن اِن ضروری ہے۔"; throw e; } };
  const prof = (uid) => profiles[uid];
  const card = (p) => { const a = prof(p.author_id); return { id: p.id, author_id: p.author_id, title: p.title, excerpt: p.body.slice(0, 400), category_slug: p.category_slug, topic_slug: p.topic_slug, allow_support: p.allow_support, cover_image_path: p.cover_image_path, published_at: p.published_at, created_at: p.created_at, updated_at: p.updated_at, display_name: a.display_name, username: a.username, avatar_path: a.avatar_path, like_count: p.like_count, comment_count: p.comment_count }; };
  const visible = () => posts.filter((p) => p.status === "published" && !blocks.has(p.author_id)).sort((a, b) => b.published_at.localeCompare(a.published_at));
  const page = (rows, from, limit) => rows.slice(from, from + limit);
  const pub = (u) => ({ id: u.id, username: u.username, display_name: u.display_name, avatar_path: u.avatar_path, bio: u.bio });

  const api = {
    auth: group("auth", {
      sendPhoneCode: async (phone) => { if (!/^\+923\d{9}$/.test(phone)) throw new Error("bad phone"); return {}; },
      verifyPhoneCode: async (phone, token) => {
        if (token !== "123456") { const e = new Error("Token has expired or is invalid"); e.userMessage = "کوڈ غلط ہے یا اس کی مدت ختم ہو چکی ہے۔"; throw e; }
        session = { user: { id: ME } }; if (authListener) authListener("SIGNED_IN", session); return { session };
      },
      signInWithGoogle: async () => ({}),
      getSession: async () => ({ session }),
      onChange: (cb) => { authListener = cb; return () => {}; },
      signOut: async () => { session = null; if (authListener) authListener("SIGNED_OUT", null); },
      deleteMyAccount: async () => { if (cfg.deleteNeedsRecentLogin && !window.__recent) { const e = new Error("recent_login_required"); e.code = "recent_login_required"; throw e; } session = null; },
    }),
    profiles: group("profiles", {
      mine: async () => { need(); return Object.assign({}, prof(ME)); },
      byId: async (uid) => { const u = prof(uid); if (!u) { const e = new Error("none"); e.code = "PGRST116"; throw e; } return pub(u); },
      byUsername: async (un) => { const u = Object.values(profiles).find((x) => x.username === un); if (!u) { const e = new Error("none"); e.code = "PGRST116"; throw e; } return pub(u); },
      stats: async (uid) => ({ posts: posts.filter((p) => p.author_id === uid && p.status === "published").length, followers: uid === id(2) ? 8400 : 12, following: uid === ME ? follows.size : 4 }),
      update: async (patch) => {
        need();
        if (patch.username && Object.values(profiles).some((u) => u.id !== ME && u.username === patch.username)) { const e = new Error("duplicate key value violates unique constraint username"); e.code = "23505"; e.userMessage = "یہ ہینڈل پہلے سے کسی اور کے پاس ہے۔ کوئی اور چنیں۔"; throw e; }
        const u = prof(ME);
        if (patch.displayName !== undefined) u.display_name = patch.displayName;
        if (patch.username !== undefined) u.username = patch.username;
        if (patch.bio !== undefined) u.bio = patch.bio;
        if (patch.countryCode !== undefined) u.country_code = patch.countryCode;
        return Object.assign({}, u);
      },
      uploadAvatar: async (file) => { const u = prof(ME); u.avatar_path = ME + "/avatar.jpg"; return { profile: Object.assign({}, u), publicUrl: "x" }; },
      removeAvatar: async () => { const u = prof(ME); u.avatar_path = null; return Object.assign({}, u); },
      badges: async (uid) => (uid === id(2) ? [{ badge_type: "featured_writer", reason: "", issued_at: iso(10) }] : []),
      avatarUrl: B.profiles.avatarUrl, byIds: async () => [], badgesFor: async () => ({}),
    }),
    posts: group("posts", {
      feed: async ({ limit = 20, from = 0, category, authorId } = {}) => {
        if (cfg.feedFails && !window.__feedOk) { const e = new Error("net"); e.userMessage = "انٹرنیٹ سے رابطہ نہیں ہو رہا۔ کنکشن چیک کر کے دوبارہ کوشش کریں۔"; throw e; }
        let rows = visible();
        if (category) rows = rows.filter((p) => p.category_slug === B.labels.categoryToSlug(category));
        if (authorId) rows = rows.filter((p) => p.author_id === authorId);
        return page(rows, from, limit).map(card);
      },
      followingFeed: async ({ limit = 20, from = 0 } = {}) => { need(); return page(visible().filter((p) => follows.has(p.author_id)), from, limit).map(card); },
      saved: async ({ limit = 30, from = 0 } = {}) => { need(); return page(visible().filter((p) => bookmarks.has(p.id)), from, limit).map(card); },
      search: async ({ query = "", topic, category, limit = 20, offset = 0 } = {}) => {
        let rows = visible();
        if (topic) rows = rows.filter((p) => p.topic_slug === B.labels.topicToSlug(topic));
        if (category) rows = rows.filter((p) => p.category_slug === B.labels.categoryToSlug(category));
        const q = query.trim();
        if (q) rows = rows.filter((p) => p.title.includes(q) || prof(p.author_id).display_name.includes(q) || p.body.includes(q));
        return page(rows, offset, limit).map(card);
      },
      mine: async ({ status = "published", limit = 30, from = 0 } = {}) => { need(); return page(posts.filter((p) => p.author_id === ME && p.status === status).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), from, limit).map((p) => Object.assign({}, p)); },
      drafts: async () => { need(); return posts.filter((p) => p.author_id === ME && p.status === "draft").map((p) => Object.assign({}, p)); },
      get: async (pid) => {
        const p = posts.find((x) => x.id === pid);
        if (!p || (p.status !== "published" && p.author_id !== ME) || blocks.has(p.author_id)) { const e = new Error("none"); e.code = "PGRST116"; throw e; }
        const a = prof(p.author_id);
        return Object.assign({}, p, { author: pub(a), display_name: a.display_name, username: a.username, avatar_path: a.avatar_path });
      },
      saveDraft: async ({ id: pid, title, body, category, topic, allowSupport, coverImagePath }) => {
        need();
        const row = { title: title.trim() || "بغیر عنوان", body, category_slug: B.labels.categoryToSlug(category), topic_slug: B.labels.topicToSlug(topic), allow_support: allowSupport, cover_image_path: coverImagePath || null, updated_at: iso(0) };
        if (pid) { const p = posts.find((x) => x.id === pid && x.author_id === ME && x.status === "draft"); if (!p) { const e = new Error("none"); e.code = "PGRST116"; throw e; } Object.assign(p, row); return { id: p.id, status: p.status, updated_at: p.updated_at }; }
        const p = Object.assign({ id: newId(), author_id: ME, status: "draft", like_count: 0, comment_count: 0, published_at: null, created_at: iso(0) }, row); posts.push(p); return { id: p.id, status: "draft", updated_at: p.updated_at };
      },
      publish: async ({ id: pid, title, body, category, topic, allowSupport, coverImagePath }) => {
        need();
        const row = { title: title.trim(), body, category_slug: B.labels.categoryToSlug(category), topic_slug: B.labels.topicToSlug(topic), allow_support: allowSupport, cover_image_path: coverImagePath || null, status: "published", updated_at: iso(0) };
        let p = pid && posts.find((x) => x.id === pid && x.author_id === ME);
        if (p) { Object.assign(p, row); if (!p.published_at) p.published_at = iso(0); }
        else { p = Object.assign({ id: newId(), author_id: ME, like_count: 0, comment_count: 0, published_at: iso(0), created_at: iso(0) }, row); posts.push(p); }
        return { id: p.id, status: "published", published_at: p.published_at };
      },
      remove: async (pid) => { need(); const i = posts.findIndex((p) => p.id === pid && p.author_id === ME); if (i >= 0) posts.splice(i, 1); return true; },
      coverUrl: B.posts.coverUrl, discardCover: async () => true,
      uploadCover: async () => ({ path: ME + "/cover.jpg", publicUrl: "x" }),
    }),
    social: group("social", {
      myLikes: async (ids) => ids.filter((x) => likes.has(x)), myBookmarkIds: async (ids) => ids.filter((x) => bookmarks.has(x)),
      like: async (pid) => { need(); if (!likes.has(pid)) { likes.add(pid); posts.find((p) => p.id === pid).like_count++; } return true; },
      unlike: async (pid) => { need(); if (likes.delete(pid)) posts.find((p) => p.id === pid).like_count--; return true; },
      bookmark: async (pid) => { need(); bookmarks.add(pid); return true; }, unbookmark: async (pid) => { need(); bookmarks.delete(pid); return true; },
      myFollowingIds: async () => Array.from(follows),
      follow: async (uid) => { need(); follows.add(uid); return true; }, unfollow: async (uid) => { need(); follows.delete(uid); return true; },
      removeFollower: async () => true,
      followers: async (uid) => Object.values(profiles).filter((u) => u.id !== uid).slice(0, 3).map(pub),
      following: async (uid) => Array.from(follows).map((x) => pub(prof(x))),
      block: async (uid) => { need(); blocks.add(uid); follows.delete(uid); return true; }, unblock: async (uid) => { need(); blocks.delete(uid); return true; },
      blockedUsers: async () => Array.from(blocks).map((x) => pub(prof(x))),
      report: async (r) => { need(); if (r.reportedUserId === ME) { const e = new Error("cannot_report_own_content"); e.userMessage = "آپ اپنی ہی تحریر یا تبصرہ رپورٹ نہیں کر سکتے۔"; throw e; } window.__reports = (window.__reports || []).concat([r]); return true; },
    }),
    comments: group("comments", {
      list: async (pid) => comments.filter((c) => c.post_id === pid && c.status === "visible").map((c) => Object.assign({}, c, { author: pub(prof(c.author_id)) })),
      add: async ({ postId, body, parentId }) => { need(); const c = { id: newId(), post_id: postId, author_id: ME, parent_id: parentId || null, body, created_at: iso(0), status: "visible" }; comments.push(c); posts.find((p) => p.id === postId).comment_count++; return Object.assign({}, c); },
      remove: async (cid) => { need(); const gone = new Set([cid]); let grew = true; while (grew) { grew = false; comments.forEach((c) => { if (c.parent_id && gone.has(c.parent_id) && !gone.has(c.id)) { gone.add(c.id); grew = true; } }); } for (let i = comments.length - 1; i >= 0; i--) if (gone.has(comments[i].id)) comments.splice(i, 1); return true; },
    }),
    notifications: group("notifications", {
      list: async ({ limit = 40, from = 0 } = {}) => { need(); return page(notifications, from, limit).map((n) => Object.assign({}, n)); },
      unreadCount: async () => notifications.filter((n) => !n.read_at).length,
      markRead: async (nid) => { const n = notifications.find((x) => x.id === nid); if (n) n.read_at = iso(0); return true; },
      markAllRead: async () => { notifications.forEach((n) => { n.read_at = n.read_at || iso(0); }); return true; },
    }),
    feedback: group("feedback", {
      submit: async ({ type, message }) => { need(); const t = { id: newId(), ticket_number: tickets.length + 101, feedback_type: type, message, status: "received", staff_reply: null, created_at: iso(0), updated_at: iso(0) }; tickets.unshift(t); return { id: t.id, ticket_number: t.ticket_number, status: t.status, created_at: t.created_at }; },
      uploadAttachment: async () => ME + "/att.png", mine: async () => { need(); return tickets.map((t) => Object.assign({}, t)); },
    }),
    ticketMessages: group("ticketMessages", {
      list: async (tid) => ticketMsgs.filter((m) => m.ticket_id === tid),
      add: async ({ ticketId, message }) => { need(); const m = { id: newId(), ticket_id: ticketId, author_id: ME, message, is_internal: false, created_at: iso(0) }; ticketMsgs.push(m); return m; },
    }),
    writerSupport: group("writerSupport", {
      publicOptions: async (cid) => (payOptions[cid] || []).map((o) => Object.assign({}, o)),
      myOptions: async () => { need(); return myOptions.map((o) => Object.assign({}, o)); },
      uploadQr: async () => ME + "/qr.png",
      saveOption: async (o) => { need(); const i = myOptions.findIndex((x) => x.method === o.method); const row = { id: i >= 0 ? myOptions[i].id : newId(), creator_id: ME, method: o.method, display_label: o.displayLabel, bank_name: o.bankName || null, account_title: o.accountTitle || null, account_identifier: o.accountIdentifier || null, qr_object_path: o.qrObjectPath || null, is_public: o.isPublic, is_active: o.isActive, sort_order: 0 }; if (i >= 0) myOptions[i] = row; else myOptions.push(row); return row; },
      removeOption: async (m) => { const i = myOptions.findIndex((x) => x.method === m); if (i >= 0) myOptions.splice(i, 1); return true; },
      createTransferClaim: async ({ creatorId, paymentOptionId, amount, note }) => { need(); if (amount < 10) throw new Error("bad amount"); const c = { id: newId(), sender_id: ME, creator_id: creatorId, amount, currency: "PKR", sender_note: note || "", status: "sender_reported_sent", created_at: iso(0), payment_option_id: paymentOptionId }; claims.push(c); return c; },
      acknowledgeReceived: async (cid) => { const c = claims.find((x) => x.id === cid); c.status = "creator_acknowledged"; return c; },
      cancelClaim: async (cid) => { const c = claims.find((x) => x.id === cid); c.status = "cancelled"; return c; },
      history: async () => { need(); return claims.map((c) => Object.assign({}, c, { sender: pub(prof(c.sender_id)), creator: pub(prof(c.creator_id)) })); },
      qrUrl: async (p) => "https://example.supabase.co/signed/" + p,
    }),
    onboarding: group("onboarding", {
      myInterests: async () => interests.slice(), saveInterests: async (slugs) => { interests = slugs.slice(); return true; },
      surveyDone: async () => surveyDone, submitAcquisitionSource: async () => { surveyDone = true; return {}; },
    }),
    team: group("team", {
      apply: async (a) => { need(); const x = { id: newId(), team_area: a.area, status: "received", staff_note: null, created_at: iso(0), updated_at: iso(0) }; teamApps.push(x); return x; },
      mine: async () => teamApps.slice(), uploadAttachment: async () => ME + "/a.pdf",
    }),
    badges: group("badges", {
      apply: async ({ badgeType }) => { need(); const x = { id: newId(), badge_type: badgeType, status: "received", staff_note: null, created_at: iso(0), updated_at: iso(0) }; badgeApps.push(x); return x; },
      mine: async () => badgeApps.slice(), active: async () => [],
    }),
    platformDonations: group("platformDonations", {
      accounts: async () => platformAccounts.slice(),
      submit: async (d) => { need(); if (prof(ME).country_code !== "PK") throw new Error("country"); const x = { id: newId(), amount: d.amount, currency: "PKR", method: d.method, status: "submitted", created_at: iso(0), staff_note: null }; platformIntents.push(x); return x; },
      mine: async () => platformIntents.slice(),
    }),
    push: group("push", { register: async () => ({}), unregister: async () => ({}) }),
  };
  Object.keys(api).forEach((k) => { Object.assign(B[k], api[k]); });
})();
