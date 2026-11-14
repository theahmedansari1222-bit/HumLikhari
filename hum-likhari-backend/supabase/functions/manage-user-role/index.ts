import { createClient } from "@supabase/supabase-js";

import { preflight, respond } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  const json = (status: number, body: Record<string, unknown>) => respond(request, status, body);
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const bearer = request.headers.get("Authorization") ?? "";
  const token = bearer.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "missing_bearer_token" });

  const url = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !publicKey) return json(500, { error: "server_configuration_error" });
  const caller = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userResult, error: authError } = await caller.auth.getUser(token);
  if (authError || !userResult.user) return json(401, { error: "invalid_session" });

  let body: any;
  try { body = await request.json(); } catch { return json(400, { error: "invalid_json" }); }
  const userId = String(body?.userId || "");
  const role = String(body?.role || "");
  const operation = String(body?.operation || "grant");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(400, { error: "invalid_user_id" });
  if (!( ["admin", "moderator", "support_agent"] as string[]).includes(role)) return json(400, { error: "invalid_role" });
  if (!["grant", "revoke"].includes(operation)) return json(400, { error: "invalid_operation" });

  const { error } = await caller.rpc("manage_user_role", {
    p_user_id: userId, p_role: role, p_operation: operation,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return json(status, { error: error.message || "role_change_failed" });
  }
  return json(200, { success: true, userId, role, operation });
});
