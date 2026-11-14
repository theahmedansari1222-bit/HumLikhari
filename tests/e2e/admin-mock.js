/* In-browser stand-in for supabase-js used by the admin-console e2e. It implements just the query-builder surface the
 * console uses, over in-memory tables, and records every write in window.__log so tests can assert on exactly
 * what was sent to the database. */
(() => {
  const opts = window.__adminMock || {};
  const db = (window.__db = JSON.parse(JSON.stringify(opts.tables || {})));
  const log = (window.__log = []);
  const denied = new Set(opts.denyWrites || []);
  let session = opts.signedIn === false ? null : { user: { id: opts.userId || "00000000-0000-4000-8000-000000000001", email: "staff@example.org" } };
  let listener = null;
  let seq = 1000;
  const uuid = () => "00000000-0000-4000-8000-" + String(++seq).padStart(12, "0");
  const rls = () => ({ data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "x"' } });

  function matchOr(expr, row) {
    return expr.split(",").some((part) => {
      const m = part.match(/^([a-z_]+)\.ilike\.%(.*)%$/);
      return m ? String(row[m[1]] ?? "").toLowerCase().includes(m[2].toLowerCase()) : false;
    });
  }

  function builder(table) {
    const q = { op: "select", filters: [], orders: [], range: null, limit: null, patch: null, head: false, count: false, single: false, eqs: [], ors: [] };
    const api = {
      select(cols, o) { q.cols = cols; if (o) { q.head = !!o.head; q.count = o.count === "exact"; } return api; },
      insert(row) { q.op = "insert"; q.patch = row; return api; },
      update(patch) { q.op = "update"; q.patch = patch; return api; },
      delete() { q.op = "delete"; return api; },
      eq(c, v) { q.eqs.push([c, v]); q.filters.push((r) => r[c] === v); return api; },
      in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return api; },
      is(c, v) { q.filters.push((r) => (r[c] ?? null) === v); return api; },
      or(expr) { q.ors.push(expr); q.filters.push((r) => matchOr(expr, r)); return api; },
      order(c, o) { q.orders.push([c, o && o.ascending === false ? -1 : 1]); return api; },
      range(a, b) { q.range = [a, b]; return api; },
      limit(n) { q.limit = n; return api; },
      maybeSingle() { q.single = true; return api; },
      then(res, rej) { return Promise.resolve().then(exec).then(res, rej); },
    };
    function exec() {
      const rows = (db[table] = db[table] || []);
      const entry = { table, op: q.op, patch: q.patch, eqs: q.eqs, ors: q.ors };
      if (q.op === "select" && q.ors.length) log.push({ table, op: "select", ors: q.ors });
      if (q.op !== "select") { log.push(entry); if (denied.has(table + ":" + q.op)) return rls(); }
      if (q.op === "insert") { const row = Object.assign({ id: uuid(), created_at: new Date().toISOString() }, q.patch); rows.push(row); return { data: null, error: null }; }
      if (q.op === "update") { rows.filter((r) => q.filters.every((f) => f(r))).forEach((r) => Object.assign(r, q.patch)); return { data: null, error: null }; }
      if (q.op === "delete") { db[table] = rows.filter((r) => !q.filters.every((f) => f(r))); return { data: null, error: null }; }
      let out = rows.filter((r) => q.filters.every((f) => f(r)));
      if (q.head) return { data: null, count: out.length, error: null };
      for (const [c, dir] of [...q.orders].reverse()) out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * dir);
      if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
      if (q.limit) out = out.slice(0, q.limit);
      if (q.single) return { data: out[0] || null, error: null };
      return { data: out.map((r) => ({ ...r })), error: null };
    }
    return api;
  }

  const roles = opts.roles || {};
  const client = {
    from: builder,
    async rpc(name, args) {
      log.push({ rpc: name, args });
      if (name === "is_staff") return { data: !!(roles.admin || roles.moderator || roles.support_agent), error: null };
      if (name === "is_admin") return { data: !!roles.admin, error: null };
      if (name === "is_moderator") return { data: !!roles.moderator, error: null };
      if (name === "is_support_agent") return { data: !!roles.support_agent, error: null };
      if (name === "acquisition_source_counts") {
        const counts = {};
        (db.onboarding_surveys || []).forEach((s) => { counts[s.source] = (counts[s.source] || 0) + 1; });
        return { data: Object.entries(counts).map(([source, responses]) => ({ source, responses })).sort((a, b) => b.responses - a.responses), error: null };
      }
      if (name === "review_badge_application") return { data: null, error: null };
      return { data: null, error: { message: "unknown rpc " + name } };
    },
    functions: {
      async invoke(name, { body }) {
        log.push({ fn: name, body });
        if (opts.fnError && opts.fnError[name]) {
          const code = opts.fnError[name];
          return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: code }) } } };
        }
        if (name === "push-dispatch") return { data: { processed: 3, sent: 2, failed: 1, skipped: 0 }, error: null };
        return { data: { success: true }, error: null };
      },
    },
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange(cb) { listener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { session = null; log.push({ auth: "signOut" }); if (listener) listener("SIGNED_OUT", null); return { error: null }; },
      async signInWithOtp(a) { log.push({ auth: "otp", a }); return { data: {}, error: null }; },
      async verifyOtp(a) { log.push({ auth: "verify", a }); return { data: {}, error: null }; },
      async signInWithOAuth(a) { log.push({ auth: "oauth", a }); return { data: {}, error: null }; },
    },
  };
  window.__fireAuth = (event) => listener && listener(event, session);
  window.supabase = { createClient(url, key, o) { window.__clientArgs = { url, key, o }; return client; } };
})();
