# Netlify 배포 및 관리자 우선 회의

## 동작

- 이용자는 브라우저에서 문항을 자유롭게 열람합니다.
- 관리자가 문항/목차를 선택하거나 **현재 화면 전송**을 누르면, 같은 회의의 이용자 화면이 해당 문항/목차로 전환됩니다. 같은 문항을 다시 전송할 수도 있습니다.
- 전환 뒤에도 이용자는 자유롭게 탐색할 수 있습니다. 확대·스크롤·목록 정렬은 다른 기기에 전송하지 않습니다.
- 관리자 이동을 Ably 실시간 연결로 수신합니다. 이용자가 가만히 열람하는 동안 Netlify에 주기적으로 확인 요청을 보내지 않습니다. 최신 문항 조회는 처음 연결하거나 실시간 연결을 복구할 때만 실행합니다. 문서 로딩 중에는 가장 최근 관리자 이동을 보관했다가 적용합니다.
- 관리자는 Netlify에 인증하고 이동할 때만 요청을 보냅니다. 이용자는 Ably 연결을 유지하며, 수신 토큰은 필요할 때 갱신합니다(현재 유효기간 1시간). Ably 연결 유지·재연결 통신은 남으며, 사용량이 완전히 0이 되는 것은 아닙니다.
- 관리자 접속을 종료해도 최신 이동은 12시간 동안 남습니다. 회의별로 다른 코드를 사용해주세요. 한 회의는 관리자 한 명이 진행하는 방식이며, 여러 관리자가 접속하면 마지막으로 저장된 이동이 우선합니다.

## Functions를 포함한 배포

실시간 회의는 **Netlify Functions + Netlify Blobs + Ably Pub/Sub**를 사용합니다. Netlify는 화면·PDF·관리자 인증·최신 상태 저장을 담당하고, Ably는 문항 이동 이벤트만 전달합니다. PDF 본문이나 파일 자체를 Ably로 전송하지 않습니다. 정적 폴더/ZIP을 Netlify Drop에 올리기만 하면 회의 서버가 배포되지 않습니다.

### Ably 가입 후 설정

1. Ably 대시보드에서 **Pub/Sub 앱**을 하나 만듭니다. 앱의 **API Keys**에서 서버용 키를 만들거나 기존 키를 선택합니다.
2. 해당 키에는 이 앱의 `dashboard:*` 채널에 대한 **Publish**와 **Subscribe** 권한이 필요합니다. SDK에서 생성하는 이용자 토큰은 해당 회의 채널의 **Subscribe만** 허용하며, 이용자에게 Publish 권한을 주지 않습니다. Presence/History 기능은 사용하지 않습니다.
3. 전체 API Key 값(`키이름:비밀값`)을 Netlify의 **환경 변수 `ABLY_API_KEY`**에 등록하고 Functions에서 사용할 수 있도록 설정합니다. 브라우저 코드·`dashboard-config.js`·공유 URL·Git에는 넣지 마세요. `.env.example`에는 이름과 설명만 있습니다.
4. 아래의 `MEETING_ADMIN_KEY`도 별도로 설정하고 다시 배포합니다. Ably 키와 관리자 인증키는 서로 다른 값입니다. 이용자는 Ably 계정이나 키를 입력할 필요가 없습니다.

Ably 비밀키는 서버에만 보관합니다. 이용자에게는 한 회의 채널의 수신 권한만 담긴 1시간짜리 서명 토큰 요청을 내려주며, 갱신은 Ably SDK가 처리합니다. Ably 앱의 Pub/Sub 연결과 Netlify Functions 접근이 허용된 네트워크에서 사용하세요.

1. Netlify 사이트의 환경 변수에 **`MEETING_ADMIN_KEY`**를 등록합니다. Functions에서 사용할 수 있도록 설정하고, 6자 이상의 문자열을 사용하세요. 저장소·배포 폴더·이용자 접속 주소에 키를 넣지 마세요.
2. 프로젝트 루트의 `netlify.toml`을 사용하는 빌드 배포를 실행합니다. Git 연동 시 build command는 `node scripts/build-netlify.cjs`, publish directory는 `netlify-deploy`, functions directory는 `netlify/functions`입니다. **GitHub 푸시는 사용자가 요청할 때만 합니다.**
3. GitHub 공유 없이 CLI를 사용하려면 프로젝트 루트에서 의존성을 설치하고, Netlify CLI로 기존 사이트를 연결한 후 `netlify deploy --build --prod`를 실행합니다. 이 명령은 실제 사이트를 갱신하므로 배포할 때만 실행하세요.
4. 키를 변경했으면 다시 배포하고, 관리자 화면에서도 새 키로 다시 연결합니다.

의존성은 `pnpm install --frozen-lockfile`로 설치할 수 있습니다. Node.js 22 이상을 사용합니다. Netlify 빌드는 pnpm lockfile을 사용해 의존성을 설치합니다.

