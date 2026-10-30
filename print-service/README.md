# CUT Salon Local Print Agent

## Deployment status

The POS invoice, expense and deduction buttons use the **local agent first** and show a **manual** Chrome fallback when the agent is unreachable. The agent has two engines:

- `PRINT_ENGINE=pdf` (default): existing Puppeteer → PDF → Windows printer route. Keep this until each branch printer is verified.
- `PRINT_ENGINE=escpos` (opt-in): Chromium renders the existing Arabic receipt to a PNG, the agent converts it to **bounded monochrome ESC/POS raster commands**, then sends a RAW job through the Windows spooler. No PDF, no Windows graphical pagination, no browser print preview. Rendering still uses Chromium to preserve RTL, branding and logos.

**A RAW job is not compatible with every Windows printer driver. Verify that this particular XP-80 is ESC/POS-capable and that its driver accepts datatype RAW before enabling.** The `/health` response proves only that the local process is alive; a successful print response proves that Windows accepted the job, not that the physical receipt came out.

### Safe first-time test (Windows, on the cashier PC)

1. Clear any stuck XP-80 jobs in Windows, verify the printer is Online and the thermal self-test prints a short receipt. Disconnect the printer or keep it off until the queue is cleared if it previously fed blank paper continuously.
2. Install Node.js 22 and run `npm ci` **inside `print-service`**. Check `Get-Printer | Select Name` and confirm the exact printer name.
3. In a **PowerShell** window in `print-service`, configure only this session:

   ```powershell
   $env:PRINTER_NAME = 'XP-80'
   $env:PRINT_ENGINE = 'escpos'
   $env:PRINTER_AUTO_CUT = '0'
   $env:ALLOWED_ORIGINS = 'https://ops.cutsaloon.com,http://localhost:5500,http://127.0.0.1:5500'
   npm start
   ```

4. Open `http://127.0.0.1:7788/health` on **the same PC**, confirm `"engine":"escpos"`. Keep a finger on the power switch for the first controlled test.
5. **One short test only** (do not repeatedly press Print):

   ```powershell
   Invoke-RestMethod -Uri 'http://127.0.0.1:7788/print/test' -Method Post -ContentType 'application/json' -Body '{"requestId":"first-hardware-test-1"}'
   ```

6. Confirm: a single short receipt, readable black text and Arabic, correct direction, no blank feed, and correct paper cut (if supported; it is disabled by default). Then test an actual invoice, expense, and deduction, plus a two-job back-to-back test. If RAW prints blank paper or code symbols, **turn off the printer, cancel all jobs**, set `PRINT_ENGINE=pdf` and use the documented browser fallback until the driver/firmware is fixed.
7. Measure first-print and warm-print latency using the browser developer console timestamps and the service logs. Do not claim a speed improvement until the hardware measurements are captured.

The local agent must run **on each branch's cashier Windows PC**, not on the VPS. `127.0.0.1` always means the browser's own machine. For auto-start, install the app as an appropriately permissioned Windows service or create a Windows Task Scheduler task to run `npm start` in the service directory at user sign-in (set the working directory and printer access correctly). Do not expose port 7788 beyond loopback.

### Troubleshooting and safeguards

- `ERR_CONNECTION_REFUSED`: local agent isn't running or port 7788 is blocked.
- `CORS` / local network permission: check `ALLOWED_ORIGINS` contains the **exact** POS origin including scheme, and grant the trusted Cashier site Chrome's local network/device permission when prompted.
- `SPOOLER_ERROR`: check Windows printer status/queue, installed printer name, and local PowerShell stdout/stderr. PDF and RAW modes need different driver support.
- Requests are serialized and request IDs are de-duplicated for 10 minutes while the agent runs; retries with the same ID do **not** queue a second paper receipt. Explicitly create a new ID for an intentional reprint.
- Receipts taller than 4800 dots or wider than 576 dots are **rejected before sending data**. No unbounded feed; partial cut is disabled unless `PRINTER_AUTO_CUT=1`.
- Browser fallback is **manual**. Never automatically retry on another printing channel after a timeout because the spooler may already have accepted the first job.
- If using an environment file, load it explicitly with your service manager; this project currently reads `process.env` and does not automatically load `.env`.

## Previous setup reference

A local Node.js print service for the POS system that prints receipts directly to thermal printer without using Chrome print preview.

## Architecture

```
Next.js POS (localhost:5500) → Local Print Service (127.0.0.1:7788) → Windows Printer (XP-80)
```

## Features

