param(
    [Parameter(Mandatory = $true)][long]$WindowHandle,
    [Parameter(Mandatory = $true)][ValidateSet('probe', 'attach', 'restore')][string]$Action,
    [long]$Owner = 0,
    [string]$TopMost = 'false'
)

$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
public static class PersonalHomeDesktopBridge {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr data);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    public static IntPtr FindDesktopHost() {
        IntPtr result = IntPtr.Zero;
        EnumWindows((top, data) => {
            IntPtr view = FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (view != IntPtr.Zero) { result = top; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'PersonalHomeDesktopBridge').Type) {
    Add-Type -TypeDefinition $source
}

$hwnd = [IntPtr]::new($WindowHandle)
$ownerIndex = -8
$extendedStyleIndex = -20
$topMostBit = [long]0x00000008
$noZOrderFlags = 0x0037
$restoreFlags = 0x0033
$bottom = [IntPtr]::new(1)
$topMost = [IntPtr]::new(-1)
$notTopMost = [IntPtr]::new(-2)

if (-not [PersonalHomeDesktopBridge]::IsWindow($hwnd)) { throw 'Trial window is invalid.' }
$desktopHost = [PersonalHomeDesktopBridge]::FindDesktopHost()
if ($desktopHost -eq [IntPtr]::Zero) { throw 'Windows desktop host was not found.' }

if ($Action -eq 'probe') {
    $currentOwner = [PersonalHomeDesktopBridge]::GetWindowLongPtr($hwnd, $ownerIndex).ToInt64()
    @{ ok = $true; desktopHost = $desktopHost.ToInt64(); owner = $currentOwner; attached = ($currentOwner -eq $desktopHost.ToInt64()) } | ConvertTo-Json -Compress
    exit 0
}

if ($Action -eq 'attach') {
    $oldOwner = [PersonalHomeDesktopBridge]::GetWindowLongPtr($hwnd, $ownerIndex).ToInt64()
    $extendedStyle = [PersonalHomeDesktopBridge]::GetWindowLongPtr($hwnd, $extendedStyleIndex).ToInt64()
    [void][PersonalHomeDesktopBridge]::SetWindowLongPtr($hwnd, $ownerIndex, $desktopHost)
    $actualOwner = [PersonalHomeDesktopBridge]::GetWindowLongPtr($hwnd, $ownerIndex).ToInt64()
    if ($actualOwner -ne $desktopHost.ToInt64()) {
        [void][PersonalHomeDesktopBridge]::SetWindowLongPtr($hwnd, $ownerIndex, [IntPtr]::new($oldOwner))
        throw 'Desktop owner verification failed; original owner restored.'
    }
    if (-not [PersonalHomeDesktopBridge]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, $noZOrderFlags)) {
        [void][PersonalHomeDesktopBridge]::SetWindowLongPtr($hwnd, $ownerIndex, [IntPtr]::new($oldOwner))
        throw 'Could not refresh desktop window relationship; original owner restored.'
    }
    @{ ok = $true; owner = $oldOwner; topMost = (($extendedStyle -band $topMostBit) -ne 0); desktopHost = $desktopHost.ToInt64() } | ConvertTo-Json -Compress
    exit 0
}

$wasTopMost = ($TopMost -ieq 'true' -or $TopMost -eq '1')
$after = if ($wasTopMost) { $topMost } else { $notTopMost }
[void][PersonalHomeDesktopBridge]::SetWindowLongPtr($hwnd, $ownerIndex, [IntPtr]::new($Owner))
if (-not [PersonalHomeDesktopBridge]::SetWindowPos($hwnd, $after, 0, 0, 0, 0, $restoreFlags)) { throw 'Original owner restoration failed.' }
$actualOwner = [PersonalHomeDesktopBridge]::GetWindowLongPtr($hwnd, $ownerIndex).ToInt64()
if ($actualOwner -ne $Owner) { throw 'Original owner restoration verification failed.' }
@{ ok = $true; owner = $actualOwner } | ConvertTo-Json -Compress
