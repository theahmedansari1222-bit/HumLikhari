/* Shared HTTP helpers for Edge Functions: strict CORS (explicit origin list) and JSON responses. */
const allowedOrigins = (Deno.env.get("HUM_LIKHARI_ALLOWED_ORIGIN") ?? "http://localhost:8080")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  // Echo the caller's origin only when it is on the allow-list; otherwise answer with the primary origin
  // (the browser then blocks the response for any other site).
  const allow = allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatch-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function respond(request: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function preflight(request: Request): Response | null {
  return request.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders(request) }) : null;
}

/** Constant-time string comparison (avoids leaking the secret through response timing). */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
