# ہم لکھاری — پلیٹ فارم v1.0.0-rc.1 (Release Candidate)

اردو لکھاریوں کا پلیٹ فارم: **صارف ایپ** (RTL فرنٹ اینڈ، 9 تھیمز)، **Supabase بیک اینڈ** (Postgres + RLS + Storage + Edge Functions + Auth)، اور **اسٹاف کنسول**۔ v0.2.0 میں فرنٹ اینڈ ڈیمو ڈیٹا پر چلتا تھا؛ اب ہر اسکرین حقیقی بیک اینڈ سے جڑی ہے اور بیک اینڈ میں دریافت شدہ حفاظتی خامیاں دور کی گئی ہیں (تفصیل: `CHANGELOG.md`، `docs/REVIEW_REPORT.md`)۔

## شروع کرنا

```bash
npm test            # static جانچ + Node ٹیسٹ (فوری)
npm run test:e2e    # Playwright: صارف ایپ (21)، admin (17) اور ڈیزائن فائلوں کی جانچ (59 نکات)
```
1. `docs/DEPLOYMENT.md` — پروجیکٹ، Auth، Edge Functions، push شیڈیولر، ہیڈرز، supabase-js vendoring۔
2. `hum-likhari-frontend/config.example.js` اور `admin/config.example.js` کو `config.js` بنائیں (صرف URL + publishable key)۔
3. `hum-likhari-backend/README.md` — migrations، adapter، functions۔
4. `docs/TEST_PLAN.md` — خودکار اور دستی ٹیسٹ۔

## ڈھانچہ

| فولڈر | کام |
|---|---|
| `hum-likhari-frontend/` | صارف ایپ (classic scripts، کوئی build step نہیں) |
| `hum-likhari-backend/` | 4 migrations، pgTAP ٹیسٹ، Edge Functions، `integration/supabase-adapter.js` |
| `admin/` | اسٹاف کنسول (static) |
| `integration/` | بیک اینڈ smoke-test صفحہ (ہاتھ سے آزمانے کے لیے) |
| `design/` | `HumLikhari_app_design_v1.html` (اصل ڈیزائن + کوڈ کی اضافی اسکرینیں) اور `HumLikhari_admin_preview.html` (حقیقی admin کوڈ، نمونہ ڈیٹا؛ `?role=admin ، moderator ، support_agent`؛ `npm run build:admin-preview` سے دوبارہ بنتا ہے) |
| `tests/`, `scripts/` | Node ٹیسٹ، ویلیڈیٹر، Playwright e2e |
| `docs/` | معماری، ٹیسٹ منصوبہ، deployment، جائزہ رپورٹ |

## کیا تصدیق شدہ ہے اور کیا نہیں

| چیز | حالت |
|---|---|
| 4 migrations حقیقی PostgreSQL 16 پر صاف لگتی ہیں؛ 119 ٹیسٹ پاس | ✅ (Supabase کی جگہ stub اسکیما اور سادہ pgTAP stand-in) |
| صارف ایپ 21 اور admin 17 end-to-end منظرنامے (in-memory mock کے خلاف) | ✅ |
| Node ٹیسٹ، static ویلیڈیشن | ✅ |
| حقیقی Supabase (Auth، Storage، PostgREST کا embed/filter نحو، publishable key) | ⚠️ **آزمایا نہیں** — staging پر لازماً آزمائیں |
| Google OAuth، SMS OTP، Firebase/FCM push | ⚠️ آزمایا نہیں (فراہم کنندہ درکار) |
| Edge Functions Deno پر | ⚠️ صرف syntax/منطق (Node سے)؛ Deno پر deploy نہیں ہوئے |
| قانونی متن (رازداری/شرائط) | ⚠️ عبوری، وکیل سے بدلوائیں |
| لوڈ ٹیسٹ، penetration ٹیسٹ، ایپ اسٹور/ادائیگی قوانین کا جائزہ | ❌ نہیں ہوئے |

## پیسوں کے بارے میں حدود

- **لکھاری کو تعاون**: براہِ راست P2P؛ "میں نے بھیج دیا" صرف بھیجنے والے کا دعویٰ ہے، تصدیق نہیں۔
- **پلیٹ فارم معاونت**: صرف پاکستان/PKR کا **دستی** ریکارڈ، کوئی gateway یا خودکار تصدیق نہیں۔ رقم منتقل نہیں ہوتی۔
