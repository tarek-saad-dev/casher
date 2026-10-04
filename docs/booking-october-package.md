# Booking Flow — October Package (باكدج أكتوبر)

| | |
|---|---|
| الباكدج | باكدج أكتوبر / October Package |
| PackageID | `7` (`PackageKind = 'regular'`) |
| السعر | **333 EGP** (الأصلي 720) |
| الخدمات | ProIDs `9` قص شعر، `10` ذقن وفيد، `22` حمام زيت، `29` تنظيف بشرة كلاسيكي |
| المدة الحالية | **85 دقيقة** (30 + 20 + 5 + 30، من كتالوج الفرع) |
| الفروع | `GLEEM` و`CAMP_CAESAR` |

البيانات متخزنة في `TblServicePackage` / `TblServicePackageItem`، وأسعار `TblPro` ما اتغيرتش.

## الـFlow

1. **اختيار الباكدج:** الموقع بيجيب الباكدجات من `GET /api/public/client/packages`، والـendpoint ده بيرجع الـgroom والـregular.
2. **الـplan:** الـfrontend بيبعت `packageId: 7` لـ`POST /api/public/booking/plan`، بنفس طريقة باكدجات العريس.
3. **الـresolve من الـDB:** `resolvePublicPackageBooking` بيقرا الباكدج وخدماته من الـDB، وما بيعتمدش على الأسعار أو المدد اللي جاية من العميل.
4. **التحقق من الفرع:** كل خدمة في الباكدج لازم تكون متاحة للحجز في الفرع المختار. لو أي خدمة مش متاحة، الحجز بيترفض بـ`SERVICE_NOT_AVAILABLE_AT_BRANCH`.
5. **المدة:** بتتحسب من مدد الخدمات في كتالوج الفرع، فدلوقتي هي 85 دقيقة. لو مدة أي خدمة اتغيرت في الكتالوج، مدة الباكدج بتتغير معاها.
6. **السعر:** السعر النهائي هو `PackagePrice`، يعني 333.
7. **توزيع السعر على `BookingServices`:** أول خدمة بتشيل سعر الباكدج كله والباقي بـ0، فالمجموع بيطلع 333 من غير حساب مزدوج:

   | ProID | Price |
   |---|---|
   | 9 | 333 |
   | 10 | 0 |
   | 22 | 0 |
   | 29 | 0 |

8. **الـavailability والـcheck-slot:**
   - الـslots بتتحسب على مدة الباكدج كلها، 85 دقيقة.
   - `available-slots` بياخد الـ`serviceIds` بتاعة الباكدج، ومجموع مدد الخدمات دي هو نفس المدة.
   - `check-slot` بياخد `packageId` وبيستخدم نفس الـevaluator بتاع الـplan.
9. **الـcreate:**
   - `POST /api/public/booking/create` بيعمل resolve للباكدج تاني من الـDB، ويتحقق تاني من السعر والمدة وتوفر الخدمات في الفرع.
   - أي سعر أو مدة جايين من الـfrontend بيتجاهلوا.
   - الـplan token مربوط بالـ`packageId`، فلو اتبعت `packageId` مختلف عن اللي في الـplan، الـtoken بيترفض.
10. **الحجز:**
    - الحجز بيتعمل بـ`packageId = 7`، وبيتسجل في `Bookings.Notes` بالشكل ده: `[groomPackage] packageId=7;packagePrice=333;…`.
    - البادئة `groomPackage` اسم قديم، وبتتكتب لكل أنواع الباكدجات.
    - الـPOS بيقرا الميتاداتا دي من `/api/pos/groom-packages/from-booking/[id]` ويحوّل الحجز لفاتورة باكدج.

## ملاحظات مهمة

- **نفس الـresolver للنوعين:** `resolvePublicPackageBooking` بيستخدم `resolveGroomPackageBooking` ومعاه `allowedKinds = ['groom', 'regular']`. مفيش أي حاجة متثبتة في الكود على October، وأي باكدج `regular` تاني هيمشي بنفس الطريقة.
- **باكدجات العريس ما اتغيرتش:**
  - بترجع من الـresolver زي ما هي، بمدة الباكدج المتخزنة في `TblServicePackage`، ومن غير شرط إن خدماتها تكون في الكتالوج العام.
  - النتايج الحالية: 1300/95 دقيقة، و1500/110، و3000/195.
- **الحجز العادي من غير باكدج:** لنفس الأربع خدمات (9، 10، 22، 29) بيفضل بالأسعار العادية، يعني الإجمالي **720**.
- **الخدمات غير المتاحة:** لو أي خدمة في الباكدج مش متاحة في الفرع، الحجز بيترفض في plan وcheck-slot وcreate.

## أهم الملفات

| الملف | الدور |
|---|---|
| `src/lib/booking/packageBooking.ts` | `resolvePublicPackageBooking`: الـresolve للنوعين، وتوفر خدمات الفرع، والمدة، وتوزيع السعر |
| `src/lib/booking/groomPackageBooking.ts` | الـresolver الأساسي من الـDB (`allowedKinds`) والميتاداتا `[groomPackage]` |
| `src/lib/booking/publicBookingSelectionEvaluator.ts` | الـplan والـcheck-slot: تقييم الاختيار عن طريق الـpackage |
| `src/lib/booking/publicBookingCreate.ts` | الـcreate: إعادة الـresolve والتحقق قبل ما الحجز يتسجل |
| `src/app/api/pos/groom-packages/from-booking/[id]/route.ts` | تحويل حجز الباكدج لفاتورة POS (groom وregular) |

## الاختبارات

- **Unit:** `src/lib/__tests__/packageBooking.test.ts`.
- **E2E على الـDB الحقيقي:** `npx tsx tmp/e2e-october-package-booking.ts`.
  - بيعمل في كل فرع: catalog ← slots ← plan ← check-slot ← create ← تحقق من الـDB ← cancel.
  - الواتساب بيبقى مقفول أثناء الاختبار.
  - رقم عميل الاختبار هو `01000033307`. الاختبار بيعمل `TblClient` للرقم ده، فامسحه بعد ما الاختبار يخلص.
