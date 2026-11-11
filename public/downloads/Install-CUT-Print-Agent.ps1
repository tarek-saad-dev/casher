#Requires -Version 5.1
<#
CUT Salon Print Agent - Windows guided installer.
Download only from https://ops.cutsaloon.com/downloads/Install-CUT-Print-Agent.ps1
Run intentionally on the Windows computer connected to an XP-80 printer.

The script:
  1) Checks whether CUT Salon Print Agent Scheduled Task is registered.
  2) If registered, starts it if necessary and checks local /health.
  3) If missing, installs the public, official repo's print-service into LOCALAPPDATA,
     installs Node dependencies, registers per-user autostart, starts, and checks health.

No auto print, no admin escalation, no firewall/port exposure, no driver install.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskName = 'CUT Salon Print Agent'
$healthUrl = 'http://127.0.0.1:7788/health'
$installRoot = Join-Path $env:LOCALAPPDATA 'CUT-Salon\Print-Agent'
$serviceDir = Join-Path $installRoot 'print-service'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('cut-print-agent-' + [guid]::NewGuid().ToString('N'))
$archiveUrl = 'https://github.com/tarek-saad-dev/casher/archive/refs/heads/main.zip'
$guideUrl = 'https://ops.cutsaloon.com/admin/settings/printing'

function Step([string]$message) { Write-Host ("  > " + $message) -ForegroundColor Cyan }
function Healthy {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3 -ErrorAction Stop
    return ($response.status -eq 'ok' -or $response.ok -eq $true)
  } catch { return $false }
}
function ExplainError([string]$message) {
  Write-Host ''
  Write-Host 'لم تكتمل تهيئة خدمة الطباعة.' -ForegroundColor Yellow
  Write-Host $message -ForegroundColor Yellow
  Write-Host ('للمساعدة افتح: ' + $guideUrl)
}

Write-Host ''
Write-Host 'CUT SALON — Print Agent Setup' -ForegroundColor Green
Write-Host '----------------------------------------'
Write-Host 'ده تثبيت على الكمبيوتر الحالي فقط. مش هيتم إرسال أي ورقة أثناء التثبيت.'
Write-Host ''

try {
  if (-not $env:LOCALAPPDATA) { throw 'يجب تشغيل الملف من جلسة مستخدم Windows، وليس من حساب خدمة.' }
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $task) {
    Step 'المهمة موجودة بالفعل في Windows. بنفحص الاتصال...'
    if (Healthy) {
      Write-Host 'الخدمة شغالة بالفعل. لا تحتاج إلى إعادة تثبيت.' -ForegroundColor Green
      Write-Host ("افتح: " + $guideUrl)
      exit 0
    }
    Step 'بنحاول تشغيل المهمة الموجودة...'
    Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    for ($attempt = 1; $attempt -le 5; $attempt++) {
      Start-Sleep -Seconds 2
      if (Healthy) {
        Write-Host 'تم تشغيل خدمة الطباعة بنجاح.' -ForegroundColor Green
        Write-Host 'ارجع لـ Cashier واضغط فحص الاتصال. ده مش اختبار طباعة.' -ForegroundColor Green
        exit 0
      }
    }
    throw ('مهمة ' + $taskName + ' موجودة لكن الخدمة مش بتستجيب. راجع ملف logs في مسار التثبيت أو خلي المسؤول يراجعها.')
  }

  Step 'المهمة مش موجودة. بنراجع متطلبات التثبيت...'
  if (Healthy) {
    throw 'فيه خدمة طباعة شغالة على المنفذ 7788 لكن المهمة مش موجودة. أوقف نسخة التشغيل اليدوي قبل تثبيت نسخة جديدة.'
  }
  $printer = Get-Printer -Name 'XP-80' -ErrorAction SilentlyContinue
  if ($null -eq $printer) {
    throw 'طابعة XP-80 مش متثبتة على الكمبيوتر ده. ثبّت تعريفها في Windows الأول. لو الجهاز هيطبع على طابعة جهاز تاني، مش محتاج تثبيت Agent محلي عليه.'
  }
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw 'Node.js مش مثبت. ثبّت إصدار Node.js LTS 22 أو أحدث من nodejs.org، افتح PowerShell جديد وشغّل نفس الملف مرة تانية.'
  }
  $version = & $node.Source -p 'process.versions.node'
  $major = [int](($version -split '\.')[0])
  if ($major -lt 22) {
    throw ("إصدار Node.js على الجهاز هو " + $version + ". حدّثه إلى 22 أو أحدث ثم أعد تشغيل الملف.")
  }

  Step 'بننزّل ملفات CUT Print Agent الرسمية من GitHub...'
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  $archiveFile = Join-Path $tempRoot 'source.zip'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $archiveUrl -OutFile $archiveFile -UseBasicParsing -MaximumRedirection 5
  if ((Get-Item $archiveFile).Length -lt 2000) { throw 'الملف اللي اتنزّل مش أرشيف صحيح.' }
  Expand-Archive -LiteralPath $archiveFile -DestinationPath (Join-Path $tempRoot 'source') -Force
  $candidate = Get-ChildItem -Path (Join-Path $tempRoot 'source') -Directory |
    ForEach-Object { Join-Path $_.FullName 'print-service' } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ 'server.js') } |
    Select-Object -First 1
  if (-not $candidate) { throw 'ملفات print-service مش موجودة داخل الأرشيف الرسمي.' }

  Step 'بنجهّز نسخة محلية آمنة داخل حساب Windows الحالي...'
  if (Test-Path -LiteralPath $serviceDir) {
    $backupDir = $serviceDir + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Move-Item -LiteralPath $serviceDir -Destination $backupDir
    Write-Host ("تم الاحتفاظ بنسخة من الملفات القديمة: " + $backupDir)
  }
  New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null
  Copy-Item -Path (Join-Path $candidate '*') -Destination $serviceDir -Recurse -Force

  Step 'بنثبّت متطلبات الطباعة المحلية...'
  Push-Location $serviceDir
  try {
    & $npm.Source ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Verify internet connection and Node.js installation.' }
  } finally { Pop-Location }

  Step 'بننشئ مهمة التشغيل التلقائي مع تسجيل الدخول...'
  $script = Join-Path $serviceDir 'windows\install-autostart.ps1'
  if (-not (Test-Path -LiteralPath $script)) { throw 'ملف تثبيت Task Scheduler مفقود.' }
  & $script
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) { throw 'تعذر إنشاء مهمة Windows. راجع صلاحيات المستخدم.' }
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    Start-Sleep -Seconds 2
    if (Healthy) {
      Write-Host ''
      Write-Host '✅ تم تثبيت وتشغيل CUT Print Agent بنجاح.' -ForegroundColor Green
      Write-Host 'ارجع لـ Cashier واضغط «فحص الاتصال».'
      Write-Host 'الطابعة نفسها لم تُختبر بعد؛ اطبع ورقة اختبار واحدة من إعدادات الطباعة.'
      exit 0
    }
  }
  throw 'المهمة اتثبتت لكن /health لا يستجيب. راجع سجل التشغيل داخل print-service\logs.'
} catch {
  ExplainError $_.Exception.Message
  Write-Host ''
  Write-Host 'لن يتم إرسال مهمة طباعة تلقائيًا. يمكنك تشغيل نفس الملف مرة أخرى بعد حل المشكلة.'
  exit 1
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
