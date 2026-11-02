# Batteries Windows already knows about: paired Bluetooth devices and Xbox controllers.
# Prints one JSON line per scan. With -Every it keeps scanning until the app exits.
# Talks to the device manager API directly: the Get-PnpDevice cmdlets take over 10 seconds.
param([int]$Every = 0, [int]$ParentId = 0)
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class Found {
  public string Id;
  public string Name;
  public int Battery;
  public bool Connected;
}

public static class Batteries {
  const uint FILTER_PRESENT = 0x100, FILTER_CLASS = 0x200;
  const string BLUETOOTH_CLASS = "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}";

  [StructLayout(LayoutKind.Sequential)]
  struct PropertyKey { public Guid Fmtid; public uint Pid; }
  static PropertyKey Key(string guid, uint pid) { return new PropertyKey { Fmtid = new Guid(guid), Pid = pid }; }

  static readonly PropertyKey BATTERY = Key("104EA319-6EE2-4701-BD47-8DDBF425BBE5", 2);
  static readonly PropertyKey CONNECTED = Key("83DA6326-97A6-4088-9453-A1923F573B29", 15);
  static readonly PropertyKey NAME = Key("b725f130-47ef-101a-a5f1-02608c9eebac", 10);

  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern int CM_Get_Device_ID_List_SizeW(out int length, string filter, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern int CM_Get_Device_ID_ListW(string filter, char[] buffer, int length, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern int CM_Locate_DevNodeW(out uint node, string id, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  static extern int CM_Get_DevNode_PropertyW(uint node, ref PropertyKey key, out uint type, byte[] buffer, ref int size, uint flags);

  static byte[] Read(uint node, PropertyKey key) {
    uint type;
    int size = 512;
    byte[] buffer = new byte[size];
    if (CM_Get_DevNode_PropertyW(node, ref key, out type, buffer, ref size, 0) != 0) return null;
    Array.Resize(ref buffer, size);
    return buffer;
  }

  public static List<Found> Bluetooth() {
    var found = new List<Found>();
    uint flags = FILTER_CLASS | FILTER_PRESENT;
    int length;
    if (CM_Get_Device_ID_List_SizeW(out length, BLUETOOTH_CLASS, flags) != 0) return found;
    var ids = new char[length];
    if (CM_Get_Device_ID_ListW(BLUETOOTH_CLASS, ids, length, flags) != 0) return found;
    foreach (string id in new string(ids).Split(new[] { '\0' }, StringSplitOptions.RemoveEmptyEntries)) {
      uint node;
      if (CM_Locate_DevNodeW(out node, id, 0) != 0) continue;
      byte[] battery = Read(node, BATTERY);
      if (battery == null || battery.Length < 1) continue;
      byte[] connected = Read(node, CONNECTED);
      byte[] name = Read(node, NAME);
      found.Add(new Found {
        Id = id,
        Name = name == null ? "Bluetooth device" : Encoding.Unicode.GetString(name).TrimEnd('\0'),
        Battery = battery[0],
        Connected = connected == null || connected[0] != 0,
      });
    }
    return found;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PadBattery { public byte Type; public byte Level; }
  [DllImport("xinput1_4.dll")]
  public static extern uint XInputGetBatteryInformation(uint user, byte deviceType, out PadBattery info);
}
'@

function Scan-Bluetooth {
  foreach ($device in [Batteries]::Bluetooth()) {
    [pscustomobject]@{ id = 'bt:' + $device.Id; name = $device.Name; kind = 'bluetooth'; capacity = $device.Battery; connected = $device.Connected }
  }
}

function Scan-XInput {
  $WIRELESS = 2, 3 # alkaline and rechargeable; wired pads report neither
  foreach ($slot in 0..3) {
    $info = New-Object Batteries+PadBattery
    $result = 1
    try { $result = [Batteries]::XInputGetBatteryInformation($slot, 0, [ref]$info) } catch { return }
    if ($result -ne 0 -or $WIRELESS -notcontains [int]$info.Type) { continue }
    [pscustomobject]@{ id = "xinput:$slot"; name = "Xbox controller $($slot + 1)"; kind = 'xinput'; capacity = @(5, 35, 65, 100)[[int]$info.Level]; connected = $true }
  }
}

do {
  $found = @(@(Scan-Bluetooth) + @(Scan-XInput) | Where-Object { $_ })
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $found -Compress -Depth 3))
  [Console]::Out.Flush()
  if ($Every -le 0) { break }
  Start-Sleep -Seconds $Every
  if ($ParentId -and -not (Get-Process -Id $ParentId)) { break }
} while ($true)
