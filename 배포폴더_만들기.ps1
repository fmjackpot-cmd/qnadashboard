$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$deployRoot = Join-Path $projectRoot 'netlify-deploy'
$docsRoot = Join-Path $deployRoot 'docs'
$pdfName = '[제출] 2026년 행정사무감사 예상질의 답변서(행정과).pdf'
$pdfSource = Join-Path (Join-Path $projectRoot 'example') $pdfName
if (-not (Test-Path -LiteralPath $pdfSource)) { throw "PDF 파일을 찾을 수 없습니다: $pdfSource" }
New-Item -ItemType Directory -Path $docsRoot -Force | Out-Null
foreach ($asset in @('index.html', 'app.js', 'style.css', 'manifest.json')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $asset) -Destination (Join-Path $deployRoot $asset) -Force
}
Copy-Item -LiteralPath $pdfSource -Destination (Join-Path $docsRoot 'audit-2026.pdf') -Force
$config = @{ defaultPdf = @{ url = './docs/audit-2026.pdf'; name = $pdfName } } | ConvertTo-Json -Compress
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $deployRoot 'dashboard-config.js'), "window.DASHBOARD_CONFIG = $config;`n", $utf8)
$headers = @'
/*
  X-Content-Type-Options: nosniff
/*.html
  Cache-Control: public, max-age=0, must-revalidate
/app.js
  Cache-Control: public, max-age=0, must-revalidate
/dashboard-config.js
  Cache-Control: public, max-age=0, must-revalidate
/docs/*
  Cache-Control: public, max-age=0, must-revalidate
'@
[System.IO.File]::WriteAllText((Join-Path $deployRoot '_headers'), $headers + "`n", $utf8)
Write-Host "배포 폴더 생성 완료: $deployRoot"
