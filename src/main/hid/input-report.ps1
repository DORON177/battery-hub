# Sends one HID report and prints the input reports that come back, one hex line each.
# Used for devices that answer through HidD_GetInputReport, which node-hid doesn't expose.
param([string]$Path, [string]$RequestHex, [int]$Size, [int]$InputReportId, [int]$ListenMs = 2500)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class HidReport {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool WriteFile(SafeFileHandle h, byte[] buffer, uint count, out uint written, IntPtr overlapped);
  [DllImport("hid.dll", SetLastError = true)]
  public static extern bool HidD_GetInputReport(SafeFileHandle h, byte[] buffer, int length);
}
'@
$request = New-Object byte[] ($Size)
for ($i = 0; $i -lt $RequestHex.Length / 2 -and $i -lt $Size; $i++) { $request[$i] = [Convert]::ToByte($RequestHex.Substring($i * 2, 2), 16) }
$handle = [HidReport]::CreateFile($Path, 0xC0000000L, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
if ($handle.IsInvalid) { exit 2 }
try {
  $written = [uint32]0
  if (-not [HidReport]::WriteFile($handle, $request, [uint32]$Size, [ref]$written, [IntPtr]::Zero)) { exit 3 }
  $stopAt = [DateTime]::UtcNow.AddMilliseconds($ListenMs)
  while ([DateTime]::UtcNow -lt $stopAt) {
    Start-Sleep -Milliseconds 50
    $report = New-Object byte[] ($Size)
    $report[0] = [byte]$InputReportId
    if ([HidReport]::HidD_GetInputReport($handle, $report, $Size) -and $report[1] -gt 0) {
      [Console]::Out.WriteLine(($report | ForEach-Object { $_.ToString('x2') }) -join '')
    }
  }
} finally {
  $handle.Dispose()
}
