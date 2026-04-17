# ملخص إصلاح مشكلة الاتصال بـ Azure SQL Database

## تاريخ الإصلاح
2026-04-17

---

## المشكلة الأصلية
- الواجهة تفتح عادي لكن عند تسجيل الدخول تظهر رسالة timeout
- الاتصال بـ `hawaisqltarek2026.database.windows.net:1433` يفشل
- قاعدة البيانات Azure SQL Free/Serverless تأخذ وقت للاستيقاظ (cold start)
- كان الاتصال يفتح connection جديد لكل request بدون retry logic

---

## الملفات التي تم تعديلها

### 1. `src/lib/db.ts` (تغيير جوهري)
**المشاكل التي تم إصلاحها:**
- ❌ `connectionTimeout: 15000` → ✅ `connectionTimeout: 60000`
- ❌ `requestTimeout: 30000` → ✅ `requestTimeout: 60000`
- ❌ `encrypt: process.env.DB_ENCRYPT === 'true'` → ✅ `encrypt: true` (مطلوب لـ Azure)
- ❌ `trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'` → ✅ `trustServerCertificate: false` (مطلوب لـ Azure)
- ❌ Pool صغير: `{ max: 5, min: 0 }` → ✅ Pool محسّن: `{ max: 10, min: 2 }` مع إعدادات إضافية
- ❌ No retry logic → ✅ Retry logic ذكي: 3 محاولات مع delay 3 ثواني
- ❌ لا يوجد getUserFriendlyError → ✅ دالة لتحويل أخطاء قاعدة البيانات لرسائل صديقة للمستخدم

**التغييرات التقنية:**
- استخدام `poolPromise` pattern للـ singleton connection
- إضافة معالجة أخطاء الـ pool مع إعادة الاتصال
- إضافة دالة `closePool()` للـ cleanup

---

### 2. `src/app/api/auth/login/route.ts`
- ✅ إضافة `export const runtime = 'nodejs'`
- ✅ استخدام `getUserFriendlyError` لعرض رسائل صديقة للمستخدم
- ✅ تسجيل الأخطاء الحقيقية في الـ server logs فقط

### 3. `src/app/api/auth/session/route.ts`
- ✅ إضافة `export const runtime = 'nodejs'`
- ✅ استخدام `getUserFriendlyError` لتحسين رسائل الخطأ

### 4. `src/app/api/users/route.ts`
- ✅ إضافة `export const runtime = 'nodejs'`
- ✅ تحديث error handling لاستخدام `getUserFriendlyError`

### 5. `src/app/api/shifts/route.ts`
- ✅ إضافة `export const runtime = 'nodejs'`

### 6. `src/app/api/sales/route.ts`
- ✅ إضافة `export const runtime = 'nodejs'`

### 7. `src/components/auth/LoginForm.tsx`
- ✅ تحسين رسائل الخطأ:
  - "خطأ في تسجيل الدخول" → "تعذر الاتصال بالخادم، حاول مرة أخرى"
  - "خطأ في الاتصال بالخادم" → "تعذر الاتصال بالخادم، يرجى التحقق من الإنترنت والمحاولة مرة أخرى"

---

### 8. `src/app/api/health/db/route.ts` (ملف جديد)
- ✅ endpoint للتشخيص: `GET /api/health/db`
- ✅ يختبر الاتصال بقاعدة البيانات ويعرض:
  - status: healthy/unhealthy
  - responseTimeMs
  - serverVersion
  - timestamp

---

### 9. `.env.local` (ملف جديد للتطوير المحلي)
```env
DB_SERVER=hawaisqltarek2026.database.windows.net
DB_NAME=HawaiDB
DB_USER=hawai
DB_PASSWORD=your_password_here
```

---

## ما الذي تم عمله بالضبط؟

### 1. إصلاح إعدادات Azure SQL
- `encrypt: true` - مطلوب لجميع اتصالات Azure SQL
- `trustServerCertificate: false` - أمان أفضل
- timeouts 60 ثانية - للتعامل مع cold start

