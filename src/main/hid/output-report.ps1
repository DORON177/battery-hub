# Sends HID output reports with HidD_SetOutputReport, a USB control transfer, which node-hid doesn't
# expose. Some receivers ignore the same report sent with WriteFile. Replies arrive as input reports
# on every open handle, so the caller reads them on its own handle.
# Usage: output-report.ps1 <device path> <hex report> [<hex report> ...]
param([string]$Path, [string[]]$Reports)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class HidOutput {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("hid.dll", SetLastError = true)]
  public static extern bool HidD_SetOutputReport(SafeFileHandle h, byte[] buffer, int length);
}
'@
$handle = [HidOutput]::CreateFile($Path, 0xC0000000L, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
if ($handle.IsInvalid) { exit 2 }
try {
  foreach ($hex in $Reports) {
    $report = New-Object byte[] ($hex.Length / 2)
    for ($i = 0; $i -lt $report.Length; $i++) { $report[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
    if (-not [HidOutput]::HidD_SetOutputReport($handle, $report, $report.Length)) { exit 3 }
    Start-Sleep -Milliseconds 60
  }
} finally {
  $handle.Dispose()
}
