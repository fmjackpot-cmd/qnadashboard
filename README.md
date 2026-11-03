# 예상질의 회의 대시보드

PDF 자료를 업로드해 관리자와 참여자가 함께 열람하는 브라우저 대시보드입니다. 관리자가 문항을 선택하면 참여자 화면에 우선 표시되며, 참여자는 각자 자유롭게 탐색할 수 있습니다.

## 로컬 실행

`.env.example`을 참고해 로컬 `.env`에 `ABLY_API_KEY`와 6자 이상의 `MEETING_ADMIN_KEY`를 설정한 뒤 실행합니다. 실제 키는 Git에 올리지 않습니다.

```powershell
.\run-local.bat
```

`http://localhost:8888`을 일반 창과 시크릿 창에서 각각 엽니다. 일반 창에서는 **관리자로 시작하기**로 PDF를 업로드하고, 시크릿 창에서는 **회의 참여하기**로 같은 회의 코드를 입력합니다. 종료는 터미널에서 `Ctrl+C`입니다.

## 검증

```powershell
.\run-tests.bat
```

자세한 검증 방법은 [tests/README.md](tests/README.md), 운영 배포 방법은 [Netlify_배포안내.md](Netlify_배포안내.md)를 참고하세요.

## 폴더 구성

| 경로 | 용도 |
| --- | --- |
| `index.html`, `app.js`, `live-session.js`, `style.css` | 화면·PDF 분석·회의 연결 |
| `netlify/` | 관리자 인증, Ably 전송, PDF 저장·조회 API |
| `scripts/` | 빌드와 로컬 실행 도구 |
| `tests/` | 자동 테스트와 검증에 필요한 PDF 2개 |
| `netlify-deploy/`, `netlify-deploy.zip` | 생성되는 배포 패키지, Git 제외 |
| `node_modules/` | 로컬 실행에 필요한 패키지, Git 제외 |
| `local-archive/` | 테스트에 사용하지 않는 PDF 원본의 로컬 보관, Git 제외 |

기본 PDF는 자동으로 열리지 않습니다. 관리자 업로드 한도는 4.5MB이며, 참여자는 회의 자료를 자동으로 받습니다. GitHub 푸시는 요청할 때만 진행합니다.
