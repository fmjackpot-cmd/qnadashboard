param([int]$Port = 8888)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = Join-Path $taskRoot 'runtime/node.exe'
if (-not (Test-Path -LiteralPath $taskNode -PathType Leaf)) {
    $taskNode = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue).Source
    if (-not $taskNode) {
        $taskBundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
        if (Test-Path -LiteralPath $taskBundledNode -PathType Leaf) {
            $taskNode = $taskBundledNode
        }
    }
}
if (-not $taskNode) {
    throw 'Node.js was not found. Install Node.js 22 or newer, then reopen this launcher.'
}
if ([version]((& $taskNode --version).TrimStart('v')) -lt [version]'22.0.0') { throw 'Node.js 22 or newer is required.' }
$taskEnv = Join-Path $taskRoot '.env'
if (-not (Test-Path -LiteralPath $taskEnv)) {
    Write-Host 'Create the administrator password (at least 6 characters).'
    $taskPassword = Read-Host -AsSecureString 'Administrator password'
    $taskCredential = New-Object System.Net.NetworkCredential('', $taskPassword)
    $taskPlain = $taskCredential.Password
    if ($taskPlain.Length -lt 6 -or $taskPlain.Contains('"') -or $taskPlain.Contains("`r") -or $taskPlain.Contains("`n")) {
        throw 'Use at least 6 characters without double quotes or line breaks.'
    }
    [IO.File]::WriteAllText($taskEnv, 'MEETING_ADMIN_KEY="' + $taskPlain + '"' + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
    $taskPlain = $null
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'netlify-deploy/index.html'))) {
    $taskBuild = Join-Path (Split-Path -Parent $taskRoot) 'scripts/build-netlify.cjs'
    if (-not (Test-Path -LiteralPath $taskBuild)) { throw 'The dashboard build is missing. Re-extract the Windows package.' }
    & $taskNode $taskBuild lan
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed.' }
}
Write-Host 'Keep this window open. Press Ctrl+C to stop the server.'
Write-Host 'Give other computers the LAN address printed below. Participants select an open meeting.'
& $taskNode (Join-Path $PSScriptRoot 'local-server.mjs') --lan --port $Port
exit $LASTEXITCODE
