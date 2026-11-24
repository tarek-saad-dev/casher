# Sales / POS Module — Implementation Blueprint

## A. Feature Overview

A single-page Sales/POS screen for a barbershop/salon that allows staff to:
- Search/select an existing customer or quick-add a new one
- Select a barber (employee)
- Pick one or more services
- See selected items with live totals
- Choose a payment method
- Save the invoice (TblinvServHead + TblinvServDetail)
- Print the invoice immediately

**Tech stack**: Next.js 14 (App Router) + React + TailwindCSS + shadcn/ui + mssql  
**Database**: Existing HawaiDB (SQL Server) — no schema changes  
**Language**: Arabic RTL-first, desktop-first  
**Port**: 5000 (alongside WhatsApp bot on 3000, Calendar sync on 4000)

---

## B. User Flow

```
┌─────────────────────────────────────────────────────┐
│  1. Staff opens POS screen                          │
│  2. Clicks customer search → types name/phone       │
│     → selects from results OR clicks "عميل جديد"    │
│  3. Selects barber from avatar grid                  │
│  4. Taps services from card grid (adds to cart)      │
│  5. Sees live item list + totals on the right panel  │
│  6. Optionally adjusts discount (% or value)         │
│  7. Selects payment method (cash/visa/etc)           │
│  8. Clicks "حفظ الفاتورة" (Save Invoice)            │
│  9. Invoice saved → print modal appears              │
│ 10. Clicks "طباعة" → prints → screen resets          │
└─────────────────────────────────────────────────────┘
```

**Target**: Full sale in under 15 seconds for a returning customer.

---

## C. Screen Structure

