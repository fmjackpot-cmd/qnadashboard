param([int]$Port = 8888, [switch]$App)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNodePath = if ($taskNodeCommand) { $taskNodeCommand.Source } else { $null }
if (-not $taskNodePath) {
    $taskBundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path -LiteralPath $taskBundledNode -PathType Leaf) { $taskNodePath = $taskBundledNode }
}
if (-not $taskNodePath) {
    Write-Host 'Node.js was not found. Install Node.js 22 or newer, then reopen the terminal.' -ForegroundColor Red
    exit 1
}
$taskNodeVersion = & $taskNodePath --version
if ($LASTEXITCODE -ne 0 -or [version]($taskNodeVersion.TrimStart('v')) -lt [version]'22.0.0') {
    Write-Host 'Node.js 22 or newer is required.' -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/ably/package.json'))) {
    Write-Host 'Project dependencies are missing. Install the dependencies before starting the local server.' -ForegroundColor Red
    exit 1
}
Push-Location -LiteralPath $taskRoot
try {
    & $taskNodePath (Join-Path $PSScriptRoot 'build-netlify.cjs')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $taskServerArguments = @((Join-Path $PSScriptRoot 'local-server.mjs'), '--port', $Port)
    if ($App) {
        $taskBrowserCandidates = @(
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
            "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )
        $taskBrowserPath = $taskBrowserCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if (-not $taskBrowserPath) { throw 'Install Microsoft Edge or Google Chrome to use the app window.' }
        $taskServerArguments += @('--app-browser', $taskBrowserPath)
    }
    & $taskNodePath @taskServerArguments
    $taskServerExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $taskServerExitCode
