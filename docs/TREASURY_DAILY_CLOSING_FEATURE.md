# Daily Treasury / End-of-Day Closing Feature
# قفل اليوم / ملخص الخزنة اليومي

## Overview

The Daily Treasury feature is a comprehensive operational tool for managing end-of-day financial closing and treasury control in the Cut Salon system. It provides real-time visibility into cash flow, payment method breakdown, and reconciliation capabilities.

## Business Purpose

At the end of each business day or shift, managers need to:
- Know exactly how much cash is in the treasury
- Track all payment methods (cash, visa, instapay, paymob, etc.)
- See what came in vs. what went out
- Verify that physical counts match system amounts
- Identify discrepancies and maintain accountability

## Key Features

### 1. Real-Time Treasury Summary
- Total inflow and outflow by payment method
- Net position per payment method
- Grand total treasury position
- Transaction counts and percentages

### 2. Flexible Filtering
- Filter by business day (NewDay)
- Filter by date range
- Filter by shift
- Filter by user/operator
- Quick access to current day/shift

### 3. Payment Method Breakdown
- Visual cards for each payment method
- Inflow/outflow/net amounts
- Transaction counts
- Percentage of total
- Progress indicators

### 4. Detailed Movement Table
- Paginated transaction list
- Search and filter capabilities
- Full transaction details
- Export-ready format

### 5. End-of-Day Reconciliation
- Manual count input per payment method
- Automatic variance calculation
- Variance status indicators (acceptable/warning/critical)
- Audit trail with user and timestamp
- Notes for discrepancies

## Database Schema

### Primary Data Source: TblCashMove

The feature uses `TblCashMove` as the single source of truth for all financial movements.

**Why TblCashMove?**
- Captures ALL money movements (sales, expenses, income, transfers)
- Linked to payment methods via `PaymentMethodID`
- Tracks direction via `inOut` field ('in'/'out')
- Linked to shifts and business days via `ShiftMoveID`
- Contains transaction amounts in `GrandTolal` field

### New Table: TblTreasuryCloseRecon

Created specifically for end-of-day reconciliation:

```sql
CREATE TABLE [dbo].[TblTreasuryCloseRecon] (
    [ID] INT IDENTITY(1,1) PRIMARY KEY,
    [NewDay] INT NOT NULL,
    [ShiftMoveID] INT NULL,
    [PaymentMethodID] INT NOT NULL,
    [SystemAmount] DECIMAL(18,2) NOT NULL,
    [CountedAmount] DECIMAL(18,2) NOT NULL,
    [VarianceAmount] AS ([CountedAmount] - [SystemAmount]) PERSISTED,
    [Notes] NVARCHAR(500) NULL,
    [ClosedByUserID] INT NOT NULL,
    [ClosedAt] DATETIME NOT NULL DEFAULT GETDATE(),
    [IsActive] BIT NOT NULL DEFAULT 1
);
```

**Purpose:**
- Store manual physical counts
- Compare with system-calculated amounts
- Track variance for accountability
- Maintain audit trail

## Calculation Logic

### Core Formulas

```typescript
// For each payment method:
Inflow = SUM(GrandTolal) WHERE inOut = 'in' AND PaymentMethodID = X
Outflow = SUM(GrandTolal) WHERE inOut = 'out' AND PaymentMethodID = X
Net = Inflow - Outflow

// Grand totals:
TotalInflow = SUM(all inflows across all payment methods)
TotalOutflow = SUM(all outflows across all payment methods)
GrandNet = TotalInflow - TotalOutflow

// Variance (reconciliation):
Variance = CountedAmount - SystemAmount
VariancePercentage = (Variance / SystemAmount) * 100
```

### Variance Status Rules

```typescript
const VARIANCE_THRESHOLD = 50; // 50 ج.م

if (Math.abs(variance) <= 50) {
  status = 'acceptable'; // Green - within acceptable range
} else if (percentage <= 5) {
  status = 'warning'; // Yellow - minor discrepancy
} else {
  status = 'critical'; // Red - requires investigation
}
```