Single page with 3-column layout:

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER: Logo + "نقطة البيع" + Shift info + Clock            │
├──────────┬───────────────────────────┬───────────────────────┤
│          │                           │                       │
│  RIGHT   │     CENTER                │   LEFT                │
│  PANEL   │     PANEL                 │   PANEL               │
│          │                           │                       │
│ Customer │  Barber Selector          │  Cart Items           │
│ Search   │  (avatar grid)            │  (selected services)  │
│          │                           │                       │
│ Selected │  Service Grid             │  Discount             │
│ Customer │  (card-based)             │  Subtotal / Tax       │
│ Info     │                           │  Grand Total          │
│          │                           │                       │
│ Quick    │                           │  Payment Method       │
│ Add      │                           │                       │
│          │                           │  [حفظ الفاتورة]       │
│          │                           │                       │
├──────────┴───────────────────────────┴───────────────────────┤
│  FOOTER: Keyboard shortcuts hint                              │
└──────────────────────────────────────────────────────────────┘
```

---

## D. Component Breakdown

| Component | Purpose |
|---|---|
| `PosLayout` | 3-column responsive layout shell |
| `PosHeader` | Logo, shift info, clock, new sale button |
| `CustomerSearch` | Debounced search by name/phone, dropdown results |
| `CustomerCard` | Shows selected customer info |
| `QuickCustomerModal` | Inline modal: Name + Mobile → create + select |
| `BarberGrid` | Avatar cards for each barber, single-select |
| `ServiceGrid` | Card grid of services with price, tap to add |
| `CartPanel` | List of added items (service + barber + price) |
| `CartItem` | Single line item with remove button |
| `DiscountInput` | Toggle % / value discount |
| `InvoiceSummary` | SubTotal, Discount, Tax, GrandTotal |
| `PaymentMethodSelect` | Button group: cash, visa, etc. |
| `SaveButton` | Primary action, validates + saves |
| `PrintInvoiceModal` | Print preview + print button |

---

## E. Data Mapping

### TblinvServHead (one row per sale)

| DB Column | Source | Notes |
|---|---|---|
| invID | Auto-generated | MAX(invID)+1 WHERE invType=N'خدمة' |
| invType | Fixed | N'خدمة' for POS sales |
| invDate | System | Today's date |
| invTime | System | Current time "HH.mm" |
| ClientID | CustomerSearch | From TblClient.ClientID |
| UserID | Session | Logged-in staff (0 for now) |
| TotalQty | Calculated | Sum of detail Qty |
| SubTotal | Calculated | Sum of line prices |
| Dis | User input | Discount % |
| DisVal | Calculated | Discount amount |
| Tax | Config | Tax % (0 if none) |
| TaxVal | Calculated | Tax amount |
| GrandTotal | Calculated | SubTotal - DisVal + TaxVal |
| invNotes | Optional | Staff notes |
| TotalBonus | Calculated | Sum of detail Bonus |
| ShiftMoveID | Auto | Current open shift |
| ReservDate | NULL | Not a booking |
| ReservTime | NULL | Not a booking |
| Notes | Auto | "خدمة / {customerName}" |
| PayCash | Conditional | Amount if cash |
| PayVisa | Conditional | Amount if visa |
| isActive | Fixed | 'yes' |
| Payment | Calculated | Amount paid |
| PayDue | Calculated | GrandTotal - Payment |
| PaymentMethodID | User select | From TblPaymentMethods |

### TblinvServDetail (one row per service line)

| DB Column | Source | Notes |
|---|---|---|
| invID | From head | Same as header |
| invType | Fixed | N'خدمة' |
| EmpID | BarberGrid | Selected barber per line |
| ProID | ServiceGrid | Selected service |
| Dis | Per-line | Line discount % |
| DisVal | Calculated | Line discount value |
| SPrice | From TblPro | SPrice1 |
| SValue | Calculated | SPrice × Qty |
| SPriceAfterDis | Calculated | SValue - DisVal |
| PPrice | Fixed | 0 (no products) |
| PValue | Fixed | 0 |
| Qty | Default | 1 |
| ProType | NULL | |
| Notes | Auto | Service name |
| Bonus | From TblPro | Bonus value |
| ReservDate | NULL | Not a booking |

### Lookup Tables

| Table | Columns Used | Purpose |
|---|---|---|
| TblClient | ClientID, Name, Mobile, BirthDate | Customer selection |
| TblEmp | EmpID, EmpName | Barber selection |
| TblPro | ProID, ProName, SPrice1, Bonus | Service selection |
| TblPaymentMethods | ID(?), Name(?) | Payment method (to be discovered) |
| TblShiftMove | ID, Status, NewDay | Current shift resolution |

---

## F. Validation Rules

1. **At least one service** must be in the cart
2. **Barber must be selected** (per line or globally)
3. **Payment method** must be selected before save
4. **Customer is optional** but recommended (ClientID can be NULL)
5. **Price cannot be negative**
6. **Quantity defaults to 1** for services
7. **Discount cannot exceed SubTotal**
8. **Shift must exist** — if no open shift, show warning
9. **No duplicate save** — disable button after first click until complete
10. **invID generation** must use SERIALIZABLE + TABLOCKX (same as promotion service)

---

## G. Frontend Architecture

```
pos-system/
├── app/
│   ├── layout.tsx          # Root layout (RTL, Arabic font, theme)
│   ├── page.tsx            # Main POS page
│   ├── globals.css         # Tailwind + custom styles
│   └── api/
│       ├── customers/
│       │   ├── route.ts        # GET search, POST create
│       │   └── [id]/route.ts   # GET by ID
│       ├── barbers/
│       │   └── route.ts        # GET all active barbers
│       ├── services/
│       │   └── route.ts        # GET all active services
│       ├── payment-methods/
│       │   └── route.ts        # GET all payment methods
│       ├── shifts/
│       │   └── route.ts        # GET current shift
│       └── sales/
│           ├── route.ts        # POST create sale
│           └── [id]/route.ts   # GET sale by ID (for print)
├── components/
│   ├── pos/
│   │   ├── PosLayout.tsx
│   │   ├── PosHeader.tsx
│   │   ├── CustomerSearch.tsx
│   │   ├── CustomerCard.tsx
│   │   ├── QuickCustomerModal.tsx
│   │   ├── BarberGrid.tsx
│   │   ├── ServiceGrid.tsx
│   │   ├── CartPanel.tsx
│   │   ├── CartItem.tsx
│   │   ├── DiscountInput.tsx
│   │   ├── InvoiceSummary.tsx
│   │   ├── PaymentMethodSelect.tsx
│   │   ├── SaveButton.tsx
│   │   └── PrintInvoiceModal.tsx
│   └── ui/                 # shadcn/ui components
├── hooks/
│   ├── useSaleState.ts     # Main sale reducer
│   ├── useCustomerSearch.ts
│   ├── useBarbers.ts
│   ├── useServices.ts
│   └── usePaymentMethods.ts
├── lib/
│   ├── db.ts               # mssql connection pool
│   ├── types.ts            # TypeScript interfaces
│   └── utils.ts            # Formatters, helpers
├── .env.local              # DB credentials
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## H. API / Service Layer

