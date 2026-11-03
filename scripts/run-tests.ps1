$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNodePath = if ($taskNodeCommand) { $taskNodeCommand.Source } else { $null }

# Use the existing bundled runtime when Node.js is not on the terminal's PATH.
if (-not $taskNodePath) {
    $taskBundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path -LiteralPath $taskBundledNode -PathType Leaf) {
        $taskNodePath = $taskBundledNode
    }
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
    Write-Host 'Project dependencies are missing. Install the dependencies before running the tests.' -ForegroundColor Red
    exit 1
}

Push-Location -LiteralPath $taskRoot
try {
    Write-Host "Running dashboard tests with Node.js $taskNodeVersion"
    $taskTestFiles = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'tests') -Filter '*.test.cjs' -File | Sort-Object Name | ForEach-Object { $_.FullName })
    if ($taskTestFiles.Count -eq 0) { throw 'No test files were found.' }
    & $taskNodePath --test @taskTestFiles
    $taskTestExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $taskTestExitCode