참고: [Functions 설정](https://docs.netlify.com/build/functions/configuration/), [Blobs 저장소 및 strong consistency](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Functions 환경 변수](https://docs.netlify.com/build/functions/environment-variables/).

Ably 참고: [JavaScript SDK](https://ably.com/docs/getting-started/javascript), [토큰 및 권한](https://ably.com/docs/api/token-request-spec).

### 연결 확인

Windows에서 `pnpm` 명령을 찾지 못해도 프로젝트 폴더의 `run-local.bat`을 실행하면 로컬 화면·API 테스트 서버를 시작할 수 있습니다. 로컬 `.env`에 두 키가 필요하며, Netlify 계정의 키를 자동으로 가져오지는 않습니다. 실행 후 `http://localhost:8888`을 일반 창(관리자)과 시크릿 창(이용자)에서 열어 확인하세요. 이 방식은 실제 Ably 연결과 메모리 상태 저장을 사용합니다. 자세한 절차는 `tests/README.md`를 확인하세요.

- 관리자와 이용자를 서로 다른 브라우저/기기에서 같은 회의에 연결합니다.
- 관리자가 3번 문항 선택 → 이용자가 3번 표시 → 이용자가 9번 자유 열람 → 관리자가 4번 선택 → 이용자가 4번으로 우선 전환되는지 확인합니다.
- 관리자가 **현재 화면 전송**을 누르면 같은 문항도 다시 적용되어야 합니다.
- 이용자가 새로 접속하거나 연결을 복구하면 최신 관리자 문항이 표시되어야 합니다.
- 이용자 개발자 도구 Network에서 Netlify `meeting` 요청이 1.5초마다 반복되지 않아야 합니다. Ably WebSocket과 연결 유지 통신은 정상입니다.
- `ABLY_API_KEY`가 없거나 잘못된 경우 연결 오류를 표시합니다. 주기적인 확인 방식으로 자동 전환하지 않습니다. Ably 발행 실패 시 관리자에게 재전송 오류를 표시합니다. 최신 상태 저장 후 발행에 실패한 경우 새로 접속한 이용자는 저장된 최신 문항을 볼 수 있으므로 **현재 화면 전송**으로 다시 맞춰주세요.
- 배포 미리보기는 배포별 채널/저장소로 운영 회의와 격리합니다. 새 배포 후에는 두 기기 모두 최신 주소를 새로고침하고 같은 회의에 다시 연결해주세요.

## 회의 사용

1. 관리자: 배포 주소에서 공통 PDF가 열린 뒤 **회의 연결**을 누릅니다.
2. 회의 코드(예: `audit-2026-1103`)와 관리자 인증키를 입력하고 **관리자로 연결·현재 화면 전송**을 누릅니다. 키는 현재 탭의 메모리에만 유지하며, 새로고침하면 다시 입력합니다.
3. **회의 연결**을 다시 열어 **이용자 접속 주소**를 복사해 전달합니다. 주소에는 회의 코드만 들어가며 관리자 키는 포함되지 않습니다.
4. 이용자는 해당 주소를 열면 자동 연결됩니다. 직접 회의 코드를 입력해 **이용자로 연결**할 수도 있습니다. 이용자 이동은 다른 기기에 전송되지 않습니다.
5. 이용자가 따로 열람하는 중에 관리자가 문항을 바꾸면 관리자 문항이 우선 표시됩니다. **관리자 화면으로**를 누르면 먼저 돌아갈 수 있습니다.
6. **회의 연결 해제**를 누르면 해당 기기는 개별 열람으로 돌아갑니다.

실시간 전송은 배포된 공통 PDF를 기준으로 합니다. 관리자가 PC에서 선택한 PDF 자체를 업로드·공유하는 기능은 포함하지 않습니다. 다른 공통 PDF로 바꾸려면 `scripts/build-netlify.cjs`의 `pdfName`과 `example`의 PDF를 변경하고 다시 배포하세요. 이용자가 로컬 PDF를 보고 있어도 다음 관리자 이동을 받으면 공통 PDF로 돌아갑니다. PDF의 SHA-256이 다르면 잘못된 문항으로 이동하지 않고 버전 오류를 표시합니다.

회의 코드는 이용자 인증 수단이 아닙니다. 공개 사이트의 PDF는 방문자가 열거나 다운로드할 수 있습니다. 내부 자료라면 사이트 접근 제한을 별도로 설정하세요. 관리자 키는 제어 권한만 보호합니다.

## 정적 배포 패키지 갱신

```powershell
powershell -ExecutionPolicy Bypass -File .\배포폴더_만들기.ps1
Compress-Archive -Path .\netlify-deploy\* -DestinationPath .\netlify-deploy.zip -Force
```

이 패키지는 기본 PDF를 자동으로 여는 정적 화면입니다. Functions가 없는 호스팅에서는 개별 열람만 가능합니다. `.env`, API 키, Git 저장소, 서버 코드, 테스트 자료는 정적 배포 폴더에 포함하지 않습니다. PDF.js·글꼴 CDN을 불러오므로 인터넷 연결이 필요합니다. 기본 문서 분석에는 Gemini API 키가 필요하지 않습니다.