- 🖨️ Direct printing to XP-80 thermal printer
- 📄 80mm receipt optimized layout
- 🇸🇦 Arabic RTL support
- 🚀 Fire-and-forget printing (doesn't block sales)
- 📊 Health monitoring endpoint
- 🛡️ CORS enabled only for POS
- 📝 Clean PDF generation with Puppeteer

## Setup Instructions

### 1. Install Dependencies

```bash
cd print-service
npm install
```

### 2. Verify Printer Name

Make sure your Windows printer is named exactly `XP-80`:

```bash
# List all printers (Windows PowerShell)
Get-Printer | Select-Object Name

# Or via Command Prompt
wmic printer get name
```

If your printer has a different name, update `PRINTER_NAME` in `server.js`:

```javascript
const PRINTER_NAME = 'Your-Printer-Name'; // Change this
```

### 3. Start the Print Service

```bash
# For development (with auto-restart)
npm run dev

# For production
npm start
```

The service will start on `http://127.0.0.1:7788`

### 4. Test the Service

#### Health Check
```bash
curl http://127.0.0.1:7788/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "pos-print-service",
  "version": "1.0.0",
  "printer": "XP-80",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

#### Test Print Receipt
```bash
curl -X POST http://127.0.0.1:7788/print/receipt \
  -H "Content-Type: application/json" \
  -d '{
    "invID": 123,
    "invDate": "2024-01-01",
    "invTime": "12:00",
    "customerName": "أحمد محمد",
    "customerPhone": "01000000000",
    "SubTotal": 150,
    "Dis": 0,
    "DisVal": 0,
    "GrandTotal": 150,
    "PayCash": 150,
    "PayVisa": 0,
    "PaymentMethodID": 1,
    "items": [
      {
        "ProName": "حلاقة رجالية",
        "EmpName": "علي",
        "SPrice": 150,
        "Qty": 1,
        "SPriceAfterDis": 150
      }
    ]
  }'
```

## Integration with POS

The print service is already integrated into the POS system:

1. **Automatic Printing**: After each successful sale, the receipt is automatically sent to the print service
2. **Non-blocking**: If the print service is offline, the sale still completes successfully
3. **Fire-and-forget**: Printing happens in the background without blocking the UI

## Configuration

### Environment Variables

You can optionally create a `.env` file:

```env
# Printer configuration
PRINTER_NAME=XP-80
PRINTER_SERVICE_PORT=7788

# CORS settings
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
```

### Custom Printer Settings

If you need to adjust the receipt layout, modify the CSS in `server.js`:

```javascript
// Page size
@page {
  size: 80mm auto;
  margin: 0mm;
}

// Font sizes
font-size: 11px; // Base font size
font-size: 18px; // Salon name
font-size: 14px; // Grand total
```

## Troubleshooting

### Service Won't Start

```bash
# Check if port is in use
netstat -ano | findstr :7788

# Kill process using the port
taskkill /PID <PID> /F
```

### Printer Not Found

1. Verify printer name in Windows
2. Update `PRINTER_NAME` in `server.js`
3. Restart the print service

### Printing Fails

1. Check printer is online and has paper
2. Verify Windows can print to XP-80
3. Check print service logs for errors

### CORS Issues

Make sure the POS is running on one of these URLs:
- `http://localhost:5500`
- `http://127.0.0.1:5500`

## API Reference

### GET /health

Returns the service status and printer information.

**Response:**
```json
{
  "status": "ok",
  "service": "pos-print-service",
  "version": "1.0.0",
  "printer": "XP-80",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### POST /print/receipt

Prints a receipt to the configured thermal printer.

**Request Body:**
```json
{
  "invID": 123,                    // Required: Invoice ID
  "invDate": "2024-01-01",         // Required: Invoice date
  "invTime": "12:00",              // Required: Invoice time
  "customerName": "أحمد محمد",    // Optional: Customer name
  "customerPhone": "01000000000",  // Optional: Customer phone
  "SubTotal": 150,                 // Required: Subtotal
  "Dis": 0,                        // Optional: Discount percentage
  "DisVal": 0,                     // Optional: Discount value
  "GrandTotal": 150,               // Required: Grand total
  "PayCash": 150,                  // Required: Cash amount
  "PayVisa": 0,                    // Required: Visa amount
  "PaymentMethodID": 1,            // Optional: Payment method ID
  "items": [                       // Required: Array of items
    {
      "ProName": "حلاقة رجالية",   // Service name
      "EmpName": "علي",            // Employee name
      "SPrice": 150,               // Service price
      "Qty": 1,                    // Quantity
      "SPriceAfterDis": 150        // Price after discount
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Receipt printed successfully",
  "invoiceId": 123,
  "printer": "XP-80"
}
```

## Production Deployment

### Windows Service

To run the print service as a Windows service:

1. Install `node-windows`:
```bash
npm install -g node-windows
```

2. Create a service installer script:
```javascript
// install-service.js
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'POSPrintService',
  description: 'POS Print Service for thermal receipts',
  script: 'C:\\path\\to\\print-service\\server.js',
  nodeOptions: ['--max-old-space-size=4096']
});

svc.on('install', () => {
  console.log('Service installed');
  svc.start();
});

svc.install();
```

3. Run the installer:
```bash
node install-service.js
```

### Auto-start on Windows Boot

Create a batch file `start-print-service.bat`:
```batch
@echo off
cd /d C:\path\to\print-service
npm start
```

Then add it to Windows Startup folder:
`Win + R` → `shell:startup` → Add shortcut to the batch file

## Security Considerations

- The service only accepts requests from `localhost:5500` and `127.0.0.1:5500`
- No authentication required (local only)
- Temporary PDF files are automatically deleted after 5 seconds
- Request size limited to 10MB

## Performance

- Average print time: 2-3 seconds
- Memory usage: ~50MB
- Concurrent requests: Handles multiple simultaneous sales
- Automatic cleanup of temporary files

## Support

If you encounter issues:

1. Check the console output of the print service
2. Verify the printer is working in Windows
3. Test with the sample curl command above
4. Check that the POS and print service are on the same machine
