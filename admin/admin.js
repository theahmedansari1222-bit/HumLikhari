(() => {
  "use strict";
  /* Hum Likhari staff console. A thin client over Supabase: the database (RLS, column grants, triggers) is the
   * real gate for every action below; hiding a button here is a convenience, never a control. */
  const $ = (selector, root = document) => root.querySelector(selector);
  const cfg = window.HL_ADMIN_CONFIG || {};
  const PAGE = 50;
  const IDLE_MS = 30 * 60 * 1000;                 // staff sessions end after 30 idle minutes
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const SECTIONS = [
    ["overview", "جائزہ"], ["reports", "رپورٹس"], ["feedback", "صارفین کی رائے"],
    ["volunteers", "ٹیم درخواستیں"], ["badges", "Blue Tick درخواستیں"],
    ["donations", "پلیٹ فارم معاونت"], ["accounts", "معاونت کے اکاؤنٹس"], ["users", "صارفین"],
    ["acquisition", "صارفین کہاں سے آئے؟"], ["push", "Push Notifications"], ["audit", "انتظامی ریکارڈ"],
  ];
  const VISIBLE_TO = {
    admin: null,                                                         // every section
    moderator: ["overview", "reports", "users", "audit"],
    support_agent: ["overview", "feedback", "volunteers", "donations", "acquisition", "audit"],
  };

  const STATUS = {
    report: [["received", "موصول"], ["in_review", "زیرِ جائزہ"], ["action_taken", "کارروائی ہو گئی"], ["dismissed", "خارج"]],
    ticket: [["received", "موصول"], ["in_review", "زیرِ جائزہ"], ["resolved", "حل ہو گیا"], ["closed", "بند"]],
    team: [["received", "موصول"], ["in_review", "زیرِ جائزہ"], ["accepted", "منظور"], ["declined", "مسترد"], ["withdrawn", "واپس لی گئی"]],
    badge: [["received", "موصول"], ["in_review", "زیرِ جائزہ"], ["approved", "منظور"], ["declined", "مسترد"], ["withdrawn", "واپس لی گئی"]],
    donation: [["submitted", "جمع ہو گئی"], ["under_review", "زیرِ جائزہ"], ["confirmed", "تصدیق ہو گئی"], ["rejected", "مسترد"]],
  };
  const WORDS = {
    reason: { spam: "اسپام یا اشتہار", harassment: "ہراسانی یا دھمکی", hate: "نفرت انگیز مواد", plagiarism: "تحریر چوری", inappropriate: "نامناسب مواد", other: "کوئی اور وجہ" },
    target: { post: "تحریر", comment: "تبصرہ", user: "صارف" },
    feedback: { question: "سوال", suggestion: "تجویز", bug: "خرابی", complaint: "شکایت" },
    area: { proofreading: "پروف ریڈنگ", editing: "ایڈیٹنگ", translation: "ترجمہ", design: "ڈیزائن", development: "ڈیولپمنٹ", community: "کمیونٹی", promotion: "پروموشن", research: "تحقیق", other: "کوئی اور" },
    badge: { consistent_writer: "مستقل مزاج لکھاری", featured_writer: "نمایاں لکھاری" },
    method: { jazzcash: "جاز کیش", easypaisa: "ایزی پیسہ", bank_transfer: "بینک اکاؤنٹ" },
    source: { facebook: "فیس بک", instagram: "انسٹاگرام", youtube: "یوٹیوب", whatsapp: "واٹس ایپ", tiktok: "ٹک ٹاک", google_search: "گوگل سرچ", friend_family: "دوست یا رشتہ دار", literary_community: "ادبی حلقہ", website_blog: "ویب سائٹ یا بلاگ", advertisement: "اشتہار", other: "کوئی اور" },
    role: { admin: "منتظم (admin)", moderator: "موڈریٹر", support_agent: "سپورٹ ایجنٹ" },
  };

  let db = null;
  let sessionUser = null;
  let roles = { admin: false, moderator: false, support_agent: false };
  let section = "overview";
  const view = { page: 0, filter: "", search: "" };
  let loadSeq = 0;                                   // discards the result of a section that was left before it finished
  let idleTimer = null;

  // ---- small helpers -------------------------------------------------------------------------------------
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = (value) => value ? new Date(value).toLocaleString("ur-PK") : "—";
  const word = (group, key) => WORDS[group]?.[key] || key || "—";
  const statusLabel = (list, value) => (STATUS[list].find(([k]) => k === value) || [value, value])[1];
  const show = (id) => $(id).classList.remove("hidden");
  const hide = (id) => $(id).classList.add("hidden");
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };
  const tell = (message, isError = false) => {
    const el = $("#globalMessage"); el.textContent = message || ""; el.className = `message${isError ? " error" : ""}`;
  };
  const shortId = (id) => id ? `<code title="${esc(id)}">${esc(String(id).slice(0, 8))}…</code>` : "—";
  const table = (heads, rows) =>
    `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="empty">کوئی ریکارڈ موجود نہیں۔</td></tr>`}</tbody></table></div>`;
  const options = (list, current) => list.map(([value, label]) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`).join("");
  const statusSelect = (list, current, attr) => `<select ${attr} aria-label="حالت">${options(STATUS[list], current)}</select>`;
  /** Characters that would change the meaning of a PostgREST filter expression are dropped from search text. */
  const safeSearch = (text) => String(text || "").trim().replace(/[,()"'\\%*_:]/g, " ").replace(/\s+/g, " ").slice(0, 60);

  /** Turns database / function errors into a sentence a staff member can act on. */
  function explain(error) {
    const message = String(error?.message || error || "");
    const code = error?.code;
    if (/admin_only/.test(message)) return "یہ عمل صرف admin کر سکتا ہے۔";
    if (/self_admin_revoke_not_allowed/.test(message)) return "آپ اپنا admin کردار خود واپس نہیں لے سکتے۔";
    if (/invalid_user_id|invalid_role|invalid_operation/.test(message)) return "درج کردہ معلومات درست نہیں۔";
    if (code === "42501" || /row-level security|permission denied/i.test(message)) return "آپ کے کردار کو اس عمل کی اجازت نہیں۔";
    if (code === "23514" || code === "22023") return "درج کردہ معلومات قواعد کے مطابق نہیں۔";
    if (code === "23503") return "متعلقہ ریکارڈ موجود نہیں رہا۔";
    if (/Failed to fetch|NetworkError|network/i.test(message)) return "انٹرنیٹ یا سرور سے رابطہ نہیں ہو سکا۔ دوبارہ کوشش کریں۔";
    return message || "نامعلوم خرابی";
  }

  /** Calls an Edge Function and surfaces the JSON error it returned (supabase-js hides it behind a generic message). */
  async function invoke(name, body) {
    const { data, error } = await db.functions.invoke(name, { body });
    if (!error) return data;
    let detail = "";
    try { detail = (await error.context.json())?.error || ""; } catch { /* body was not JSON */ }
    const known = {
      admin_only: "یہ عمل صرف admin کر سکتا ہے۔",
      invalid_session: "سیشن ختم ہو گیا؛ دوبارہ سائن اِن کریں۔",
      missing_credentials: "سیشن ختم ہو گیا؛ دوبارہ سائن اِن کریں۔",
      push_service_not_configured: "Push سروس کی secrets سیٹ نہیں ہیں (دیکھیں: docs/DEPLOYMENT.md)۔",
      fcm_auth_failed: "Firebase سے تصدیق ناکام ہوئی؛ service account چیک کریں۔",
    };
    throw new Error(known[detail] || detail || error.message);
  }

  // ---- roles & navigation --------------------------------------------------------------------------------
  async function checkRole() {
    const [staff, admin, moderator, support] = await Promise.all([
      db.rpc("is_staff"), db.rpc("is_admin"), db.rpc("is_moderator"), db.rpc("is_support_agent"),
    ]);
    roles = { admin: unwrap(admin) === true, moderator: unwrap(moderator) === true, support_agent: unwrap(support) === true };
    return unwrap(staff) === true;
  }
  function allowedSections() {
    if (roles.admin) return SECTIONS;
    const ids = new Set();
    for (const role of ["moderator", "support_agent"]) if (roles[role]) VISIBLE_TO[role].forEach((id) => ids.add(id));
    return SECTIONS.filter(([id]) => ids.has(id));
  }
  function renderNav() {
    const visible = allowedSections();
    if (!visible.some(([id]) => id === section)) section = "overview";
    $("#nav").innerHTML = visible.map(([id, label]) => `<button data-act="goto" data-section="${id}" class="${id === section ? "active" : ""}"${id === section ? ' aria-current="page"' : ""}>${esc(label)}</button>`).join("");
    $("#sectionTitle").textContent = SECTIONS.find(([id]) => id === section)?.[1] || "جائزہ";
  }

  // ---- paging ---------------------------------------------------------------------------------------------
  async function fetchPage(tableName, { columns = "*", order = "created_at", filterColumn = null, ascending = false } = {}) {
    const from = view.page * PAGE;
    let query = db.from(tableName).select(columns).order(order, { ascending }).order("id", { ascending });
    if (filterColumn && view.filter) query = query.eq(filterColumn, view.filter);
    const rows = unwrap(await query.range(from, from + PAGE));
    return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
  }
  const filterBar = (list) => `<div class="filterbar"><label>حالت کے مطابق<select data-act="filter" aria-label="حالت کا فلٹر"><option value="">سب</option>${options(STATUS[list], view.filter)}</select></label></div>`;
  const pager = (hasMore) => (view.page === 0 && !hasMore) ? "" :
    `<div class="pager"><button class="secondary" data-act="page" data-dir="-1"${view.page === 0 ? " disabled" : ""}>پچھلا</button><span>صفحہ ${view.page + 1}</span><button class="secondary" data-act="page" data-dir="1"${hasMore ? "" : " disabled"}>اگلا</button></div>`;

  // ---- sections --------------------------------------------------------------------------------------------
  async function count(tableName, filters) {
    let query = db.from(tableName).select("*", { count: "exact", head: true });
    for (const [column, value] of Object.entries(filters || {})) query = query.eq(column, value);
    const { count: n, error } = await query;
    if (error) throw error;
    return n || 0;
  }

  async function loadOverview() {
    const defs = [];
    if (roles.admin || roles.moderator) defs.push(["صارفین", "profiles", {}, "users"], ["تحریریں", "posts", {}, null], ["نئی رپورٹس", "content_reports", { status: "received" }, "reports"]);
    if (roles.admin || roles.support_agent) defs.push(["نئے ٹکٹ", "feedback_tickets", { status: "received" }, "feedback"], ["نئی ٹیم درخواستیں", "volunteer_applications", { status: "received" }, "volunteers"], ["زیرِ جائزہ معاونتیں", "platform_donation_intents", { status: "submitted" }, "donations"]);
    if (roles.admin) defs.push(["نئی بیج درخواستیں", "badge_applications", { status: "received" }, "badges"]);
    const seen = new Set();
    const unique = defs.filter(([, t, f]) => { const k = t + JSON.stringify(f); if (seen.has(k)) return false; seen.add(k); return true; });
    const values = await Promise.all(unique.map(([, t, f]) => count(t, f)));
    const allowed = new Set(allowedSections().map(([id]) => id));
    $("#content").innerHTML = `<div class="grid">${unique.map(([label, , , target], i) => {
      const body = `<span>${esc(label)}</span><strong>${values[i]}</strong>`;
      return target && allowed.has(target) ? `<button class="metric linked" data-act="goto" data-section="${target}">${body}</button>` : `<div class="metric">${body}</div>`;
    }).join("")}</div><article><h2>اہم یاددہانی</h2><p>لکھاری کے تعاون یا پلیٹ فارم ڈونیشن کی کوئی درخواست رقم کی خودکار تصدیق نہیں ہے۔ تصدیق صرف اصل ادائیگی فراہم کنندہ یا قابلِ اعتماد رسید سے کرنے کے بعد درج کریں۔</p><p class="small">یہ اعداد و شمار آپ کے اسٹاف کردار کی اجازت کے مطابق ہیں۔</p></article>`;
  }

  /** Best-effort preview of what a report points at (staff may not be able to read every table; then we show the id). */
  async function previewTargets(rows) {
    const out = new Map();
    const ids = (kind) => [...new Set(rows.filter((r) => r.target_type === kind).map((r) => r.post_id || r.comment_id || r.reported_user_id).filter(Boolean))];
    const jobs = [
      ["post", "posts", "id,title,status", (r) => `${r.title || "(بغیر عنوان)"} · ${r.status}`],
      ["comment", "comments", "id,body,status", (r) => `${String(r.body || "").slice(0, 120)} · ${r.status}`],
      ["user", "profiles", "id,username,display_name,is_active", (r) => `${r.display_name} (@${r.username})${r.is_active ? "" : " · غیر فعال"}`],
    ];
    await Promise.all(jobs.map(async ([kind, tableName, columns, format]) => {
      const list = ids(kind); if (!list.length) return;
      const { data } = await db.from(tableName).select(columns).in("id", list);
      for (const row of data || []) out.set(row.id, format(row));
    }));
    return out;
  }
  async function loadReports() {
    const { rows, hasMore } = await fetchPage("content_reports", { filterColumn: "status" });
    const previews = await previewTargets(rows).catch(() => new Map());
    $("#content").innerHTML = filterBar("report") + table(["وقت","قسم / وجہ","ہدف","تفصیل","حالت اور نوٹ","عمل"], rows.map((r) => {
      const target = r.post_id || r.comment_id || r.reported_user_id || "";
      return `<tr><td>${when(r.created_at)}</td><td>${esc(word("target", r.target_type))}<br><span class="tag">${esc(word("reason", r.reason))}</span></td>
        <td>${esc(previews.get(target) || "—")}<br>${shortId(target)}</td><td>${esc(String(r.details || "").slice(0, 300))}</td>
        <td>${statusSelect("report", r.status, `data-report-status="${esc(r.id)}"`)}<textarea rows="1" data-report-note="${esc(r.id)}" placeholder="اندرونی نوٹ">${esc(r.staff_note || "")}</textarea></td>
        <td class="actions"><button class="secondary" data-act="save-report" data-id="${esc(r.id)}">محفوظ کریں</button>${target ? `<button class="danger" data-act="hide-target" data-id="${esc(r.id)}" data-kind="${esc(r.target_type)}" data-target="${esc(target)}">${r.target_type === "user" ? "اکاؤنٹ غیر فعال کریں" : "مواد چھپائیں"}</button>` : ""}</td></tr>`;
    }).join("")) + pager(hasMore);
  }

  async function loadFeedback() {
    const { rows, hasMore } = await fetchPage("feedback_tickets", { filterColumn: "status" });
    let threads = new Map();
    if (rows.length) {
      const messages = unwrap(await db.from("feedback_ticket_messages").select("ticket_id,author_id,message,is_internal,created_at").in("ticket_id", rows.map((r) => r.id)).order("created_at", { ascending: true }));
      for (const m of messages) { if (!threads.has(m.ticket_id)) threads.set(m.ticket_id, []); threads.get(m.ticket_id).push(m); }
    }
    $("#content").innerHTML = filterBar("ticket") + (rows.map((t) => `<article><div class="toolbar"><h2>${esc(t.ticket_number)} · ${esc(word("feedback", t.feedback_type))}</h2><span class="tag">${esc(statusLabel("ticket", t.status))}</span></div>
      <p>${esc(t.message)}</p><p class="small">${when(t.created_at)} · صارف: ${shortId(t.user_id)}</p>
      ${(threads.get(t.id) || []).map((m) => `<div class="bubble${m.author_id === t.user_id ? " from-user" : ""}${m.is_internal ? " internal" : ""}"><span class="small">${m.is_internal ? "اندرونی نوٹ" : m.author_id === t.user_id ? "صارف" : "اسٹاف"} · ${when(m.created_at)}</span><p>${esc(m.message)}</p></div>`).join("")}
      <label>نیا جواب<textarea rows="2" maxlength="2000" data-ticket-reply="${esc(t.id)}" placeholder="صارف کو دکھایا جانے والا جواب"></textarea></label>
      <label class="check"><input type="checkbox" data-ticket-internal="${esc(t.id)}"> اندرونی نوٹ (صارف کو نہیں دکھایا جائے گا)</label>
      <div class="row-form"><label>حالت${statusSelect("ticket", t.status, `data-ticket-status="${esc(t.id)}"`)}</label><div><button class="primary" data-act="save-ticket" data-id="${esc(t.id)}">محفوظ کریں</button></div></div></article>`).join("") || `<div class="panel empty">کوئی ٹکٹ موجود نہیں۔</div>`) + pager(hasMore);
  }

  async function loadVolunteers() {
    const { rows, hasMore } = await fetchPage("volunteer_applications", { filterColumn: "status" });
    $("#content").innerHTML = filterBar("team") + table(["درخواست","شعبہ","مہارت / وقت","وجہ","حالت","عمل"], rows.map((r) => `<tr><td>${when(r.created_at)}<br>${shortId(r.applicant_id)}</td><td>${esc(word("area", r.team_area))}</td><td>${esc(r.skills)}<br>${esc(r.availability)}</td><td>${esc(r.motivation)}</td><td>${statusSelect("team", r.status, `data-vol-status="${esc(r.id)}"`)}<textarea rows="1" data-vol-note="${esc(r.id)}" placeholder="صارف کو دکھایا جانے والا جواب">${esc(r.staff_note || "")}</textarea></td><td><button class="primary" data-act="save-vol" data-id="${esc(r.id)}">محفوظ کریں</button></td></tr>`).join("")) + pager(hasMore);
  }

  async function loadBadges() {
    if (!roles.admin) { $("#content").innerHTML = `<article>Blue Tick جاری کرنے یا درخواست منظور کرنے کا اختیار صرف admin کے پاس ہے۔</article>`; return; }
    const { rows, hasMore } = await fetchPage("badge_applications", { filterColumn: "status" });
    const active = unwrap(await db.from("writer_badges").select("id,user_id,badge_type,reason,issued_at").is("revoked_at", null).order("issued_at", { ascending: false }).limit(100));
    $("#content").innerHTML = `<article><h2>درخواستیں</h2>${filterBar("badge")}${table(["لکھاری","بیج","پورٹ فولیو نوٹ","حالت","عمل"], rows.map((r) => `<tr><td>${shortId(r.user_id)}<br>${when(r.created_at)}</td><td>${esc(word("badge", r.badge_type))}</td><td>${esc(r.portfolio_note)}</td><td>${esc(statusLabel("badge", r.status))}<textarea rows="1" data-badge-note="${esc(r.id)}" placeholder="صارف کو دکھائی جانے والی فیصلے کی وجہ">${esc(r.staff_note || "")}</textarea></td><td class="actions"><button class="primary" data-act="review-badge" data-id="${esc(r.id)}" data-decision="approved">منظور</button><button class="secondary" data-act="review-badge" data-id="${esc(r.id)}" data-decision="in_review">جائزے میں</button><button class="danger" data-act="review-badge" data-id="${esc(r.id)}" data-decision="declined">مسترد</button></td></tr>`).join(""))}${pager(hasMore)}</article>
      <article><h2>فعال بیجز</h2>${table(["لکھاری","بیج","وجہ","جاری ہونے کی تاریخ","عمل"], active.map((r) => `<tr><td>${shortId(r.user_id)}</td><td>${esc(word("badge", r.badge_type))}</td><td>${esc(r.reason)}</td><td>${when(r.issued_at)}</td><td><button class="danger" data-act="revoke-badge" data-id="${esc(r.id)}">بیج واپس لیں</button></td></tr>`).join(""))}</article>`;
  }

  async function loadDonations() {
    const { rows, hasMore } = await fetchPage("platform_donation_intents", { filterColumn: "status" });
    $("#content").innerHTML = `<article><p><strong>صرف پاکستان پائلٹ:</strong> یہ دستی ریکارڈ ہے۔ "تصدیق ہو گئی" صرف تب منتخب کریں جب اصل ادائیگی کی تصدیق ہو چکی ہو۔</p></article>` + filterBar("donation") +
      table(["وقت / صارف","رقم","طریقہ","حوالہ","حالت","عمل"], rows.map((r) => `<tr><td>${when(r.created_at)}<br>${shortId(r.donor_id)}</td><td>${esc(r.amount)} ${esc(r.currency)}</td><td>${esc(word("method", r.method))}</td><td>${esc(r.transaction_reference)}</td><td>${roles.admin ? statusSelect("donation", r.status, `data-donation-status="${esc(r.id)}"`) + `<textarea rows="1" data-donation-note="${esc(r.id)}" placeholder="صارف کو دکھایا جانے والا جواب">${esc(r.staff_note || "")}</textarea>` : esc(statusLabel("donation", r.status))}</td><td>${roles.admin ? `<button class="primary" data-act="save-donation" data-id="${esc(r.id)}">محفوظ کریں</button>` : "صرف مشاہدہ"}</td></tr>`).join("")) + pager(hasMore);
  }

  const accountForm = (a = {}) => {
    const id = a.id ? esc(a.id) : "new";
    return `<div class="account-grid" data-account="${id}">
      <label>طریقہ<select data-f="method">${options(Object.entries(WORDS.method), a.method || "jazzcash")}</select></label>
      <label>عنوان / لیبل<input data-f="label" maxlength="80" value="${esc(a.label || "")}"></label>
      <label>بینک کا نام (بینک اکاؤنٹ کے لیے لازمی)<input data-f="bank_name" maxlength="80" value="${esc(a.bank_name || "")}"></label>
      <label>اکاؤنٹ ٹائٹل<input data-f="account_title" maxlength="120" value="${esc(a.account_title || "")}"></label>
      <label>اکاؤنٹ نمبر / IBAN<input data-f="account_identifier" dir="ltr" maxlength="120" value="${esc(a.account_identifier || "")}"></label>
      <label>ترتیب (چھوٹا نمبر پہلے)<input data-f="sort_order" type="number" min="0" max="999" dir="ltr" value="${esc(a.sort_order ?? 0)}"></label>
      <label class="wide">ہدایات (زیادہ سے زیادہ 500 حروف)<textarea data-f="instructions" rows="2" maxlength="500">${esc(a.instructions || "")}</textarea></label>
      <label class="check"><input type="checkbox" data-f="is_active"${a.is_active === false ? "" : " checked"}> صارفین کو دکھائیں</label>
      <div class="actions"><button class="primary" data-act="save-account" data-id="${id}">${a.id ? "محفوظ کریں" : "اکاؤنٹ شامل کریں"}</button>${a.id ? `<button class="danger" data-act="delete-account" data-id="${id}">حذف کریں</button>` : ""}</div></div>`;
  };
  async function loadAccounts() {
    if (!roles.admin) { $("#content").innerHTML = `<article>یہ فہرست صرف admin بدل سکتا ہے۔</article>`; return; }
    const rows = unwrap(await db.from("platform_donation_accounts").select("*").order("sort_order").order("created_at"));
    $("#content").innerHTML = `<article><h2>معاونت کے اکاؤنٹس</h2><p class="small">یہ وہ اکاؤنٹس ہیں جو "پلیٹ فارم کی معاونت" کی اسکرین پر صارف کو دکھائے جاتے ہیں۔ غلط نمبر کا مطلب ہے کہ لوگوں کی رقم غلط جگہ جائے گی؛ ہر تبدیلی کے بعد خود ایپ میں جا کر دیکھ لیں۔</p></article>` +
      rows.map((a) => `<article><h2>${esc(word("method", a.method))}${a.label ? ` · ${esc(a.label)}` : ""} ${a.is_active ? "" : '<span class="tag">پوشیدہ</span>'}</h2>${accountForm(a)}</article>`).join("") +
      `<article><h2>نیا اکاؤنٹ</h2>${accountForm()}</article>`;
  }
  function readAccount(id) {
    const box = $(`[data-account="${CSS.escape(id)}"]`);
    const get = (name) => box.querySelector(`[data-f="${name}"]`);
    const method = get("method").value;
    const record = {
      method,
      label: get("label").value.trim(),
      bank_name: get("bank_name").value.trim() || null,
      account_title: get("account_title").value.trim(),
      account_identifier: get("account_identifier").value.trim(),
      instructions: get("instructions").value.trim(),
      sort_order: Math.max(0, Math.min(999, parseInt(get("sort_order").value, 10) || 0)),
      is_active: get("is_active").checked,
    };
    if (!record.account_title || !record.account_identifier) throw new Error("اکاؤنٹ ٹائٹل اور اکاؤنٹ نمبر لازمی ہیں۔");
    if (method === "bank_transfer" && !record.bank_name) throw new Error("بینک اکاؤنٹ کے لیے بینک کا نام لازمی ہے۔");
    if (method !== "bank_transfer") record.bank_name = record.bank_name || null;
    return record;
  }

  async function loadUsers() {
    const q = safeSearch(view.search);
    let query = db.from("profiles").select("id,username,display_name,country_code,is_active,created_at").order("created_at", { ascending: false }).order("id", { ascending: false });
    if (UUID.test(view.search.trim())) query = query.eq("id", view.search.trim());
    else if (q) query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
    const from = view.page * PAGE;
    const found = unwrap(await query.range(from, from + PAGE));
    const rows = found.slice(0, PAGE);
    $("#content").innerHTML =
      `<article><h2>صارف تلاش کریں</h2><div class="row-form"><label>ہینڈل، نام یا UUID<input id="userSearch" value="${esc(view.search)}" maxlength="60" placeholder="مثلاً ahmed"></label><div><button class="primary" data-act="search-users">تلاش</button>${view.search ? '<button class="quiet" data-act="clear-search">صاف کریں</button>' : ""}</div></div></article>` +
      (roles.admin ? `<article><h2>کردار تفویض کریں</h2><p class="small">صارف کا ہینڈل یا UUID لکھیں۔ یہ کارروائی صرف admin کر سکتا ہے اور انتظامی ریکارڈ میں درج ہوتی ہے۔</p><div class="row-form"><label>ہینڈل یا UUID<input id="roleUser" placeholder="@username" dir="ltr"></label><label>کردار<select id="roleName">${options(["moderator", "support_agent", "admin"].map((r) => [r, WORDS.role[r]]), "moderator")}</select></label><label>عمل<select id="roleOperation"><option value="grant">تفویض</option><option value="revoke">واپس لیں</option></select></label><button class="primary" data-act="apply-role">کردار تبدیل کریں</button></div></article>` : "") +
      table(["صارف","ہینڈل","ملک","حالت","عمل"], rows.map((r) => `<tr><td>${esc(r.display_name)}<br>${shortId(r.id)}</td><td dir="ltr">@${esc(r.username)}</td><td>${esc(r.country_code || "—")}</td><td>${r.is_active ? "فعال" : "غیر فعال"}</td><td class="actions"><button class="${r.is_active ? "danger" : "secondary"}" data-act="user-active" data-id="${esc(r.id)}" data-active="${!r.is_active}">${r.is_active ? "غیر فعال کریں" : "فعال کریں"}</button>${roles.admin ? `<button class="quiet" data-act="fill-role" data-username="${esc(r.username)}">کردار…</button>` : ""}</td></tr>`).join("")) +
      pager(found.length > PAGE);
  }

  async function loadAcquisition() {
    const rows = unwrap(await db.rpc("acquisition_source_counts"));
    const total = rows.reduce((sum, r) => sum + Number(r.responses || 0), 0);
    $("#content").innerHTML = `<article><h2>صارفین نے Hum Likhari کہاں سے دریافت کیا؟</h2><p class="small">یہ اختیاری سروے کے aggregate نتائج ہیں (کل جوابات: ${total})؛ کسی ایک صارف کی شناخت یہاں نہیں دکھائی جاتی۔</p></article>` +
      table(["ذریعہ","جوابات","تناسب"], rows.map((r) => `<tr><td>${esc(word("source", r.source))}</td><td dir="ltr">${esc(r.responses)}</td><td><meter min="0" max="${total || 1}" value="${Number(r.responses) || 0}">${esc(r.responses)}</meter> <span class="small" dir="ltr">${total ? Math.round(Number(r.responses) * 100 / total) : 0}%</span></td></tr>`).join(""));
  }

  async function loadPush() {
    if (!roles.admin) { $("#content").innerHTML = `<article>Push notifications بھیجنے کا اختیار صرف admin کے پاس ہے۔</article>`; return; }
    const [pending, failed, sent] = await Promise.all([count("push_deliveries", { status: "pending" }), count("push_deliveries", { status: "failed" }), count("push_deliveries", { status: "sent" })]);
    const errors = unwrap(await db.from("push_deliveries").select("last_error,attempts,updated_at").eq("status", "failed").order("updated_at", { ascending: false }).limit(10));
    $("#content").innerHTML = `<article><h2>Push Notification سروس</h2><div class="grid"><div class="metric"><span>زیرِ التواء</span><strong>${pending}</strong></div><div class="metric"><span>ناکام / دوبارہ کوشش</span><strong>${failed}</strong></div><div class="metric"><span>بھیجے جا چکے</span><strong>${sent}</strong></div></div>
      <p>عام حالت میں یہ کام شیڈیولر (pg_cron) ہر منٹ خود کرتا ہے؛ نیچے کا بٹن صرف فوری بھیجنے یا جانچ کے لیے ہے۔ اس کے لیے Firebase service account اور <code>PUSH_DISPATCH_SECRET</code> Supabase Function secrets میں ہونا ضروری ہے۔</p>
      <button id="dispatchPush" class="primary" data-act="dispatch-push">زیرِ التواء اطلاعات بھیجیں</button><p class="small">ایک درخواست میں زیادہ سے زیادہ 100 اطلاعات پراسیس ہوتی ہیں۔</p></article>` +
      (errors.length ? `<article><h2>حالیہ ناکامیاں</h2>${table(["وقت","کوششیں","خرابی"], errors.map((e) => `<tr><td>${when(e.updated_at)}</td><td dir="ltr">${esc(e.attempts)}</td><td><code>${esc(e.last_error || "—")}</code></td></tr>`).join(""))}</article>` : "");
  }

  async function loadAudit() {
    const { rows, hasMore } = await fetchPage("staff_audit_log");
    $("#content").innerHTML = table(["وقت","اسٹاف","عمل","قسم","ریکارڈ","تفصیل"], rows.map((r) => `<tr><td>${when(r.created_at)}</td><td>${r.actor_id ? shortId(r.actor_id) : "system"}</td><td>${esc(r.action)}</td><td>${esc(r.entity_type)}</td><td>${shortId(r.entity_id)}</td><td><pre>${esc(JSON.stringify(r.details || {}))}</pre></td></tr>`).join("")) + pager(hasMore);
  }

  const LOADERS = { overview: loadOverview, reports: loadReports, feedback: loadFeedback, volunteers: loadVolunteers, badges: loadBadges, donations: loadDonations, accounts: loadAccounts, users: loadUsers, acquisition: loadAcquisition, push: loadPush, audit: loadAudit };

  async function loadSection({ keepMessage = false } = {}) {
    const seq = ++loadSeq;
    renderNav();
    if (!keepMessage) tell("");
    $("#content").innerHTML = `<div class="panel">لوڈ ہو رہا ہے…</div>`;
    try {
      await LOADERS[section]();
      if (seq !== loadSeq) return;
    } catch (error) {
      if (seq !== loadSeq) return;
      $("#content").innerHTML = `<article class="error">ڈیٹا لوڈ نہیں ہو سکا: ${esc(explain(error))}</article>`;
    }
  }
  function goto(id) { section = id; view.page = 0; view.filter = ""; view.search = ""; return loadSection(); }

  // ---- session ---------------------------------------------------------------------------------------------
  function armIdleTimer() {
    clearTimeout(idleTimer);
    if (!sessionUser) return;
    idleTimer = setTimeout(async () => { tell("کافی دیر غیر فعال رہنے کی وجہ سے سائن آؤٹ کر دیا گیا۔"); await db.auth.signOut(); }, IDLE_MS);
  }
  async function startSession(session) {
    sessionUser = session?.user || null;
    armIdleTimer();
    if (!sessionUser) { hide("#app"); hide("#denied"); show("#login"); $("#identity").textContent = "سائن اِن درکار ہے"; return; }
    $("#identity").textContent = sessionUser.email || sessionUser.phone || sessionUser.id;
    try {
      if (!(await checkRole())) { hide("#login"); hide("#app"); show("#denied"); return; }
      hide("#login"); hide("#denied"); show("#app");
      await loadSection();
    } catch (error) { tell(`اجازت چیک نہیں ہو سکی: ${explain(error)}`, true); }
  }
  async function initialize() {
    if (!window.supabase?.createClient || !cfg.url || !cfg.publishableKey || /YOUR_PROJECT|REPLACE_ME/.test(cfg.url + cfg.publishableKey)) {
      show("#setup"); $("#identity").textContent = "کنفیگریشن درکار"; return;
    }
    db = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });
    const { data } = await db.auth.getSession();
    await startSession(data.session);
    db.auth.onAuthStateChange((event, session) => {
      // Token refreshes and tab re-focus re-fire the callback; reloading then would discard what staff are typing.
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
      if (event === "SIGNED_IN" && session?.user?.id && session.user.id === sessionUser?.id) return;
      queueMicrotask(() => startSession(session));
    });
  }

  // ---- actions ---------------------------------------------------------------------------------------------
  const val = (selector) => $(selector)?.value ?? "";
  const byId = (attr, id) => $(`[${attr}="${CSS.escape(id)}"]`);

  async function resolveUser(text) {
    const input = String(text || "").trim().replace(/^@/, "").toLowerCase();
    if (!input) throw new Error("صارف کا ہینڈل یا UUID لکھیں۔");
    if (UUID.test(input)) return input;
    const row = unwrap(await db.from("profiles").select("id").eq("username", input).maybeSingle());
    if (!row) throw new Error("اس ہینڈل کا کوئی صارف نہیں ملا۔");
    return row.id;
  }

  const ACTIONS = {
    async goto(t) { await goto(t.dataset.section); },
    async filter(t) { view.filter = t.value; view.page = 0; await loadSection({ keepMessage: true }); },
    async page(t) { view.page = Math.max(0, view.page + Number(t.dataset.dir)); await loadSection({ keepMessage: true }); },
    async refresh() { await loadSection(); },
    async "save-report"(t) {
      const id = t.dataset.id;
      unwrap(await db.from("content_reports").update({ status: val(`[data-report-status="${CSS.escape(id)}"]`), staff_note: val(`[data-report-note="${CSS.escape(id)}"]`).trim() }).eq("id", id));
      tell("رپورٹ اپ ڈیٹ ہو گئی۔"); await loadSection({ keepMessage: true });
    },
    async "hide-target"(t) {
      const { kind, target, id } = t.dataset;
      if (!UUID.test(target || "")) throw new Error("ہدف کی شناخت درست نہیں۔");
      if (!confirm(kind === "user" ? "کیا اس صارف کا اکاؤنٹ غیر فعال کرنا ہے؟" : "کیا اس مواد کو عوامی فیڈ سے ہٹانا ہے؟ مصنف کو اطلاع بھیجی جائے گی۔")) return;
      if (kind === "post") unwrap(await db.from("posts").update({ status: "removed" }).eq("id", target));
      else if (kind === "comment") unwrap(await db.from("comments").update({ status: "removed" }).eq("id", target));
      else unwrap(await db.from("profiles").update({ is_active: false }).eq("id", target));
      unwrap(await db.from("content_reports").update({ status: "action_taken" }).eq("id", id));
      tell("کارروائی لاگو ہو گئی اور رپورٹ 'کارروائی ہو گئی' کر دی گئی۔"); await loadSection({ keepMessage: true });
    },
    async "save-ticket"(t) {
      const id = t.dataset.id;
      const status = val(`[data-ticket-status="${CSS.escape(id)}"]`);
      const reply = val(`[data-ticket-reply="${CSS.escape(id)}"]`).trim();
      const internal = byId("data-ticket-internal", id)?.checked === true;
      if (reply) unwrap(await db.from("feedback_ticket_messages").insert({ ticket_id: id, author_id: sessionUser.id, message: reply, is_internal: internal }));
      const patch = { status, assigned_to: sessionUser.id };
      if (reply && !internal) patch.staff_reply = reply;
      unwrap(await db.from("feedback_tickets").update(patch).eq("id", id));
      tell("ٹکٹ اپ ڈیٹ ہو گیا۔"); await loadSection({ keepMessage: true });
    },
    async "save-vol"(t) {
      const id = t.dataset.id;
      unwrap(await db.from("volunteer_applications").update({ status: val(`[data-vol-status="${CSS.escape(id)}"]`), staff_note: val(`[data-vol-note="${CSS.escape(id)}"]`).trim() }).eq("id", id));
      tell("ٹیم درخواست اپ ڈیٹ ہو گئی۔"); await loadSection({ keepMessage: true });
    },
    async "review-badge"(t) {
      const id = t.dataset.id;
      unwrap(await db.rpc("review_badge_application", { p_application_id: id, p_decision: t.dataset.decision, p_staff_note: val(`[data-badge-note="${CSS.escape(id)}"]`).trim() }));
      tell("بیج درخواست کا فیصلہ محفوظ ہو گیا۔"); await loadSection({ keepMessage: true });
    },
    async "revoke-badge"(t) {
      if (!confirm("کیا اس لکھاری کا فعال بیج واپس لینا ہے؟")) return;
      unwrap(await db.from("writer_badges").update({ revoked_at: new Date().toISOString() }).eq("id", t.dataset.id));
      tell("بیج واپس لے لیا گیا۔"); await loadSection({ keepMessage: true });
    },
    async "save-donation"(t) {
      const id = t.dataset.id;
      const status = val(`[data-donation-status="${CSS.escape(id)}"]`);
      if (status === "confirmed" && !confirm("کیا آپ نے ادائیگی کی اصل رسید/فراہم کنندہ سے تصدیق کر لی ہے؟")) return;
      unwrap(await db.from("platform_donation_intents").update({ status, staff_note: val(`[data-donation-note="${CSS.escape(id)}"]`).trim() }).eq("id", id));
      tell("معاونت کی درخواست اپ ڈیٹ ہو گئی۔"); await loadSection({ keepMessage: true });
    },
    async "save-account"(t) {
      const id = t.dataset.id;
      const record = readAccount(id);
      if (id === "new") unwrap(await db.from("platform_donation_accounts").insert(record));
      else unwrap(await db.from("platform_donation_accounts").update(record).eq("id", id));
      tell(id === "new" ? "نیا اکاؤنٹ شامل ہو گیا۔" : "اکاؤنٹ محفوظ ہو گیا۔"); await loadSection({ keepMessage: true });
    },
    async "delete-account"(t) {
      if (!confirm("کیا یہ اکاؤنٹ مستقل طور پر حذف کرنا ہے؟ (عارضی طور پر چھپانے کے لیے 'صارفین کو دکھائیں' بند کریں۔)")) return;
      unwrap(await db.from("platform_donation_accounts").delete().eq("id", t.dataset.id));
      tell("اکاؤنٹ حذف ہو گیا۔"); await loadSection({ keepMessage: true });
    },
    async "search-users"() { view.search = val("#userSearch").trim(); view.page = 0; await loadSection({ keepMessage: true }); },
    async "clear-search"() { view.search = ""; view.page = 0; await loadSection({ keepMessage: true }); },
    async "user-active"(t) {
      const active = t.dataset.active === "true";
      if (!confirm(active ? "کیا اکاؤنٹ دوبارہ فعال کرنا ہے؟" : "کیا اکاؤنٹ غیر فعال کرنا ہے؟")) return;
      unwrap(await db.from("profiles").update({ is_active: active }).eq("id", t.dataset.id));
      tell("صارف کی حالت اپ ڈیٹ ہو گئی۔"); await loadSection({ keepMessage: true });
    },
    async "fill-role"(t) { const input = $("#roleUser"); if (input) { input.value = `@${t.dataset.username}`; input.focus(); } },
    async "apply-role"() {
      const userId = await resolveUser(val("#roleUser"));
      const role = val("#roleName"), operation = val("#roleOperation");
      if (!confirm(`کیا واقعی ${operation === "grant" ? "یہ کردار دینا" : "یہ کردار واپس لینا"} ہے: ${WORDS.role[role]}؟`)) return;
      await invoke("manage-user-role", { userId, role, operation });
      tell("کردار تبدیل کر دیا گیا۔ نتیجہ 'انتظامی ریکارڈ' میں دیکھا جا سکتا ہے۔");
    },
    async "dispatch-push"() {
      const result = await invoke("push-dispatch", { limit: 100 });
      tell(`Push queue مکمل: ${result.sent} بھیجے، ${result.failed} ناکام، ${result.skipped} چھوڑے گئے۔`); await loadSection({ keepMessage: true });
    },
    async "google-login"() {
      unwrap(await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}${location.pathname}` } }));
    },
    async "send-otp"() {
      const phone = val("#phone").trim();
      if (!/^\+\d{8,15}$/.test(phone)) throw new Error("نمبر بین الاقوامی صورت میں لکھیں، مثلاً +923001234567");
      unwrap(await db.auth.signInWithOtp({ phone }));
      $("#loginMessage").textContent = "کوڈ بھیج دیا گیا ہے۔";
    },
    async "verify-otp"() {
      const phone = val("#phone").trim(), token = val("#otp").trim();
      if (!/^\d{6}$/.test(token)) throw new Error("6 ہندسوں کا کوڈ درج کریں۔");
      unwrap(await db.auth.verifyOtp({ phone, token, type: "sms" }));
    },
    async "sign-out"() { await db.auth.signOut(); },
  };

  const busy = new WeakSet();
  async function dispatch(element) {
    const act = element.dataset.act;
    const handler = ACTIONS[act];
    if (!handler || busy.has(element)) return;
    busy.add(element);
    if (element.tagName === "BUTTON") element.disabled = true;
    try { await handler(element); }
    catch (error) { tell(explain(error), true); if (act.includes("otp") || act === "google-login") $("#loginMessage").textContent = ""; }
    finally { busy.delete(element); if (element.isConnected && element.tagName === "BUTTON") element.disabled = false; }
  }
  document.addEventListener("click", (event) => {
    armIdleTimer();
    const element = event.target.closest("[data-act]");
    if (element && element.tagName !== "SELECT") dispatch(element);
  });
  document.addEventListener("change", (event) => { if (event.target.matches("select[data-act]")) dispatch(event.target); });
  document.addEventListener("keydown", (event) => {
    armIdleTimer();
    if (event.key === "Enter" && event.target.id === "userSearch") dispatch($('[data-act="search-users"]'));
  });

  initialize().catch((error) => { show("#setup"); tell(explain(error), true); });
})();