## API Endpoints

### 1. GET /api/treasury/current
Get current open business day and active shift.

**Response:**
```json
{
  "currentDay": {
    "newDay": 15,
    "dayDate": "2026-04-03",
    "isOpen": true
  },
  "currentShift": {
    "shiftMoveId": 42,
    "shiftName": "صباحي",
    "userName": "أحمد",
    "startDate": "2026-04-03T08:00:00"
  }
}
```

### 2. GET /api/treasury/daily-summary
Get daily treasury summary with payment method breakdown.

**Query Parameters:**
- `newDay`: business day number
- `dateFrom`: start date (YYYY-MM-DD)
- `dateTo`: end date (YYYY-MM-DD)
- `shiftMoveId`: specific shift
- `userId`: filter by user

**Response:**
```json
{
  "summary": {
    "totalInflow": 50000.00,
    "totalOutflow": 20000.00,
    "grandNet": 30000.00,
    "cashNet": 25000.00,
    "transactionCount": 150,
    "topPaymentMethod": "نقدي"
  },
  "paymentMethods": [
    {
      "paymentMethodId": 1,
      "paymentMethodName": "نقدي",
      "inflow": 30000.00,
      "outflow": 5000.00,
      "net": 25000.00,
      "transactionCount": 100,
      "percentageOfTotal": 83.33
    }
  ],
  "filters": {
    "newDay": 15,
    "dayDate": "2026-04-03",
    "shiftName": "صباحي",
    "userName": "أحمد"
  }
}
```

### 3. GET /api/treasury/movements
Get detailed treasury movements with pagination.

**Query Parameters:**
- Same as daily-summary, plus:
- `page`: page number (default 1)
- `pageSize`: items per page (default 50)

