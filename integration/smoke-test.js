(() => {
  const $ = (s) => document.querySelector(s);
  const uploads = { feedback: null, team: null, qr: null, cover: null };
  const out = (value) => { $("#output").textContent = typeof value === "string" ? value : JSON.stringify(value,null,2); };
  const run = async (label, fn) => {
    out(`${label}: running…`);
    try { const result = await fn(); out({ok:true,label,result}); if (result?.id && label.includes("draft")) $("#postId").value = result.id; }
    catch (error) { out({ok:false,label,error:error.message || String(error),code:error.code || null}); }
  };
  const client = () => { if (!window.HLBackend) throw new Error("Adapter ابھی load نہیں ہوا۔"); return window.HLBackend; };
  const testPost = () => { const id = $("#postId").value.trim(); if (!id) throw new Error("پہلے Post UUID درج کریں۔"); return id; };
  const targetUser = () => { const id = $("#targetUserId").value.trim(); if (!id) throw new Error("پہلے Target User UUID درج کریں۔"); return id; };
  const file = (id) => { const selected = $(id).files?.[0]; if (!selected) throw new Error("پہلے فائل منتخب کریں۔"); return selected; };
  $("#connect").addEventListener("click", () => run("کنکشن", async () => {
    const cfg = window.HL_BACKEND_CONFIG || {};
    client().configure({url:cfg.url,publishableKey:cfg.publishableKey});
    const session = await client().auth.getSession();
    $("#authState").textContent = session?.session?.user ? `Signed in: ${session.session.user.id}` : "Project connected؛ login درکار ہے۔";
    return {configured:true,session};
  }));
  $("#google").addEventListener("click", () => run("Google sign-in", () => client().auth.signInWithGoogle(location.href)));
  $("#signout").addEventListener("click", () => run("Sign out", () => client().auth.signOut()));
  $("#sendOtp").addEventListener("click", () => run("OTP", () => client().auth.sendPhoneCode($("#phone").value.trim())));
  $("#verifyOtp").addEventListener("click", () => run("OTP verification", () => client().auth.verifyPhoneCode($("#phone").value.trim(),$("#otp").value.trim())));

  const actions = {
    profile: () => client().profiles.mine(),
    feed: () => client().posts.feed({limit:10}),
    draft: () => client().posts.saveDraft({title:`ٹیسٹ مسودہ ${new Date().toISOString()}`,body:"یہ صرف development environment کے لیے ٹیسٹ مسودہ ہے۔",category:"مضمون",topic:"ادب"}),
    publish: () => client().posts.publish({title:`ٹیسٹ تحریر ${new Date().toISOString()}`,body:"یہ ایک عارضی ٹیسٹ تحریر ہے جسے بعد میں حذف کیا جا سکتا ہے۔",category:"مضمون",topic:"ادب",coverImagePath:uploads.cover}),
    search: () => client().posts.search({query:"اردو",limit:10}),
    notifications: () => client().notifications.list({limit:20}),
    like: () => client().social.like(testPost()),
    unlike: () => client().social.unlike(testPost()),
    comment: () => client().comments.add({postId:testPost(),body:"یہ بیک اینڈ ٹیسٹ تبصرہ ہے۔"}),
    bookmark: () => client().social.bookmark(testPost()),
    unbookmark: () => client().social.unbookmark(testPost()),
    follow: () => client().social.follow(targetUser()),
    block: () => client().social.block(targetUser()),
    report: () => client().social.report({targetType:"post",postId:testPost(),reason:"other",details:"Development test report."}),
    uploadAvatar: () => client().profiles.uploadAvatar(file("#avatarFile")),
    uploadCover: async () => { const result=await client().posts.uploadCover(file("#coverFile")); uploads.cover=result.path; return result; },
    uploadFeedback: async () => { uploads.feedback=await client().feedback.uploadAttachment(file("#feedbackFile")); return {path:uploads.feedback}; },
    uploadTeam: async () => { uploads.team=await client().team.uploadAttachment(file("#teamFile")); return {path:uploads.team}; },
    uploadQr: async () => { uploads.qr=await client().writerSupport.uploadQr(file("#qrFile")); return {path:uploads.qr}; },
    ticket: () => client().feedback.submit({type:"suggestion",message:"یہ development smoke test کے لیے فیڈبیک ٹکٹ ہے۔",attachmentPath:uploads.feedback}),
    survey: () => client().onboarding.submitAcquisitionSource("google_search"),
    team: () => client().team.apply({area:"proofreading",skills:"اردو پروف ریڈنگ",availability:"ہفتے میں دو گھنٹے",motivation:"میں اردو تحریروں کی پروف ریڈنگ میں رضاکارانہ مدد کرنا چاہتا/چاہتی ہوں۔",countryCode:"PK",attachmentPath:uploads.team}),
    badge: () => client().badges.apply({badgeType:"consistent_writer",portfolioNote:"Development environment badge application test."}),
    donation: () => client().platformDonations.submit({amount:100,method:"bank_transfer",transactionReference:"TEST-NOT-PAID",note:"یہ صرف ٹیسٹ ہے، ادائیگی نہیں کی گئی۔"}),
    platformAccounts: () => client().platformDonations.accounts(),
    history: async () => ({team:await client().team.mine(),badges:await client().badges.mine(),donations:await client().platformDonations.mine(),tickets:await client().feedback.mine(),writerSupport:await client().writerSupport.history()}),
    writerSupportOptions: () => client().writerSupport.publicOptions(targetUser()),
    saveWriterOption: async () => {
      const result=await client().writerSupport.saveOption({method:"bank_transfer",bankName:"TEST BANK",accountTitle:"Development Test",accountIdentifier:"TEST-ONLY-NOT-A-REAL-IBAN",isPublic:true,isActive:true});
      $("#paymentOptionId").value=result.id; return result;
    },
    writerSupportClaim: () => client().writerSupport.createTransferClaim({creatorId:targetUser(),paymentOptionId:$("#paymentOptionId").value.trim(),amount:100,note:"TEST ONLY - no real money transferred"}),
    registerPush: () => client().push.register({token:$("#fcmToken").value.trim(),platform:$("#pushPlatform").value,deviceLabel:"Smoke test device"}),
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-test]"); if (!b) return;
    const name=b.dataset.test;
    if (!actions[name]) return;
    run(name,actions[name]);
  });
})();
