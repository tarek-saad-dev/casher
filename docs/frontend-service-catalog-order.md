# Frontend report — Service catalog category order

**API:** `GET https://casher-five.vercel.app/api/services/catalog`  
**Admin control:** `/admin/services` → قسم «الفئات وترتيب العرض» (أسهم أعلى/أسفل)  
**CORS:** مفعّل (`Access-Control-Allow-Origin: *`) — يصلح لـ `localhost` وأي origin.

---

## 1. القاعدة

اعرض الأقسام **بالترتيب اللي راجع من الـ API كما هو**.

- الحقل: `categories[].sortOrder` (رقم أصغر = يظهر أولاً)
- المصفوفة `categories` **مرتبة مسبقاً** من السيرفر حسب `sortOrder` تصاعدياً
- **لا تعيد ترتيب الفئات أبجدياً** في الفرونت إلا لو فيه سبب صريح

التحكم في الترتيب من لوحة الأدمن فقط؛ الفرونت يستهلك الترتيب جاهز.

---

## 2. شكل الـ response (مختصر)

```json
{
  "ok": true,
  "meta": {
    "categoryCount": 5,
    "serviceCount": 36,
    "generatedAt": "2026-07-24T10:00:00.000Z"
  },
  "categories": [
    {
      "id": 1,
      "name": "حلاقة",
      "type": "serv",
      "sortOrder": 10,
      "serviceCount": 4,
      "services": [
        {
          "id": 12,
          "nameEn": "Basic Cut",
          "nameAr": "حلاقة عادية",
          "price": 150,
          "durationMinutes": 30,
          "imageUrl": null,
          "isActive": true,
          "categoryId": 1
        }
      ]
    },
    {
      "id": 2,
      "name": "Skincare",
      "sortOrder": 20,
      "serviceCount": 3,
      "services": []
    }
  ]
}
```

| Field | استخدمه في UI |
|--------|----------------|
| `categories` order / `sortOrder` | ترتيب التابات / السكاشن |
| `name` | عنوان القسم |
| `services[].nameAr` | عرض عربي (fallback: `nameEn`) |
| `services[].nameEn` | عرض إنجليزي |
| `services[].price` | السعر |

---

## 3. مثال استهلاك (TypeScript)

```ts
type CatalogService = {
  id: number;
  nameEn: string;
  nameAr: string | null;
  price: number;
  durationMinutes: number | null;
  imageUrl: string | null;
};

type CatalogCategory = {
  id: number | null;
  name: string;
  sortOrder: number;
  serviceCount: number;
  services: CatalogService[];
};

async function loadCatalog(): Promise<CatalogCategory[]> {
  const res = await fetch('https://casher-five.vercel.app/api/services/catalog');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'catalog failed');

  // Already sorted by sortOrder — keep order
  return data.categories as CatalogCategory[];
}

function displayName(svc: CatalogService, locale: 'ar' | 'en') {
  if (locale === 'ar') return svc.nameAr?.trim() || svc.nameEn;
  return svc.nameEn;
}
```

### React — أقسام بالترتيب

```tsx
{categories.map((cat) => (
  <section key={cat.id ?? 'uncategorized'} data-sort={cat.sortOrder}>
    <h2>{cat.name}</h2>
    <ul>
      {cat.services.map((svc) => (
        <li key={svc.id}>
          {displayName(svc, 'ar')} — {svc.price} EGP
        </li>
      ))}
    </ul>
  </section>
))}
```

### لو عندك hash tabs (`#groom`)

اربط التاب بـ `category.id` أو slug من عندك، لكن **ترتيب التابات** = ترتيب `categories` من الـ API:

```ts
const tabs = categories.map((c) => ({
  id: c.id,
  label: c.name,
  sortOrder: c.sortOrder,
}));
// لا تعمل .sort() إضافي على الاسم
```

---

## 4. Query params مفيدة

| Param | Default | ملاحظة |
|--------|---------|--------|
| `type=serv` | نعم | خدمات فقط (مش منتجات) |
| `active=true` | نعم | يستبعد المحذوف |
| `categoryId=N` | — | قسم واحد |
| `search=` | — | بحث nameAr / nameEn |

مثال: `GET /api/services/catalog?type=serv`

---

## 5. Checklist للفرونت

1. استخدم `GET /api/services/catalog` (مش flat `/api/services` القديم)
2. ارسم `categories` بالترتيب الراجع بدون sort أبجدي
3. استخدم `sortOrder` لو محتاج مقارنة / debug فقط
4. عربي: `nameAr || nameEn` — إنجليزي: `nameEn`
5. بعد ما الأدمن يغيّر الترتيب من `/admin/services`، اعمل refresh أو cache قصير — الترتيب بيتحدث فوراً من الـ API

---

## 6. إدارة الترتيب (Backend / Admin)

- صفحة: `/admin/services`
- أزرار ▲ ▼ على كل فئة → `PUT /api/services/categories/reorder`  
  Body: `{ "categoryIds": [2, 1, 5, ...] }` (الأول يظهر أولاً)
- القيم المحفوظة: `SortOrder = 10, 20, 30, ...`

الكتالوج العام يقرأ نفس العمود ويرجع نفس الترتيب.