| Method | Route | Purpose |
|---|---|---|
| GET | /api/customers?q=... | Search customers by name or phone |
| POST | /api/customers | Create new customer (Name, Mobile) |
| GET | /api/barbers | List all active barbers |
| GET | /api/services | List all services with prices |
| GET | /api/payment-methods | List payment methods |
| GET | /api/shifts/current | Get current open shift |
| POST | /api/sales | Create sale (head + details) |
| GET | /api/sales/[id] | Get sale by ID (for print) |

---

## I. Implementation Phases

| Phase | Description | Deliverables |
|---|---|---|
| **1** | Project scaffold + UI shell | Next.js app, RTL layout, 3-column grid, header |
| **2** | API layer + DB connection | All 6 API routes, mssql pool, tested |
| **3** | Customer search + quick add | CustomerSearch, QuickCustomerModal |
| **4** | Barber + Service selectors | BarberGrid, ServiceGrid with real data |
| **5** | Cart + totals + state | useSaleState, CartPanel, InvoiceSummary |
| **6** | Payment + Save invoice | PaymentMethodSelect, SaveButton, DB write |
| **7** | Print invoice | PrintInvoiceModal, thermal/A4 receipt |
| **8** | Polish | Keyboard shortcuts, animations, edge cases |

---

## J. Edge Cases

1. **No open shift** → warn but allow save (use latest shift)
2. **Customer not found** → show "عميل جديد" inline
3. **Service price = 0** → allow (free service / courtesy)
4. **Multiple services, different barbers** → each detail line has its own EmpID
5. **100% discount** → GrandTotal = 0, valid (loyalty reward)
6. **Network/DB error during save** → show error, keep state, allow retry
7. **Duplicate rapid clicks on save** → debounce + disable button
8. **Very long customer name** → truncate in Notes fields (50/100 char limits)
9. **No payment methods in DB** → default to cash
10. **Concurrent invID generation** → SERIALIZABLE transaction with TABLOCKX
11. **Printer not available** → show error, but sale is already saved
12. **Arabic text in all fields** → ensure NVarChar everywhere
13. **Barber changed mid-sale** → only applies to new items, not retroactively

---

## K. First Coding Step

**Phase 1: Scaffold + UI Shell**
- Create Next.js 14 project at `h:\whatsapp-bot-node\pos-system`
- Install: tailwindcss, shadcn/ui, mssql, lucide-react
- Build the 3-column RTL layout
- Create the POS header with shift info and clock
- Create placeholder panels for all 3 columns
- Wire up the DB connection pool
- Create all API route stubs

---

## Keyboard Shortcuts (planned for Phase 8)

| Key | Action |
|---|---|
| `F2` | Focus customer search |
| `F3` | Open quick add customer |
| `F5` | Focus service search |
| `F9` | Save invoice |
| `F10` | Print last invoice |
| `Escape` | Clear / cancel current action |
| `Delete` | Remove selected cart item |

## Printing UX

- **Thermal receipt** (80mm): compact layout, Arabic RTL, logo at top
- **A4 invoice**: formal layout with header, table, totals, footer
- Auto-detect: use `window.print()` with `@media print` CSS
- Print preview in modal before sending to printer
- Auto-close modal after print
