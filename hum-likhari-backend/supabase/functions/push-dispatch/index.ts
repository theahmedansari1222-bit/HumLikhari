import { createClient } from "@supabase/supabase-js";
import { preflight, respond, safeEqual } from "../_shared/http.ts";

/* Push dispatcher. Two ways to call it:
 *   1. a signed-in admin (manual "send now" from the admin console), or
 *   2. a scheduler (pg_cron + pg_net, see docs/DEPLOYMENT.md) that sends the shared secret in `x-dispatch-secret`.
 * The gateway-level JWT check is disabled for this function (config.toml) because scheduler calls do not carry a user JWT
 * and the new publishable/secret API keys are not JWTs; authorisation is enforced here instead. */

let cachedAccessToken: { value: string; expiresAt: number } | null = null;
const enc = new TextEncoder();
const b64url = (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? enc.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

async function firebaseAccessToken(serviceAccount: Record<string, string>): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const pem = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned)));
  const assertion = `${unsigned}.${b64url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`firebase_oauth_failed_${response.status}`);
  const payload = await response.json();
  cachedAccessToken = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 };
  return cachedAccessToken.value;
}

/* Lock-screen copy is deliberately generic: no names, titles or amounts leave the database through FCM. */
function notificationCopy(eventType: string): [string, string] {
  const copy: Record<string, [string, string]> = {
    post_like: ["ہم لکھاری", "کسی نے آپ کی تحریر پسند کی ہے۔"],
    comment: ["ہم لکھاری", "آپ کی تحریر پر نیا تبصرہ آیا ہے۔"],
    new_follower: ["ہم لکھاری", "ایک نئے قاری نے آپ کو فالو کیا ہے۔"],
    writer_support: ["ہم لکھاری", "آپ کے لیے تعاون بھیجنے کی اطلاع درج ہوئی ہے۔"],
    ticket_reply: ["مدد کی درخواست کا جواب", "آپ کی درخواست پر نیا جواب موجود ہے۔"],
    badge_update: ["لکھاری بیج کی درخواست", "آپ کی بیج درخواست کی حالت تبدیل ہوئی ہے۔"],
    team_update: ["ہماری ٹیم", "آپ کی ٹیم میں شمولیت کی درخواست اپ ڈیٹ ہوئی ہے۔"],
    platform_donation_update: ["ہم لکھاری", "آپ کی معاونت کی اطلاع اپ ڈیٹ ہوئی ہے۔"],
    content_removed: ["ہم لکھاری", "آپ کا ایک مواد ہٹا دیا گیا ہے۔ تفصیل ایپ میں دیکھیں۔"],
    system: ["ہم لکھاری", "آپ کے لیے ایک نئی اطلاع ہے۔"],
  };
  return copy[eventType] ?? copy.system;
}

const LEASE_MS = 5 * 60_000;       // a claimed delivery is invisible to other runs for this long
const MAX_ATTEMPTS = 8;
const PARALLEL = 10;

Deno.serve(async (request: Request) => {
  const json = (status: number, body: Record<string, unknown>) => respond(request, status, body);
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  const accountText = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  const dispatchSecret = Deno.env.get("PUSH_DISPATCH_SECRET") ?? "";
  if (!url || !publicKey || !serviceKey || !accountText) return json(500, { error: "push_service_not_configured" });

  // ---- authorisation: scheduler secret OR signed-in admin ------------------------------------------------
  const presentedSecret = request.headers.get("x-dispatch-secret") ?? "";
  let authorised = dispatchSecret.length >= 24 && presentedSecret.length > 0 && safeEqual(presentedSecret, dispatchSecret);
  if (!authorised) {
    const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(401, { error: "missing_credentials" });
    const caller = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userResult, error: userError } = await caller.auth.getUser(token);
    if (userError || !userResult.user) return json(401, { error: "invalid_session" });
    const { data: isAdmin, error: roleError } = await caller.rpc("is_admin");
    if (roleError || isAdmin !== true) return json(403, { error: "admin_only" });
    authorised = true;
  }

  let requestedLimit = 50;
  try {
    const body = await request.json();
    if (body?.limit !== undefined) requestedLimit = Math.max(1, Math.min(100, Number(body.limit) || 50));
  } catch { /* an empty body is valid */ }

  let serviceAccount: Record<string, string>;
  try { serviceAccount = JSON.parse(accountText); }
  catch { return json(500, { error: "invalid_fcm_service_account_json" }); }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    return json(500, { error: "invalid_fcm_service_account_fields" });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: queue, error: queueError } = await admin.from("push_deliveries")
    .select("id,attempts,device:push_devices!inner(id,device_token,platform,enabled),notification:notifications!inner(id,event_type,post_id,comment_id,ticket_id)")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(requestedLimit);
  if (queueError) return json(500, { error: "queue_read_failed" });
  if (!queue?.length) return json(200, { processed: 0, sent: 0, failed: 0, skipped: 0 });

  let accessToken: string;
  try { accessToken = await firebaseAccessToken(serviceAccount); }
  catch (error) { console.error("FCM token exchange failed", error); return json(502, { error: "fcm_auth_failed" }); }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`;
  const totals = { sent: 0, failed: 0, skipped: 0 };

  async function deliver(item: any) {
    // Claim the row atomically: only the run that moves next_attempt_at forward may send it, so two overlapping
    // runs (cron + manual) can never deliver the same notification twice.
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin.from("push_deliveries")
      .update({ next_attempt_at: new Date(Date.now() + LEASE_MS).toISOString(), updated_at: nowIso })
      .eq("id", item.id).in("status", ["pending", "failed"]).lte("next_attempt_at", nowIso).select("id");
    if (claimError || !claimed?.length) { totals.skipped++; return; }

    const device = Array.isArray(item.device) ? item.device[0] : item.device;
    const notification = Array.isArray(item.notification) ? item.notification[0] : item.notification;
    if (!device?.enabled || !device?.device_token) {
      await admin.from("push_deliveries").update({ status: "cancelled", last_error: "device_disabled", updated_at: nowIso }).eq("id", item.id);
      totals.skipped++;
      return;
    }
    const [title, body] = notificationCopy(notification?.event_type || "system");
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: {
          token: device.device_token,
          notification: { title, body },
          data: {
            event_type: String(notification?.event_type || "system"),
            notification_id: String(notification?.id || ""),
            post_id: String(notification?.post_id || ""),
            comment_id: String(notification?.comment_id || ""),
            ticket_id: String(notification?.ticket_id || ""),
          },
        } }),
      });
    } catch (error) {
      console.error("FCM request failed", error);
      await admin.from("push_deliveries").update({
        attempts: Number(item.attempts || 0) + 1, last_error: "network_error",
        status: "failed", next_attempt_at: new Date(Date.now() + 60_000).toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      totals.failed++;
      return;
    }
    const responseBody = await response.json().catch(() => ({}));
    const attempts = Number(item.attempts || 0) + 1;
    if (response.ok) {
      await admin.from("push_deliveries").update({
        status: "sent", attempts, provider_message_id: responseBody.name || null, last_error: null, updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      totals.sent++;
      return;
    }
    const errorCode = responseBody?.error?.details?.[0]?.errorCode || responseBody?.error?.status || `http_${response.status}`;
    if (errorCode === "UNREGISTERED" || errorCode === "NOT_FOUND") {
      await admin.from("push_devices").update({ enabled: false }).eq("id", device.id);   // token is dead; stop sending to it
    }
    const permanent = errorCode === "UNREGISTERED" || errorCode === "NOT_FOUND" || attempts >= MAX_ATTEMPTS;
    await admin.from("push_deliveries").update({
      status: permanent ? "cancelled" : "failed",
      attempts,
      last_error: String(errorCode).slice(0, 500),
      next_attempt_at: new Date(Date.now() + Math.min(6 * 60 * 60_000, 60_000 * 2 ** attempts)).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    totals.failed++;
  }

  const items = queue as any[];
  for (let i = 0; i < items.length; i += PARALLEL) await Promise.all(items.slice(i, i + PARALLEL).map(deliver));
  return json(200, { processed: items.length, ...totals });
});
