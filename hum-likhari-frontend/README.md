# ہم لکھاری — فرنٹ اینڈ v1.0.0-rc.1

اردو RTL ویب ایپ (فون فریم میں، 9 تھیمز)۔ **کوئی build step نہیں**: عام `<script>` فائلیں، ES modules نہیں۔ تمام ڈیٹا `HLBackend` (Supabase adapter) سے آتا ہے؛ ڈیمو ڈیٹا ہٹا دیا گیا ہے۔

## چلانا

1. `config.example.js` کو `config.js` بنائیں: صرف `url` اور `publishableKey`۔ placeholder رہنے پر ایپ "ایپ کی ترتیب مکمل نہیں" کی اسکرین دکھاتی ہے اور کہیں رابطہ نہیں کرتی۔
2. کسی static سرور سے سرو کریں (`python3 -m http.server 8080` ریپو روٹ سے، پھر `/hum-likhari-frontend/`)۔ `file://` سے نہ کھولیں (سیشن/OAuth واپسی)۔
3. Production: `../docs/DEPLOYMENT.md` (ہیڈرز، supabase-js vendoring، redirect URLs)۔

## فائلیں

- `index.html` — لوڈ کی ترتیب اور CSP یہیں ہے۔
- `css/` — `themes.css` (رنگ)، `base.css` (فریم)، `components.css`۔
- `js/core/` — `utils` (h/raw/esc، وقت، ٹوسٹ…)، `icons`، `state` (`S`)، `router` (go/back/render/sheets/deep links)، `store` (map/cache/paging/optimistic actions)، `events` (delegated کلک/ان پٹ)، `boot`۔
- `js/content/static.js` — تھیمز، فہرستیں (سروے، رپورٹ کی وجوہات…)، FAQ، **عبوری قانونی متن**۔
- `js/ui/` — `components` (کارڈ، بٹن، ہیڈر)، `payments` (ڈونیٹ/دعوے)، `sheets`۔
- `js/screens/` — `auth`، `feed` (ہوم/تلاش/مضمون)، `write`، `social` (تبصرے/اطلاعات/لوگ)، `profile` (+کراپ)، `settings` (تاریخ/مدد/ٹکٹ/حذف)، `programs` (ٹیم/بیج/پلیٹ فارم)۔
- `js/vendor/supabase-adapter.js` — بیک اینڈ فولڈر والی فائل کی **ہو بہو کاپی**۔

## نئی اسکرین/ایکشن کیسے جوڑیں

اسکرین `R.name = () => h\`…\``؛ بٹن `data-a="action"`؛ `Object.assign(ACT, { action: (el) => guarded("key", el, async () => {…}) })`۔ متن ہمیشہ `h\`\`` کے ذریعے (خودکار escape)؛ `raw()` صرف اپنے تیار کردہ HTML پر۔ `npm run validate` ہر `data-a` کا handler جانچتا ہے۔

## ٹیسٹ

`node tests/e2e/frontend.e2e.mjs` (21 منظرنامے، `ONLY=<نام کا حصہ>` سے ایک)۔