**Response:**
```json
{
  "movements": [
    {
      "id": 1,
      "invId": 123,
      "invType": "مبيعات",
      "invDate": "2026-04-03",
      "invTime": "10:30",
      "paymentMethodName": "نقدي",
      "inOut": "in",
      "amount": 500.00,
      "shiftName": "صباحي",
      "userName": "أحمد",
      "notes": null
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

### 4. POST /api/treasury/reconciliation
Save end-of-day reconciliation.

**Request Body:**
```json
{
  "newDay": 15,
  "shiftMoveId": 42,
  "reconciliations": [
    {
      "paymentMethodId": 1,
      "systemAmount": 25000.00,
      "countedAmount": 24950.00,
      "notes": "فرق بسيط في العد"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "reconciliationIds": [1, 2, 3],
  "variances": [
    {
      "paymentMethodId": 1,
      "paymentMethodName": "نقدي",
      "variance": -50.00,
      "variancePercentage": -0.2,
      "status": "acceptable"
    }
  ],
  "message": "تم حفظ قفل اليوم بنجاح"
}
```

### 5. GET /api/treasury/reconciliation
Get reconciliation history.

**Query Parameters:**
- `newDay`: filter by business day
- `shiftMoveId`: filter by shift

**Response:**
```json
{
  "reconciliations": [
    {
      "id": 1,
      "newDay": 15,
      "dayDate": "2026-04-03",
      "shiftName": "صباحي",
      "paymentMethodName": "نقدي",
      "systemAmount": 25000.00,
      "countedAmount": 24950.00,
      "varianceAmount": -50.00,
      "variancePercentage": -0.2,
      "status": "acceptable",
      "notes": "فرق بسيط في العد",
      "closedByUserName": "المدير",
      "closedAt": "2026-04-03T18:00:00"
    }
  ]
}
```

## UI Components

### 1. TreasuryFiltersBar
- Business day selector
- Date range pickers
- Shift selector
- User selector
- Quick action buttons (current day/shift)
- Reset filters

### 2. TreasuryKpiCards
- Total inflow card
- Total outflow card
- Grand net card
- Cash net card
- Top payment method card
- Transaction count card

### 3. PaymentMethodBreakdownTable
- Card-based layout for each payment method
- Inflow/outflow/net metrics
- Transaction counts
- Percentage indicators
- Progress bars

### 4. TreasuryMovementsTable
- Paginated transaction table
- Search functionality
- Sortable columns
- In/out direction badges
- Payment method display

### 5. TreasuryClosePanel
- Modal for end-of-day closing
- System amount display
- Manual count inputs
- Automatic variance calculation
- Variance status badges
- Notes input
- Save/cancel actions

## User Workflow

### Daily Closing Process

1. **Open Treasury Page**
   - Navigate to `/treasury/daily`
   - System loads current open day by default

2. **Review Summary**
   - Check KPI cards for totals
   - Review payment method breakdown
   - Verify transaction counts

3. **Inspect Details**
   - Scroll through detailed movements table
   - Search for specific transactions if needed
   - Verify all expected transactions are present

4. **Initiate Closing**
   - Click "قفل اليوم" button
   - Closing panel opens

5. **Physical Count**
   - Count actual cash in drawer
   - Count card receipts
   - Count digital payment confirmations
   - Enter counted amounts in panel

6. **Review Variances**
   - System calculates variances automatically
   - Review status indicators
   - Add notes for any discrepancies

7. **Save Closing**
   - Click "حفظ القفل"
   - System saves reconciliation record
   - Audit trail created

## Design System

### Color Palette

**Background:**
- Main: `zinc-950`
- Cards: `zinc-900/90` to `zinc-900/50` gradients
- Borders: `zinc-800/50`

**Accent Colors:**
- Primary: `amber-500` (warm, treasury-appropriate)
- Success/Inflow: `emerald-400` (muted green)
- Danger/Outflow: `rose-400` (refined red)
- Warning: `orange-400` / `amber-400`

**Text:**
- Primary: `white`
- Secondary: `zinc-400`
- Tertiary: `zinc-500`

### Visual Hierarchy

1. **Page Title** - Large, bold, white
2. **Section Headers** - Medium, bold, with icon
3. **KPI Values** - Large, colored by status
4. **Labels** - Small, muted
5. **Helper Text** - Extra small, very muted

### RTL Support

- Full Arabic RTL layout
- Proper text alignment
- Icon positioning for RTL
- Responsive grid layouts

## Installation & Setup

### 1. Run Database Migration

```bash
# Navigate to POS system directory
cd h:\whatsapp-bot-node\pos-system

# Run the migration script
sqlcmd -S YOUR_SERVER -d HawaiDB -i db\migrations\create-tbl-treasury-close-recon.sql
```

### 2. Verify Table Creation

```sql
SELECT * FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_NAME = 'TblTreasuryCloseRecon';
```

### 3. Access the Feature

Navigate to: `http://localhost:3000/treasury/daily`

## Navigation

The treasury feature is accessible from the main navigation sidebar:

**الخزنة (Treasury) → قفل اليوم (Daily Closing)**

## Security & Permissions

- Requires active shift to access
- Reconciliation saves user ID for audit trail
- All actions timestamped
- Read-only historical data
- Write access for closing requires proper permissions

## Performance Considerations

- Queries optimized with proper indexes
- Pagination for large transaction lists
- Efficient aggregation queries
- Minimal database roundtrips

## Future Enhancements

**Phase 2 (Planned):**
- PDF export of daily closing report
- Excel export for accounting
- Multi-branch treasury consolidation
- AI-powered anomaly detection
- Automated alerts for large variances
- Historical trend analysis
- Cash flow forecasting

## Troubleshooting

### Common Issues

**Issue: No data showing**
- Verify filters are set correctly
- Check that business day is selected
- Ensure TblCashMove has data for selected period

**Issue: Variance calculation incorrect**
- Verify counted amounts entered correctly
- Check system amount matches expected
- Review transaction list for missing entries

**Issue: Cannot save reconciliation**
- Ensure all payment methods have counted amounts
- Check database connection
- Verify user has proper permissions

## Support

For technical support or feature requests, contact the development team.

---

**Last Updated:** April 3, 2026  
**Version:** 1.0  
**Author:** Cut Salon Development Team
