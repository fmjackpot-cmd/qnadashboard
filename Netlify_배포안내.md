# Netlify 배포 및 관리자 우선 회의

## 동작

- 이용자는 브라우저에서 문항을 자유롭게 열람합니다.
- 관리자가 문항/목차를 선택하거나 **현재 화면 전송**을 누르면, 같은 회의의 이용자 화면이 해당 문항/목차로 전환됩니다. 같은 문항을 다시 전송할 수도 있습니다.
- 전환 뒤에도 이용자는 자유롭게 탐색할 수 있습니다. 확대·스크롤·목록 정렬은 다른 기기에 전송하지 않습니다.
- 약 1.5초 간격으로 최신 이동 정보를 확인합니다. 네트워크·문서 렌더링 시간에 따라 반영이 늦을 수 있습니다. 연결 실패 시 4초 간격으로 다시 시도하고, 재연결/재접속 시 최신 관리자 이동을 적용합니다.
- 관리자 접속을 종료해도 최신 이동은 12시간 동안 남습니다. 회의별로 다른 코드를 사용해주세요. 한 회의는 관리자 한 명이 진행하는 방식이며, 여러 관리자가 접속하면 마지막으로 저장된 이동이 우선합니다.

## Functions를 포함한 배포

실시간 회의는 **Netlify Functions와 Netlify Blobs**를 사용합니다. 정적 폴더/ZIP을 Netlify Drop에 올리기만 하면 회의 서버가 배포되지 않습니다.

1. Netlify 사이트의 환경 변수에 **`MEETING_ADMIN_KEY`**를 등록합니다. Functions에서 사용할 수 있도록 설정하고, 예측하기 어려운 24자 이상의 임의 문자열을 사용하세요. 저장소·배포 폴더·이용자 접속 주소에 키를 넣지 마세요.
2. 프로젝트 루트의 `netlify.toml`을 사용하는 빌드 배포를 실행합니다. Git 연동 시 build command는 `node scripts/build-netlify.cjs`, publish directory는 `netlify-deploy`, functions directory는 `netlify/functions`입니다. **GitHub 푸시는 사용자가 요청할 때만 합니다.**
3. GitHub 공유 없이 CLI를 사용하려면 프로젝트 루트에서 의존성을 설치하고, Netlify CLI로 기존 사이트를 연결한 후 `netlify deploy --build --prod`를 실행합니다. 이 명령은 실제 사이트를 갱신하므로 배포할 때만 실행하세요.
4. 키를 변경했으면 다시 배포하고, 관리자 화면에서도 새 키로 다시 연결합니다.

의존성은 `pnpm install --frozen-lockfile`로 설치할 수 있습니다. Node.js 22 이상을 사용합니다. Netlify 빌드는 pnpm lockfile을 사용해 의존성을 설치합니다.

참고: [Functions 설정](https://docs.netlify.com/build/functions/configuration/), [Blobs 저장소 및 strong consistency](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Functions 환경 변수](https://docs.netlify.com/build/functions/environment-variables/).

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
