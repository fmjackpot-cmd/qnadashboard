param([string]$OutputZip = 'dashboard-server-windows.zip')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLan = Join-Path $taskRoot 'lan'
$taskLanScripts = Join-Path $taskLan 'scripts'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
if ([version]((& $taskNode --version).TrimStart('v')) -lt [version]'22.0.0') { throw 'Node.js 22 or newer is required.' }
if ((& $taskNode -p 'process.arch') -ne 'x64') { throw 'Use the Windows x64 Node.js runtime for this package.' }
$taskNodeTag = & $taskNode --version
$taskCache = Join-Path $taskRoot 'server-vendor'
$taskOut = Join-Path $taskRoot 'server-package'
# Only this fixed generated folder can be recreated.
if ([IO.Path]::GetFullPath($taskOut) -ne (Join-Path ([IO.Path]::GetFullPath($taskRoot)) 'server-package')) { throw 'Unsafe output folder.' }
New-Item -ItemType Directory -Force -Path $taskCache | Out-Null
$taskDownloads = @{
    'pdf.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    'pdf.worker.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    'pdf-lib.min.js' = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
    'all.min.css' = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
    'fa-solid-900.woff2' = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2'
    'fa-regular-400.woff2' = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2'
    'fa-brands-400.woff2' = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2'
    'PDFJS-LICENSE' = 'https://raw.githubusercontent.com/mozilla/pdf.js/v3.11.174/LICENSE'
    'PDFLIB-LICENSE' = 'https://raw.githubusercontent.com/Hopding/pdf-lib/v1.17.1/LICENSE.md'
    'FONTAWESOME-LICENSE' = 'https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.4.0/LICENSE.txt'
    'NODE-LICENSE' = "https://raw.githubusercontent.com/nodejs/node/$taskNodeTag/LICENSE"
}
foreach ($taskName in $taskDownloads.Keys) {
    $taskTarget = Join-Path $taskCache $taskName
    if (-not (Test-Path -LiteralPath $taskTarget)) {
        Write-Host "Downloading $taskName"
        Invoke-WebRequest -Uri $taskDownloads[$taskName] -OutFile $taskTarget -UseBasicParsing
    }
}
& $taskNode (Join-Path $PSScriptRoot 'build-netlify.cjs') lan
if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed.' }
if (Test-Path -LiteralPath $taskOut) { Remove-Item -LiteralPath $taskOut -Recurse -Force }
foreach ($taskDir in @('runtime', 'scripts', 'netlify/lib', 'netlify/functions', 'netlify-deploy/vendor/webfonts')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $taskOut $taskDir) | Out-Null
}
Copy-Item -LiteralPath $taskNode -Destination (Join-Path $taskOut 'runtime/node.exe')
Copy-Item -LiteralPath (Join-Path $taskCache 'NODE-LICENSE') -Destination (Join-Path $taskOut 'runtime/LICENSE')
foreach ($taskFile in @('start-server.bat', 'allow-server-firewall.bat', '서버설치안내.md')) {
    Copy-Item -LiteralPath (Join-Path $taskLan $taskFile) -Destination $taskOut
}
foreach ($taskFile in @('local-server.mjs', 'lan-broker.mjs', 'lan-directory.mjs', 'server-storage.mjs', 'start-server.ps1', 'allow-server-firewall.ps1', 'desktop-launch.mjs', 'server-settings.mjs')) {
    Copy-Item -LiteralPath (Join-Path $taskLanScripts $taskFile) -Destination (Join-Path $taskOut 'scripts')
}
foreach ($taskFile in @('netlify/functions/meeting.mjs', 'netlify/functions/meeting-document.mjs', 'netlify/lib/meeting-documents.mjs', 'netlify/lib/meeting-ably.mjs', 'netlify/lib/meeting-broker.mjs')) {
    Copy-Item -LiteralPath (Join-Path $taskLan $taskFile) -Destination (Join-Path $taskOut $taskFile)
}
Copy-Item -Path (Join-Path $taskLan 'netlify-deploy/*') -Destination (Join-Path $taskOut 'netlify-deploy') -Recurse -Force
foreach ($taskName in $taskDownloads.Keys | Where-Object { $_ -ne 'NODE-LICENSE' }) {
    $taskDestination = if ($taskName.EndsWith('.woff2')) { 'netlify-deploy/vendor/webfonts' } else { 'netlify-deploy/vendor' }
    Copy-Item -LiteralPath (Join-Path $taskCache $taskName) -Destination (Join-Path $taskOut $taskDestination)
}
$taskUtf8 = New-Object Text.UTF8Encoding($false)
$taskHtmlPath = Join-Path $taskOut 'netlify-deploy/index.html'
$taskHtml = [IO.File]::ReadAllText($taskHtmlPath)
$taskHtml = $taskHtml -replace '<link[^>]+pretendard[^>]+>', ''
$taskHtml = $taskHtml.Replace('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css', './vendor/all.min.css')
$taskHtml = $taskHtml.Replace('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', './vendor/pdf.min.js')
$taskHtml = $taskHtml.Replace('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', './vendor/pdf-lib.min.js')
[IO.File]::WriteAllText($taskHtmlPath, $taskHtml, $taskUtf8)
$taskAppPath = Join-Path $taskOut 'netlify-deploy/app.js'
$taskApp = [IO.File]::ReadAllText($taskAppPath).Replace('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', './vendor/pdf.worker.min.js')
[IO.File]::WriteAllText($taskAppPath, $taskApp, $taskUtf8)
$taskCssPath = Join-Path $taskOut 'netlify-deploy/vendor/all.min.css'
[IO.File]::WriteAllText($taskCssPath, [IO.File]::ReadAllText($taskCssPath).Replace('../webfonts/', './webfonts/'), $taskUtf8)
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $taskCompiler)) { throw 'The Windows .NET Framework compiler is required to build the launcher.' }
& $taskCompiler /nologo /target:winexe /platform:x64 /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll ("/out:" + (Join-Path $taskOut 'DashboardServer.exe')) (Join-Path $taskLanScripts 'DesktopLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
Compress-Archive -Path (Join-Path $taskOut '*') -DestinationPath (Join-Path $taskRoot $OutputZip) -Force
Write-Host "Created $OutputZip (Windows x64, no user keys or meeting data)."
