"use strict";
/* Static copy and option lists. Edit text here; nothing in this file talks to the network. */
const THEMES = [
  ["auto", "خودکار", "linear-gradient(135deg,#fff 50%,#0a0a0a 50%)"], ["light", "سفید", "#fff", "#0a0a0a"], ["dark", "کالا", "#000", "#fff"],
  ["cream", "کریمی", "#f7f0e0", "#5a4630"], ["green", "سبز", "#f1f7f2", "#1f6b3a"], ["yellow", "پیلا", "#fdf7d8", "#8a6500"],
  ["blue", "نیلا", "#f0f6fe", "#1a56c4"], ["pink", "گلابی", "#fff1f5", "#c2185b"], ["orange", "اورنج", "#fff4e8", "#c2500a"],
];
const SURVEY_SOURCES = [
  ["facebook", "فیس بک"], ["instagram", "انسٹاگرام"], ["youtube", "یوٹیوب"], ["whatsapp", "واٹس ایپ"], ["tiktok", "ٹک ٹاک"],
  ["google_search", "گوگل سرچ"], ["friend_family", "دوست یا رشتہ دار"], ["literary_community", "ادبی حلقہ یا کمیونٹی"],
  ["website_blog", "ویب سائٹ یا بلاگ"], ["advertisement", "اشتہار"], ["other", "کوئی اور"],
];
const REPORT_REASONS = [
  ["spam", "اسپام یا اشتہار"], ["harassment", "ہراسانی یا دھمکی"], ["hate", "نفرت انگیز مواد"],
  ["plagiarism", "دوسرے کی تحریر چوری"], ["inappropriate", "نامناسب مواد"], ["other", "کوئی اور وجہ"],
];
const FEEDBACK_TYPES = [["question", "سوال"], ["suggestion", "تجویز"], ["bug", "خرابی کی اطلاع"], ["complaint", "شکایت"]];
const TEAM_AREAS = [
  ["proofreading", "پروف ریڈنگ"], ["editing", "ایڈیٹنگ"], ["translation", "ترجمہ"], ["design", "ڈیزائن"], ["development", "ڈیولپمنٹ"],
  ["community", "کمیونٹی مینجمنٹ"], ["promotion", "پروموشن"], ["research", "تحقیق"], ["other", "کوئی اور"],
];
const BADGE_TYPES = [["consistent_writer", "مستقل مزاج لکھاری"], ["featured_writer", "نمایاں لکھاری"]];
const BADGE_HELP = {
  consistent_writer: "باقاعدگی سے معیاری تحریریں شائع کرنے والوں کے لیے۔",
  featured_writer: "اعلیٰ معیار کے کام پر ٹیم کی طرف سے نمایاں کیے گئے لکھاریوں کے لیے۔",
};
const METHOD_LABEL = { jazzcash: "جاز کیش", easypaisa: "ایزی پیسہ", bank_transfer: "بینک اکاؤنٹ" };
const STATUS_TEXT = {
  ticket: { received: "موصول", in_review: "زیرِ جائزہ", resolved: "حل ہو گیا", closed: "بند" },
  team: { received: "موصول", in_review: "زیرِ جائزہ", accepted: "منظور", declined: "مسترد", withdrawn: "واپس لی گئی" },
  badge: { received: "موصول", in_review: "زیرِ جائزہ", approved: "منظور", declined: "مسترد", withdrawn: "واپس لی گئی" },
  platform: { submitted: "جمع ہو گئی", under_review: "زیرِ جائزہ", confirmed: "تصدیق ہو گئی", rejected: "مسترد" },
  claim: { sender_reported_sent: "بھیجنے والے نے اطلاع دی", creator_acknowledged: "لکھاری نے وصولی کی تصدیق کی", cancelled: "منسوخ" },
};
const statusTone = (s) => (/accepted|approved|confirmed|resolved|acknowledged/.test(s) ? "ok" : /declined|rejected|cancelled|withdrawn/.test(s) ? "bad" : "");
const labelOf = (list, key) => { const x = list.find((o) => o[0] === key); return x ? x[1] : key; };

const FAQ = [
  ["تحریر کیسے شائع کروں؟", "نیچے درمیان میں + دبائیں، عنوان اور متن لکھیں اور اوپر شائع کریں پر ٹیپ کریں۔ واپس جانے پر مسودہ خود محفوظ ہو جاتا ہے۔"],
  ["تعاون کیسے وصول ہوتا ہے؟", "پروفائل ایڈٹ میں جاز کیش اور ایزی پیسہ کا QR اور بینک کی تفصیل لگائیں۔ قاری آپ کے اپنے اکاؤنٹ میں رقم بھیجتا ہے۔ ایپ رقم اپنے پاس نہیں رکھتی، صرف بھیجنے والے کی دی ہوئی اطلاع محفوظ کرتی ہے۔"],
  ["کسی تحریر یا تبصرے کی رپورٹ کیسے کروں؟", "تحریر پر تین نقطوں سے رپورٹ چنیں۔ تبصرے کے نیچے رپورٹ کا بٹن ہے۔"],
  ["کسی کو بلاک کیسے کروں؟", "اس کی تحریر یا پروفائل پر تین نقطوں سے بلاک چنیں۔ بلاک کیے گئے لوگوں کی فہرست ترتیبات میں ہے، وہاں سے ان بلاک بھی ہو سکتا ہے۔"],
  ["اپنا اکاؤنٹ کیسے ڈیلیٹ کروں؟", "ترتیبات کھولیں اور اکاؤنٹ ڈیلیٹ کریں پر ٹیپ کریں۔ حفاظت کے لیے حال ہی میں سائن اِن ہونا ضروری ہے۔"],
];
/* PLACEHOLDER legal copy: must be replaced with text approved by your legal adviser before launch. */
const LEGAL = {
  t: ["شرائط و ضوابط", [
    "آپ اپنی شائع کی ہوئی تحریروں کے خود ذمہ دار ہیں۔",
    "نفرت، دھمکی اور دوسروں کی تحریر چرانا منع ہے۔ ایسی تحریر ہٹائی جا سکتی ہے۔",
    "تعاون قارئین اور لکھاری کے درمیان براہ راست ہوتا ہے، ایپ اس کی ضمانت نہیں دیتی۔",
    "خلاف ورزی پر اکاؤنٹ معطل یا بند کیا جا سکتا ہے۔"]],
  p: ["پرائیویسی پالیسی", [
    "ہم آپ کا نام، ہینڈل، تصویر اور تعارف محفوظ کرتے ہیں۔",
    "آپ کی تعاون کی تفصیل (QR اور بینک) صرف اسی وقت دکھائی جاتی ہے جب آپ اسے عوامی کریں اور کوئی تعاون کرنا چاہے۔",
    "فون نمبر صرف لاگ اِن کی تصدیق کے لیے استعمال ہوتا ہے اور دوسروں کو نہیں دکھایا جاتا۔",
    "اکاؤنٹ ڈیلیٹ کرنے پر آپ کی تحریریں اور ڈیٹا حذف کر دیا جاتا ہے۔"]],
};
