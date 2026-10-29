# 파서 검증

- 단위·회귀 테스트: `node --test tests/parser.test.cjs`
- 실제 PDF 통합 테스트: `node tests/pdf-integration.cjs <pdf.js-3.11.174의-pdf.cjs-절대경로> <pdf.worker.cjs-절대경로>`
- PDF.js는 index.html과 같은 3.11.174 버전을 사용합니다. CDN의 pdf.min.js와 pdf.worker.min.js를 각각 .cjs 파일로 저장해 경로를 전달합니다.

2026-10-29 검증 결과: 회귀 테스트 5개 통과. 행정사무감사 PDF 120쪽의 47개 문항 시작·끝 쪽수 모두 목차와 일치. 공유재산관리계획 PDF 14쪽의 10개 문항 시작 쪽수 일치. API 키가 설정된 경우에도 두 표 형식은 외부 AI 호출 없이 분석됨.

브라우저 제어 연결이 없어 대시보드 화면 조작은 검증하지 못했습니다. 원본 PDF 목차는 이미지로 렌더링해 확인했습니다.
