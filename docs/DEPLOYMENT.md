# ہم لکھاری — Deployment Guide (v1.0.0-rc.1)

> یہ گائیڈ اس ریپو کی چیزیں ایک **نئے Supabase پروجیکٹ** پر لگانے کی ترتیب بتاتی ہے۔ اس ماحول میں حقیقی Supabase پروجیکٹ، Google/SMS فراہم کنندہ، Firebase اور اصل ہوسٹنگ دستیاب نہیں تھے، اس لیے نیچے کے مراحل **لکھے گئے ہیں، چلا کر آزمائے نہیں گئے**۔ پہلے staging پر چلائیں۔

## 1. Supabase پروجیکٹ اور ڈیٹابیس

1. نیا پروجیکٹ بنائیں (staging اور production الگ)۔ Settings ▸ API میں **Exposed schemas** میں صرف `public` رکھیں؛ `private` شامل نہ کریں۔
2. `hum-likhari-backend/` سے link کر کے migrations ترتیب وار لگائیں:
   ```bash
   cd hum-likhari-backend
   supabase link --project-ref <REF>
   supabase db push          # 4 migrations: 20261110… 20261111… 20261112… 20261113…
   ```
   پھر `supabase/seed.sql` (زمرے/موضوعات) Dashboard ▸ SQL Editor میں چلائیں۔ پہلے `supabase db push --dry-run` سے فہرست دیکھ لیں۔ CLI کے کمانڈ نام ورژن کے ساتھ بدل سکتے ہیں، `supabase --help` دیکھیں۔
3. Dashboard ▸ Advisors (Security اور Performance) چلائیں اور تمام انتباہات دیکھیں۔
4. پہلا admin: `hum-likhari-backend/scripts/bootstrap-first-admin.sql` (SQL Editor میں، صرف project owner)۔

## 2. Auth

- **Google**: Google Cloud Console میں OAuth client بنائیں؛ Supabase ▸ Authentication ▸ Providers ▸ Google میں Client ID/Secret ڈالیں؛ Google کے "Authorized redirect URI" میں وہ callback URL ڈالیں جو Supabase دکھاتا ہے۔
- **Redirect URLs** (Authentication ▸ URL Configuration): صارف ایپ کا ڈومین اور admin کا ڈومین دونوں، **عین وہی** جو براؤزر میں کھلتے ہیں (مثلاً `https://app.example.org/` اور `https://admin.example.org/`)۔ Site URL بھی صارف ایپ کا ہو۔ Wildcard نہ لگائیں۔
- **Phone OTP**: ایک SMS فراہم کنندہ (Twilio وغیرہ) فعال کریں؛ پاکستان کے نمبروں پر ڈیلیوری خود آزمائیں۔ OTP کی شرحِ حد (rate limit) سخت رکھیں۔ `supabase/config.toml` میں مقامی ٹیسٹ کے لیے تبصرہ شدہ بلاک موجود ہیں؛ secrets کبھی فائل میں نہ لکھیں۔
- **Staff اکاؤنٹس**: MFA (TOTP) لازمی کریں۔ فون OTP کو staff کا واحد طریقہ نہ رکھیں۔
- `delete-account` کے لیے "حالیہ لاگ اِن" کی حد 15 منٹ ہے (`FRESH_LOGIN_SECONDS`)۔ صارف کو حذف سے پہلے دوبارہ سائن اِن کرنا ہوتا ہے۔

## 3. Edge Functions اور secrets

```bash
cd hum-likhari-backend
supabase secrets set \
  HUM_LIKHARI_ALLOWED_ORIGIN="https://app.example.org,https://admin.example.org" \
  FCM_SERVICE_ACCOUNT_JSON="$(cat firebase-service-account.json)" \
  PUSH_DISPATCH_SECRET="$(openssl rand -hex 32)"
supabase functions deploy delete-account
supabase functions deploy manage-user-role
supabase functions deploy push-dispatch      # config.toml میں verify_jwt = false؛ اجازت کوڈ کے اندر ہے
```

- `HUM_LIKHARI_ALLOWED_ORIGIN` کوما سے الگ **عین origins** کی فہرست ہے؛ `*` قبول نہیں۔
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`/publishable اور service/secret key کو Supabase خود Edge Functions کو دیتا ہے۔ نئے "publishable/secret" کیز استعمال ہوں تو بھی function دونوں نام (`SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`) پڑھتا ہے۔
- Firebase service account JSON صرف secret کے طور پر؛ نہ Git میں نہ براؤزر فائل میں۔

### Push شیڈیولر (ہر منٹ)

`push-dispatch` کو admin کا سیشن یا خفیہ ہیڈر `x-dispatch-secret` چاہیے۔ شیڈیولر کے لیے SQL Editor میں (`<REF>` اور خفیہ قدر بدل کر):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('<وہی PUSH_DISPATCH_SECRET>', 'push_dispatch_secret');

select cron.schedule('hl-push-dispatch', '* * * * *', $$
  select net.http_post(
    url     := 'https://<REF>.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-dispatch-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret')),
    body    := '{"limit":100}'::jsonb,
    timeout_milliseconds := 20000);
$$);
```