### 2. Connection Pooling محسّن
```typescript
pool: {
  max: 10,                    // زيادة الـ connections
  min: 2,                     // keeping دائمًا connections نشطة
  acquireTimeoutMillis: 60000,
  createTimeoutMillis: 60000,
  createRetryIntervalMillis: 2000,
}
```

### 3. Retry Logic ذكي
```typescript
async function connectWithRetry(attempt = 1): Promise<sql.ConnectionPool> {
  try {
    return await sql.connect(config);
  } catch (err) {
    if (attempt < RETRY_MAX_ATTEMPTS) {
      await delay(RETRY_DELAY_MS);  // 3 seconds
      return connectWithRetry(attempt + 1);
    }
    throw new Error('تعذر الاتصال بالخادم بعد عدة محاولات');
  }
}
```

### 4. Node.js Runtime
- جميع API routes التي تستخدم قاعدة البيانات الآن تستخدم `runtime = 'nodejs'`
- هذا يمنع تشغيل الكود على edge runtime (الذي لا يدعم mssql بشكل كامل)

### 5. Error Handling محسّن
```typescript
// Server-side: تسجيل التفاصيل الكاملة
console.error('[auth/login] error:', rawMessage);

// Client-side: رسالة صديقة فقط
return NextResponse.json({ 
  error: 'تعذر الاتصال بالخادم، حاول مرة أخرى' 
}, { status: 500 });
```

---

## التعليمات للنشر على Vercel

### 1. Environment Variables على Vercel
تأكد من إضافة هذه المتغيرات في Vercel Dashboard:
```
DB_SERVER=hawaisqltarek2026.database.windows.net
DB_NAME=HawaiDB
DB_USER=hawai
DB_PASSWORD=your_actual_password
```

### 2. اختبار الـ Health Check
بعد النشر، اختبر الاتصال بـ:
```
https://your-domain.vercel.app/api/health/db
```

### 3. مراقبة الـ Logs
في Vercel Dashboard > Logs، راقب رسائل:
- `[db] Connection attempt 1/3...`
- `[db] Connected to SQL Server successfully`
- `[db] Retrying in 3000ms...`

---

## ملاحظات هامة

### لماذا 60 ثانية timeout؟
Azure SQL Serverless يأخذ 10-30 ثانية للاستيقاظ من حالة sleep. الـ 60 ثانية تضمن:
- وقت كافٍ للـ cold start
- retry mechanism يعمل بشكل صحيح
- user experience أفضل

### لماذا min: 2 في الـ pool؟
- يحافظ على connections نشطة دائمًا
- يقلل من cold start للـ requests اللاحقة
- مثالي لـ serverless environments

### لماذا singleton pattern؟
- يمنع إنشاء connection pool جديد لكل request
- يحافظ على الـ connection حية بين الـ requests
- يقلل بشكل كبير من latency

---

## النتيجة المتوقعة

### قبل الإصلاح:
- ❌ timeout عند أول login
- ❌ رسائل خطأ فنية تظهر للمستخدم
- ❌ connection جديد لكل request
- ❌ فشل متكرر مع Azure SQL

### بعد الإصلاح:
- ✅ retry تلقائي 3 مرات
- ✅ رسائل صديقة للمستخدم
- ✅ connection pool مشترك
- ✅ دعم كامل لـ Azure SQL Serverless
- ✅ health check endpoint للتشخيص

---

## Files Changed Summary
```
M  src/lib/db.ts
M  src/app/api/auth/login/route.ts
M  src/app/api/auth/session/route.ts
M  src/app/api/users/route.ts
M  src/app/api/shifts/route.ts
M  src/app/api/sales/route.ts
M  src/components/auth/LoginForm.tsx
A  src/app/api/health/db/route.ts
A  .env.local
```

**Total:** 7 modified files, 2 new files
