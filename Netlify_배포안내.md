# Netlify 배포

`netlify-deploy` 폴더를 Netlify Drop(https://app.netlify.com/drop)에 끌어다 놓으면 됩니다. 폴더 안의 index.html이 바로 최상위에 있어야 합니다.

배포 주소에 접속하면 2026년 행정사무감사 행정과 PDF가 자동으로 열립니다. 다른 PDF는 기존 파일 선택 버튼으로 열 수 있습니다. 기본 문서 분석에는 API 키가 필요하지 않습니다. PDF.js와 글꼴 등 CDN 리소스를 불러오므로 인터넷 연결이 필요합니다.

공개 사이트에서는 기본 PDF도 사이트 방문자가 열거나 다운로드할 수 있습니다. `.env`, API 키, Git 저장소, 테스트 자료는 배포 폴더에 포함하지 않습니다.

코드를 수정한 뒤 프로젝트 폴더에서 아래 명령으로 배포 폴더를 갱신하고 다시 업로드하세요.

```powershell
powershell -ExecutionPolicy Bypass -File .\배포폴더_만들기.ps1
```

Git 연동 배포를 사용한다면 Build command는 위 명령을 사용할 수 없습니다(Netlify 빌드 환경은 Linux입니다). 이 폴더를 수동 업로드하는 방식으로 사용하세요.