اگر آپ کے پروجیکٹ کا gateway functions پر `apikey` ہیڈر مانگے تو publishable key بھی ہیڈرز میں شامل کریں (یہ ہم نے آزما کر تصدیق نہیں کی)۔ ہر قطار پر "lease" لگتی ہے، اس لیے شیڈیولر اور admin کا "فوری بھیجیں" بٹن اکٹھے چلیں تو بھی ایک اطلاع دو بار نہیں جاتی۔ مردہ ٹوکن (`UNREGISTERED`) خود بند ہو جاتے ہیں۔ Lock-screen پر نام/عنوان/رقم کبھی نہیں جاتے، صرف عمومی جملہ۔

## 4. فرنٹ اینڈ (صارف ایپ)

1. `hum-likhari-frontend/config.example.js` کو `config.js` بنائیں: صرف `url` اور `publishableKey`۔ اصل keys والی `config.js` کو Git میں نہ ڈالیں؛ ہوسٹنگ کے build قدم میں بنائیں۔
2. **supabase-js کو اپنے ڈومین سے سرو کریں** (سفارش کردہ) یا SRI لگائیں۔ `index.html` فی الحال `cdn.jsdelivr.net` سے ورژن `2.119.0` لوڈ کرتا ہے (یہی ورژن Edge Functions میں ہے)۔ Vendoring:
   ```bash
   npm pack @supabase/supabase-js@2.119.0 && tar -xzf supabase-supabase-js-2.119.0.tgz package/dist/umd/supabase.min.js
   cp package/dist/umd/supabase.min.js hum-likhari-frontend/js/vendor/supabase.min.js
   # پھر index.html میں src="js/vendor/supabase.min.js" کریں اور CSP سے cdn.jsdelivr.net ہٹا دیں
   ```
   یا SRI: `openssl dgst -sha384 -binary supabase.min.js | openssl base64 -A` اور `<script … integrity="sha384-…" crossorigin="anonymous">`۔
3. `js/vendor/supabase-adapter.js` اور `hum-likhari-backend/integration/supabase-adapter.js` **ایک جیسے** رہنے چاہئیں؛ `npm run validate` یہ جانچتا ہے۔
4. **قانونی متن**: `js/content/static.js` میں "رازداری کی پالیسی" اور "شرائط" **عبوری متن** ہیں۔ لانچ سے پہلے وکیل سے منظور شدہ متن سے بدلیں۔
5. صارف ایپ کی ہوسٹنگ پر یہ HTTP ہیڈرز لگائیں (`<meta>` CSP کے علاوہ؛ `frame-ancestors` صرف header سے چلتا ہے):
   ```
   Strict-Transport-Security: max-age=63072000; includeSubDomains
   X-Content-Type-Options: nosniff
   Referrer-Policy: strict-origin-when-cross-origin
   Permissions-Policy: camera=(), microphone=(), geolocation=()
   Content-Security-Policy: frame-ancestors 'none'
   X-Frame-Options: DENY
   Cache-Control: no-cache            (index.html اور config.js پر)
   ```
   `js/` اور `css/` کے لیے لمبی cache ٹھیک ہے مگر فائل کے نام میں ورژن/ہیش رکھیں۔
6. جانچ: `https://app.example.org/#/` اور گہرے لنک (`#/post/<id>`, `#/u/<username>`) براہِ راست کھل کر کام کریں۔

## 5. Admin پینل

1. `admin/config.example.js` → `config.js` (URL + publishable key)۔
2. **الگ ڈومین** پر ہوسٹ کریں؛ یہی ہیڈرز لگائیں، اور اضافی طور پر `X-Robots-Tag: noindex`۔ اگر ممکن ہو تو IP allow-list یا VPN/SSO کے پیچھے رکھیں۔
3. admin کا origin `HUM_LIKHARI_ALLOWED_ORIGIN` میں شامل ہو، ورنہ کردار بدلنا اور push بھیجنا براؤزر میں بلاک ہوں گے۔
4. "معاونت کے اکاؤنٹس" سیکشن میں پلیٹ فارم کے اصل جاز کیش/ایزی پیسہ/بینک اکاؤنٹ درج کریں اور ایپ میں جا کر دکھنا یقینی بنائیں۔ **غلط اکاؤنٹ = لوگوں کی رقم غلط جگہ۔**

## 6. لانچ سے پہلے (Release gates)

- [ ] staging پر چاروں migrations صاف ڈیٹابیس پر لگیں؛ `supabase test db` پاس (اس ریپو کے pgTAP ٹیسٹ یہاں ایک سادہ stand-in سے چلے ہیں، اصل `pg_prove` سے دوبارہ چلائیں)۔
- [ ] Advisors میں کوئی critical انتباہ باقی نہ ہو۔
- [ ] `docs/TEST_PLAN.md` کی دستی فہرست دو حقیقی اکاؤنٹس (A، B) اور ایک staff اکاؤنٹ سے مکمل۔
- [ ] Google لاگ اِن، فون OTP، تصویر اپ لوڈ، push (Android/iOS/web جو بھی لانچ ہو) حقیقی آلے پر آزمائے گئے۔
- [ ] اکاؤنٹ حذف کرنا ڈسپوزیبل اکاؤنٹ پر آزمایا گیا (Storage فائلیں بھی ہٹتی ہیں)۔
- [ ] قانونی متن بدلا گیا؛ اکاؤنٹ حذف اور ڈیٹا برقرار رکھنے کی پالیسی طے۔
- [ ] Backups/PITR فعال اور بحالی کی مشق ہوئی۔
- [ ] کوئی secret Git کی تاریخ میں نہیں (`git log -p | grep -i secret`)۔
