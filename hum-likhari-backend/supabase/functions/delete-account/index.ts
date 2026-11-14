import { createClient } from "@supabase/supabase-js";

import { preflight, respond } from "../_shared/http.ts";
import { lastAuthenticatedAt } from "../_shared/freshness.ts";

const FRESH_LOGIN_SECONDS = 15 * 60;

async function collectFilesRecursively(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const result: string[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Could not list ${bucket} objects: ${error.message}`);

    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      // Storage returns folder placeholders without an object id/metadata.
      if (item.id == null && item.metadata == null) {
        result.push(...await collectFilesRecursively(admin, bucket, path));
      } else {
        result.push(path);
      }
    }

    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  return result;
}

async function removeUserFiles(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  userId: string,
) {
  const paths = await collectFilesRecursively(admin, bucket, userId);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`Could not remove ${bucket} objects: ${error.message}`);
  }
}

Deno.serve(async (request: Request) => {
  const json = (status: number, body: Record<string, unknown>) => respond(request, status, body);
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "missing_bearer_token" });

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !publishableKey || !serviceKey) {
    console.error("Missing required Supabase function environment variables.");
    return json(500, { error: "server_configuration_error" });
  }

  const caller = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: "invalid_session" });

  const { data: claimsData, error: claimsError } = await caller.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) return json(401, { error: "invalid_session" });
  const signedInAt = lastAuthenticatedAt(claimsData.claims as Record<string, unknown>, userData.user.last_sign_in_at);
  if (signedInAt === null || Date.now() / 1000 - signedInAt > FRESH_LOGIN_SECONDS) {
    return json(403, { error: "recent_login_required" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (!body || typeof body !== "object" || (body as { confirm?: unknown }).confirm !== "DELETE") {
    return json(400, { error: "explicit_confirmation_required", required: { confirm: "DELETE" } });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userId = userData.user.id;

  try {
    // Remove user-owned files before deleting Auth. Database records are removed
    // through FK cascades from auth.users -> profiles and dependent tables.
    for (const bucket of ["avatars", "post-covers", "writer-payment-qr", "feedback-attachments", "team-applications"]) {
      await removeUserFiles(admin, bucket, userId);
    }
  } catch (error) {
    console.error("Account file cleanup failed", error);
    return json(500, { error: "account_cleanup_failed_retry_or_contact_support" });
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("Auth user deletion failed", deleteError);
    return json(500, { error: "account_deletion_failed" });
  }

  return json(200, { success: true });
});
