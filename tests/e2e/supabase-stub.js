/* Minimal stand-in for the supabase-js UMD bundle: just enough for the real adapter's configure(). */
window.supabase = { createClient() {
  return {
    auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, getSession: async () => ({ data: { session: null }, error: null }) },
    storage: { from(bucket) { return { getPublicUrl(p) { return { data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/" + bucket + "/" + p } }; } }; } },
  };
} };
