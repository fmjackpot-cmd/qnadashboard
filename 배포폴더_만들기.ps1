$ErrorActionPreference = 'Stop'
# Share the same build on Windows and Netlify's Linux build environment.
& node (Join-Path $PSScriptRoot 'scripts/build-netlify.cjs')
if ($LASTEXITCODE -ne 0) { throw '배포 폴더 생성에 실패했습니다.' }
