"use strict";
/* Start-up: preferences, backend configuration, session restore, first screen. Runs last. */
async function boot() {
  loadPrefs();
  S.online = navigator.onLine !== false;
  S.ptab = 0; S.fq = -1; S.ht = 0; S.otpLeft = 0; S.helpFile = null;

  const cfg = window.HL_BACKEND_CONFIG || {};
  if (!cfg.url || !cfg.publishableKey || /YOUR_PROJECT|REPLACE_ME/i.test(cfg.url + cfg.publishableKey)) {
    S.cfgError = "ایپ کی ترتیب مکمل نہیں۔ config.js میں Supabase کا URL اور publishable key درج کریں۔";
  } else {
    try { BE().configure({ url: cfg.url, publishableKey: cfg.publishableKey }); }
    catch (e) { S.cfgError = errText(e); }
  }

  const query = new URLSearchParams(location.search);
  const authProblem = query.get("error_description") || (query.get("error") ? "سائن اِن مکمل نہیں ہو سکا۔ دوبارہ کوشش کریں۔" : "");
  let bootProblem = "";
  if (!S.cfgError) {
    try {
      const data = await BE().auth.getSession();
      if (data.session) await handleSession(data.session);
    } catch (e) { bootProblem = errText(e); }
    BE().auth.onChange(onAuthEvent);
  }
  if (query.has("code") || query.has("error") || query.has("error_description")) {
    try { history.replaceState(null, "", location.pathname + location.hash); } catch (_) { /* sandboxed */ }
  }

  S.booted = true;
  const target = parseHash(location.hash);
  if (S.suspended) go("suspended");
  else if (target) go(target[0], target[1]);
  else if (S.user) { if (needsOnboarding()) go("interests", { onboarding: true }); else go("home"); }
  else go("splash");
  if (authProblem || bootProblem) toast(authProblem || bootProblem);
  if (S.user) flushDraftNow();
}
boot();
