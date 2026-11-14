/** Unix time (seconds) at which the user last authenticated, or null when it cannot be determined.
 * Supabase access tokens carry no `auth_time` claim; the real sign-in times are in the `amr` claim
 * (one entry per authentication method, each with a timestamp) and in `last_sign_in_at`. Token refreshes
 * change neither, so a stolen, silently refreshed session cannot pass as a fresh login. */
export function lastAuthenticatedAt(
  claims: Record<string, unknown> | null | undefined,
  lastSignInAt: string | null | undefined,
): number | null {
  const stamps: number[] = [];
  const amr = claims?.amr;
  if (Array.isArray(amr)) {
    for (const entry of amr) {
      const t = Number((entry as { timestamp?: unknown })?.timestamp);
      if (Number.isFinite(t) && t > 0) stamps.push(t);
    }
  }
  const authTime = Number(claims?.auth_time);
  if (Number.isFinite(authTime) && authTime > 0) stamps.push(authTime);
  if (lastSignInAt) {
    const t = Date.parse(lastSignInAt) / 1000;
    if (Number.isFinite(t) && t > 0) stamps.push(t);
  }
  return stamps.length ? Math.max(...stamps) : null;
}
