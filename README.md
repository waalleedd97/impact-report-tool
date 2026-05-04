# أداة تقرير قياس الأثر

تطبيق محلي لتعبئة وتوليد تقرير قياس أثر بعدي لنشاط تطوير مهني من ملف PDF مرجعي، مع حفظ الأسماء والتقارير حسب البريد.

## التشغيل

1. ثبت الحزم:

```bash
pnpm install
```

2. انسخ ملف البيئة وضع مفتاح DeepSeek:

```bash
cp .env.example .env
```

ثم عدل `.env`:

```bash
DEEPSEEK_API_KEY=ضع_المفتاح_هنا
DEEPSEEK_MODEL=deepseek-v4-flash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ASSETS_BUCKET=smart-editor-assets
SUPABASE_DATA_BUCKET=smart-editor-data
SUPABASE_DATA_MODE=storage
```

3. شغل التطبيق:

```bash
pnpm dev
```

افتح `http://localhost:5173`.

## الاستخدام

- الدخول بالبريد فقط.
- رفع PDF أول مرة لاستخراج أسماء المعلمات والقالب.
- مراجعة الأسماء يدوياً من تبويب المعلمات.
- إدخال عنوان النشاط واختيار مستوى النسبة ثم توليد التقرير.
- الحفظ يخزن التقرير في Supabase عند ضبط متغيرات Supabase، وإلا يستخدم SQLite محلياً داخل `data/app.db`.
- الطباعة من زر طباعة تحفظ التقرير PDF من المتصفح.

## Supabase

1. أنشئ مشروع Supabase.
2. أضف المتغيرات التالية محلياً وفي Vercel:

```bash
SUPABASE_URL=رابط_مشروع_Supabase
SUPABASE_SERVICE_ROLE_KEY=service_role_key
SUPABASE_PUBLISHABLE_KEY=publishable_key
SUPABASE_ASSETS_BUCKET=smart-editor-assets
SUPABASE_DATA_BUCKET=smart-editor-data
SUPABASE_DATA_MODE=storage
```

الوضع الافتراضي `SUPABASE_DATA_MODE=storage` يحفظ الملفات الشخصية والتقارير كملفات JSON خاصة داخل Supabase Storage، ولا يحتاج إنشاء جداول يدوياً. إذا رغبت لاحقاً باستخدام Postgres بدلاً من Storage، شغل محتوى `supabase/schema.sql` داخل SQL Editor ثم غيّر `SUPABASE_DATA_MODE` إلى `postgres`.

3. لترحيل بيانات SQLite الحالية إلى Supabase:

```bash
pnpm migrate:supabase
```

الخادم يستخدم مفتاح `service_role` من جهة الخادم فقط، ولا يرسله للمتصفح. مفتاح `publishable` وحده لا يكفي للحفظ الدائم لأن الجداول والتخزين تعمل من الخادم.

## النشر التجريبي على Vercel

المشروع مهيأ للنشر على Vercel عبر `vercel.json`. يعمل الخادم كدالة Serverless من `api/index.ts`.

ملاحظة مهمة: بدون متغيرات Supabase ستستخدم نسخة Vercel مساحة مؤقتة داخل `/tmp`. بعد ضبط Supabase تصبح الملفات الشخصية والتقارير وقوالب PDF المستوردة محفوظة في Supabase.
