param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$DataPath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $DataPath -PathType Leaf)) { throw "RAW print data missing" }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WinRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr handle, int level, ref DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
}
'@
$bytes = [System.IO.File]::ReadAllBytes($DataPath)
if ($bytes.Length -lt 1 -or $bytes.Length -gt 2097152) { throw "Unsafe RAW job size" }
$handle = [IntPtr]::Zero
if (-not [WinRawPrint]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) {
  throw "OpenPrinter failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
$started = $false
$pageStarted = $false
try {
  $doc = New-Object WinRawPrint+DOCINFO
  $doc.pDocName = 'CUT Salon ESC/POS Receipt'
  $doc.pDatatype = 'RAW'
  $jobId = [WinRawPrint]::StartDocPrinter($handle, 1, [ref]$doc)
  if ($jobId -le 0) { throw "StartDocPrinter failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $started = $true
  if (-not [WinRawPrint]::StartPagePrinter($handle)) {
    throw "StartPagePrinter failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  $pageStarted = $true
  $written = 0
  if (-not [WinRawPrint]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written) -or $written -ne $bytes.Length) {
    throw "WritePrinter failed or incomplete: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  Write-Output "SPOOLED:$jobId"
} finally {
  if ($pageStarted) { [void][WinRawPrint]::EndPagePrinter($handle) }
  if ($started) { [void][WinRawPrint]::EndDocPrinter($handle) }
  [void][WinRawPrint]::ClosePrinter($handle)
}
