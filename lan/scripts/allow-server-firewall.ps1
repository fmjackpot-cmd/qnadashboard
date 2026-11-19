param([int]$Port = 8888)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskPrincipal = New-Object Security.Principal.WindowsPrincipal($taskIdentity)
if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Right-click allow-server-firewall.bat and choose Run as administrator.'
}
$taskRuleName = "QuestionDashboard-LAN-$Port"
if (-not (Get-NetFirewallRule -Name $taskRuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $taskRuleName -DisplayName "Question Dashboard LAN TCP $Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Domain,Private -RemoteAddress LocalSubnet | Out-Null
}
Write-Host "Allowed TCP $Port from the local subnet on Domain/Private networks."
