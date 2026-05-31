# PowerShell Script: Fix all unspecified payment methods to Cash (كاش)
# Run: .\scripts\fix-unspecified-to-cash.ps1

param(
    [string]$BaseUrl = "http://localhost:5500",
    [switch]$PreviewOnly
)

Write-Host "🔧 Fix Unspecified Payment Methods to Cash (كاش)" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Get preview
Write-Host "Step 1: Checking affected transactions..." -ForegroundColor Yellow

try {
    $previewUrl = "$BaseUrl/api/audit/unspecified-payment-methods/fix-all"
    $response = Invoke-WebRequest -Uri $previewUrl -Method GET -UseBasicParsing -ErrorAction Stop
    $data = $response.Content | ConvertFrom-Json
    
    Write-Host "✓ Found $($data.wouldFix.totalCount) transactions to fix:" -ForegroundColor Green
    Write-Host "  - Revenue (ايرادات): $($data.wouldFix.revenueCount)" -ForegroundColor White
    Write-Host "  - Expense (مصروفات): $($data.wouldFix.expenseCount)" -ForegroundColor White
    Write-Host "  - Total Amount: $($data.wouldFix.totalAmount) EGP" -ForegroundColor White
    Write-Host ""
    
    if ($data.wouldFix.totalCount -eq 0) {
        Write-Host "✅ No transactions to fix. Exiting." -ForegroundColor Green
        exit 0
    }
    
    if ($PreviewOnly) {
        Write-Host "Preview mode - no changes made." -ForegroundColor Magenta
        Write-Host "Sample transactions that would be updated:" -ForegroundColor Yellow
        $data.sampleTransactions | Format-Table -Property ID, invDate, invType, GrandTolal, CategoryName, UserName -AutoSize
        exit 0
    }
    
    # Step 2: Confirm
    Write-Host "Step 2: Confirmation required" -ForegroundColor Yellow
    $confirm = Read-Host "Are you sure you want to fix all $($data.wouldFix.totalCount) transactions to Cash? (yes/no)"
    
    if ($confirm -ne "yes") {
        Write-Host "❌ Cancelled by user." -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "Step 3: Updating transactions..." -ForegroundColor Yellow
    
    # Step 3: Execute fix
    $body = @{
        reason = "Bulk fix via PowerShell script - converting all to Cash"
    } | ConvertTo-Json
    
    $fixResponse = Invoke-WebRequest -Uri $previewUrl -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -ErrorAction Stop
    $fixData = $fixResponse.Content | ConvertFrom-Json
    
    if ($fixData.success) {
        Write-Host ""
        Write-Host "✅ SUCCESS!" -ForegroundColor Green
        Write-Host "   Updated: $($fixData.updatedCount) transactions" -ForegroundColor Green
        Write-Host "   Payment Method: $($fixData.paymentMethodName)" -ForegroundColor Green
        Write-Host "   Message: $($fixData.message)" -ForegroundColor Green
        
        if ($fixData.errors -and $fixData.errors.Count -gt 0) {
            Write-Host ""
            Write-Host "⚠️  Some errors occurred:" -ForegroundColor Yellow
            $fixData.errors | ForEach-Object {
                Write-Host "   - ID $($_.id): $($_.error)" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "❌ Error: $($fixData.error)" -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎉 All unspecified payment methods have been fixed to Cash (كاش)!" -ForegroundColor Green
