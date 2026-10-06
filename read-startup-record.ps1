$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# Read only this application's two owned values, without enumeration.
$itemName = -join ([char[]](0x4e2a, 0x4eba, 0x9996, 0x9875))
$startupKey = $null
$approvalKey = $null
try {
  $startupKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $false)
  $approvalKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run', $false)
  $command = if ($startupKey) { $startupKey.GetValue($itemName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
  $approval = if ($approvalKey) { $approvalKey.GetValue($itemName, $null) } else { $null }
  @{ registered = ($null -ne $command); command = $command; approval = $approval } | ConvertTo-Json -Compress
} finally {
  if ($startupKey) { $startupKey.Dispose() }
  if ($approvalKey) { $approvalKey.Dispose() }
}
