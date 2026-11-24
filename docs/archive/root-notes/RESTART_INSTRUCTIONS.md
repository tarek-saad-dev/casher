# حل مشكلة Invalid object name 'dbo.TblClients'

## المشكلة
الخطأ `Invalid object name 'dbo.TblClients'` بيظهر رغم إن الكود مصحح ويستخدم `TblClient` (الاسم الصحيح).

## السبب
Next.js build cache — الـ dev server محتفظ بنسخة قديمة من الكود.

## الحل

### 1. أوقف Next.js dev server
اضغط `Ctrl+C` في terminal اللي شغال فيه `npm run dev`

### 2. امسح .next folder
```powershell
cd H:\whatsapp-bot-node\pos-system
Remove-Item -Recurse -Force .next
```

### 3. شغل dev server تاني
```powershell
npm run dev
```

### 4. جرب عملية البيع تاني
المفروض تشتغل دلوقتي بدون أخطاء.

---

## ملاحظة مهمة
الكود الحالي **صحيح** — كل الملفات بتستخدم `TblClient` (الاسم الصحيح في قاعدة البيانات).

الخطأ كان بسبب cache فقط.
