// PDF.js Worker Configuration
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// 41 Questions Default Dataset (Fallback and Reference)
const defaultItems = [
  // 2페이지 목차 (질의 1 ~ 20)
  { id: 1, team: "학생배치팀", category: "사전기획용역", officer: "김남희", title: "(가칭)장성초 사전기획용역비 명시이월 사유 및 집행현황은?", docPage: "1", startPdfPage: 4, endPdfPage: 4, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "", attach: "684 쪽", opinion: "" },
  { id: 2, team: "학생배치팀", category: "사전기획용역", officer: "김남희", title: "2024년 명시이월 학교신설 사전기획용역비 집행현황은?", docPage: "2", startPdfPage: 5, endPdfPage: 5, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "", attach: "684 쪽", opinion: "" },
  { id: 3, team: "학생배치팀", category: "학교용지부담금 등", officer: "김남희", title: "학교용지부담금 현황은?", docPage: "3", startPdfPage: 6, endPdfPage: 6, pageCount: 1, tocPage: 2, settle: "", explain: "", attach: "", opinion: "재무제표 19,36 쪽" },
  { id: 4, team: "학생배치팀", category: "학교용지부담금 등", officer: "구영모", title: "혜원학교, 이은학교, 특수학급 신·증설 예산 현황은?", docPage: "4~5", startPdfPage: 7, endPdfPage: 8, pageCount: 2, tocPage: 2, settle: "133 쪽", explain: "335 쪽", attach: "", opinion: "" },
  { id: 5, team: "학생배치팀", category: "학교용지부담금 등", officer: "김남희", title: "(가칭)동남고 설립 계획은?", docPage: "6~7", startPdfPage: 9, endPdfPage: 10, pageCount: 2, tocPage: 2, settle: "134 쪽", explain: "", attach: "684 쪽", opinion: "" },
  { id: 6, team: "학생배치팀", category: "학교용지부담금 등", officer: "강은해", title: "학생배치계획관리의 지방자치단체등이전 사업(분담금)의 집행현황은?", docPage: "8", startPdfPage: 11, endPdfPage: 11, pageCount: 1, tocPage: 2, settle: "137 쪽", explain: "345~346 쪽", attach: "", opinion: "" },
  { id: 7, team: "학생배치팀", category: "학교용지부담금 등", officer: "김진옥", title: "제천산업고 계속비 이월 사유는?", docPage: "9", startPdfPage: 12, endPdfPage: 12, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "339 쪽", attach: "", opinion: "" },
  { id: 8, team: "학생배치팀", category: "학교용지부담금 등", officer: "김진옥", title: "제천산업고 지연에 따른 수업 대책은?", docPage: "10", startPdfPage: 13, endPdfPage: 13, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "339 쪽", attach: "", opinion: "" },
  { id: 9, team: "학생배치팀", category: "학교용지부담금 등", officer: "김진옥", title: "학교신증설사업(제천산업고, 동성고) 계속비이월 이월 내역은?", docPage: "11", startPdfPage: 14, endPdfPage: 14, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "339 쪽", attach: "", opinion: "" },
  { id: 10, team: "학생배치팀", category: "학교용지부담금 등", officer: "김진옥", title: "2026년도 예산편성액을 추가로 조정하지 않은 사유는?", docPage: "12", startPdfPage: 15, endPdfPage: 15, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "339 쪽", attach: "", opinion: "" },
  { id: 11, team: "학생배치팀", category: "학교용지부담금 등", officer: "김진옥", title: "제천산업고 2027년 5월 준공은 가능한가?", docPage: "13", startPdfPage: 16, endPdfPage: 16, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "339 쪽", attach: "", opinion: "" },
  { id: 12, team: "학생배치팀", category: "학교용지부담금 등", officer: "김진옥", title: "제천산업고 2024년~2026년 불용액 합계가 약 48억 원인 이유는?", docPage: "14", startPdfPage: 17, endPdfPage: 17, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "339 쪽", attach: "", opinion: "" },
  { id: 13, team: "학생배치팀", category: "학교용지부담금 등", officer: "김진옥", title: "동성고 계속비 이월(16,688천원) 이월 사유는?", docPage: "15", startPdfPage: 18, endPdfPage: 18, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "339 쪽", attach: "", opinion: "" },
  { id: 14, team: "학생배치팀", category: "학교용지부담금 등", officer: "김진옥", title: "충북생명산업고 증축공사 집행잔액(549,017천원) 발생 사유는?", docPage: "16", startPdfPage: 19, endPdfPage: 19, pageCount: 1, tocPage: 2, settle: "134 쪽", explain: "338 쪽", attach: "", opinion: "" },
  { id: 15, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "그 밖에 통학지원이 필요한 경우에 따른 지원 현황은?", docPage: "17~18", startPdfPage: 20, endPdfPage: 21, pageCount: 2, tocPage: 2, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 16, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "제천시 교육경비보조금 중단 시 송학중 통학대책은?", docPage: "19~20", startPdfPage: 22, endPdfPage: 23, pageCount: 2, tocPage: 2, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 17, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "제천 미니복합타운 원거리 통학 초등학생의 통학대책은?", docPage: "21~22", startPdfPage: 24, endPdfPage: 25, pageCount: 2, tocPage: 2, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 18, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "2025년 특수학교 통학지원 현황은?", docPage: "23", startPdfPage: 26, endPdfPage: 26, pageCount: 1, tocPage: 2, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 19, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "임차차량 원가계산 방법은?", docPage: "24~25", startPdfPage: 27, endPdfPage: 28, pageCount: 2, tocPage: 2, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 20, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "2025~2026년 통학지원 현황은?", docPage: "26", startPdfPage: 29, endPdfPage: 29, pageCount: 1, tocPage: 2, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },

  // 3페이지 목차 (질의 21 ~ 41)
  { id: 21, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "2026학년도 통학택시 및 통학비 지원 기준은?", docPage: "27~28", startPdfPage: 30, endPdfPage: 31, pageCount: 2, tocPage: 3, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 22, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "통학택시 운영 방법은?", docPage: "29", startPdfPage: 32, endPdfPage: 32, pageCount: 1, tocPage: 3, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 23, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "통학택시 단가 산정기준은?", docPage: "30", startPdfPage: 33, endPdfPage: 33, pageCount: 1, tocPage: 3, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 24, team: "학생배치팀", category: "통학버스", officer: "이아리", title: "통학비 산정기준은?", docPage: "31", startPdfPage: 34, endPdfPage: 34, pageCount: 1, tocPage: 3, settle: "136 쪽", explain: "345 쪽", attach: "", opinion: "" },
  { id: 25, team: "학생배치팀", category: "적정규모", officer: "김진옥", title: "작은학교 현황은?", docPage: "32~33", startPdfPage: 35, endPdfPage: 36, pageCount: 2, tocPage: 3, settle: "137 쪽", explain: "", attach: "", opinion: "" },
  { id: 26, team: "학생배치팀", category: "적정규모", officer: "김진옥", title: "충청북도교육청의 적정규모학교육성 기준 및 추진절차는?", docPage: "34", startPdfPage: 37, endPdfPage: 37, pageCount: 1, tocPage: 3, settle: "137 쪽", explain: "", attach: "", opinion: "" },
  { id: 27, team: "학생배치팀", category: "적정규모", officer: "김진옥", title: "분교장 개편 기준은?", docPage: "35", startPdfPage: 38, endPdfPage: 38, pageCount: 1, tocPage: 3, settle: "137 쪽", explain: "", attach: "", opinion: "" },
  { id: 28, team: "학생배치팀", category: "적정규모", officer: "김진옥", title: "향후 적정규모학교 육성 예정학교 현황은?", docPage: "36", startPdfPage: 39, endPdfPage: 39, pageCount: 1, tocPage: 3, settle: "137 쪽", explain: "", attach: "", opinion: "" },
  { id: 29, team: "학생배치팀", category: "적정규모", officer: "김진옥", title: "2026년 교직원이 학생보다 많은 학교 현황은?", docPage: "37~38", startPdfPage: 40, endPdfPage: 41, pageCount: 2, tocPage: 3, settle: "137 쪽", explain: "", attach: "", opinion: "" },
  { id: 30, team: "학생배치팀", category: "적정규모", officer: "김진옥", title: "적정규모학교육성 사업 주요 집행 내역은?", docPage: "39", startPdfPage: 42, endPdfPage: 42, pageCount: 1, tocPage: 3, settle: "137 쪽", explain: "", attach: "", opinion: "" },
  { id: 31, team: "학생배치팀", category: "기금전출금", officer: "권명성", title: "기금전출금 집행 내역은?", docPage: "40~41", startPdfPage: 43, endPdfPage: 44, pageCount: 2, tocPage: 3, settle: "138 쪽", explain: "349 쪽", attach: "", opinion: "" },
  { id: 32, team: "학생배치팀", category: "기금전출금", officer: "권명성", title: "적정규모학교육성기금 초과 지출 발생(701,390원) 사유는?", docPage: "42", startPdfPage: 45, endPdfPage: 45, pageCount: 1, tocPage: 3, settle: "454 쪽", explain: "", attach: "", opinion: "" },
  { id: 33, team: "조직관리팀", category: "조직관리", officer: "민해순", title: "조직분석 시도분담금 내역?", docPage: "43~44", startPdfPage: 46, endPdfPage: 47, pageCount: 2, tocPage: 3, settle: "135 쪽", explain: "344 쪽", attach: "", opinion: "" },
  { id: 34, team: "조직관리팀", category: "조직관리", officer: "민해순", title: "교육문화복합시설(구.상당초 및 구.복대초) 이월액 및 불용액 발생 사유는?", docPage: "45~46", startPdfPage: 48, endPdfPage: 49, pageCount: 2, tocPage: 3, settle: "137 쪽", explain: "347~348 쪽", attach: "77 쪽", opinion: "" },
  { id: 35, team: "조직관리팀", category: "조직관리", officer: "곽병두", title: "위원회 운영 예산 집행률(61.97%)이 저조한 사유는?", docPage: "47~51", startPdfPage: 50, endPdfPage: 54, pageCount: 5, tocPage: 3, settle: "", explain: "", attach: "", opinion: "결산검사의견서 37~39 쪽" },
  { id: 36, team: "법무팀", category: "학원관리", officer: "고권영", title: "학원 설립 운영자, 강사 및 교습자 위탁연수 운영 현황은?", docPage: "52", startPdfPage: 55, endPdfPage: 55, pageCount: 1, tocPage: 3, settle: "", explain: "340 쪽", attach: "", opinion: "결산검사의견서 134 쪽" },
  { id: 37, team: "법무팀", category: "학원관리", officer: "고권영", title: "학원 편·불법 운영 모니터링 위탁계약 현황은?", docPage: "53", startPdfPage: 56, endPdfPage: 56, pageCount: 1, tocPage: 3, settle: "", explain: "340 쪽", attach: "", opinion: "결산검사의견서 134 쪽" },
  { id: 38, team: "법무팀", category: "학원관리", officer: "고권영", title: "학원 등 불법 운영 신고 포상금(보전금) 전액 불용 사유는?", docPage: "54", startPdfPage: 57, endPdfPage: 57, pageCount: 1, tocPage: 3, settle: "", explain: "340 쪽", attach: "", opinion: "결산검사의견서 134 쪽" },
  { id: 39, team: "법무팀", category: "소송관리", officer: "이승운", title: "소송에서 패소하여 판결금 또는 소송비용을 지급한 내역은?", docPage: "55", startPdfPage: 58, endPdfPage: 58, pageCount: 1, tocPage: 3, settle: "135 쪽", explain: "342 쪽", attach: "", opinion: "" },
  { id: 40, team: "법무팀", category: "소송관리", officer: "이승운", title: "법무관리 사업 중 복리후생비 불용액(19,367천원) 발생 사유는?", docPage: "56~57", startPdfPage: 59, endPdfPage: 60, pageCount: 2, tocPage: 3, settle: "135 쪽", explain: "342 쪽", attach: "", opinion: "" },
  { id: 41, team: "법무팀", category: "소송관리", officer: "이승운", title: "법무관리 사업 추진내용 및 불용액(62,693천원) 발생 사유는?", docPage: "58~59", startPdfPage: 61, endPdfPage: 62, pageCount: 2, tocPage: 3, settle: "135 쪽", explain: "342 쪽", attach: "", opinion: "" }
];

// Application State
let currentItems = [];
let currentPdfDoc = null;
let currentPdfBytes = null;
let currentPdfFileName = "";
let currentScale = 1.15;
let selectedQuestionId = null;
let currentQuestion = null;
let currentViewMode = 'question'; // 'question' | 'toc'
let currentListViewMode = 'grid'; // 'grid' | 'list'
let geminiApiKey = "";
let tocPages = []; // Detected TOC pages
let windowDragCounter = 0;

// PDF Page Margin Cropping (Independently tuned per user feedback)
const CROP_LEFT = 0.038;   // 왼쪽: 3.8% (글자 잘림 방지)
const CROP_RIGHT = 0.075;  // 오른쪽: 7.5% (여백 최소화)
const CROP_TOP = 0.027;    // 위쪽: 2.7% (상단 표 테두리 보호)
const CROP_BOTTOM = 0.027; // 아래쪽: 2.7% (하단 여백 최소화)

// ==========================================================================
// 1. API KEY MANAGER (.env & localStorage)
// ==========================================================================

async function initApiKey() {
  // 1. Try loading from .env file
  try {
    const res = await fetch('.env');
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/GEMINI_API_KEY\s*=\s*([^\r\n#]+)/i);
      if (match && match[1].trim()) {
        geminiApiKey = match[1].trim();
        updateKeyStatusUI(true, ".env 파일에서 로드됨");
        return;
      }
    }
  } catch (err) {
    console.log(".env fetch skipped or restricted:", err);
  }

  // 2. Try loading from localStorage
  const localKey = localStorage.getItem('GEMINI_API_KEY');
  if (localKey && localKey.trim()) {
    geminiApiKey = localKey.trim();
    updateKeyStatusUI(true, "브라우저 저장소에서 로드됨");
    return;
  }

  updateKeyStatusUI(false, "미설정 (자체 스마트 텍스트 분석기 사용)");
}

function updateKeyStatusUI(isSet, message) {
  const hintEl = document.getElementById('key-status-hint');
  const inputEl = document.getElementById('input-api-key');
  if (hintEl) {
    hintEl.innerText = `현재 상태: ${message}`;
    if (isSet) {
      hintEl.classList.add('active');
    } else {
      hintEl.classList.remove('active');
    }
  }
  if (inputEl && geminiApiKey) {
    inputEl.value = geminiApiKey;
  }
}

function setupApiKeyModal() {
  const modal = document.getElementById('ai-settings-modal');
  const btnOpen = document.getElementById('btn-ai-settings');
  const btnClose = document.getElementById('btn-close-ai-modal');
  const btnCancel = document.getElementById('btn-cancel-ai-key');
  const btnSave = document.getElementById('btn-save-ai-key');
  const inputKey = document.getElementById('input-api-key');

  if (btnOpen && modal) {
    btnOpen.onclick = () => {
      if (inputKey && geminiApiKey) inputKey.value = geminiApiKey;
      modal.style.display = 'flex';
    };
  }

  const closeModal = () => {
    if (modal) modal.style.display = 'none';
  };

  const btnTest = document.getElementById('btn-test-ai-key');
  if (btnTest && inputKey) {
    btnTest.onclick = async () => {
      const keyToTest = inputKey.value.trim() || geminiApiKey;
      if (!keyToTest) {
        alert("테스트할 API 키를 먼저 입력해주세요.");
        return;
      }
      btnTest.disabled = true;
      btnTest.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 테스트 중...`;
      try {
        const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${keyToTest}`;
        const res = await fetch(testUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "ping" }] }]
          })
        });
        if (res.ok) {
          alert("✅ 연결 성공!\n구글 Gemini API 서버와 정상적으로 통신되었습니다.\n이 키를 사용할 수 있습니다.");
          updateKeyStatusUI(true, "인증 성공 (정상 작동)");
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || res.statusText;
          alert(`❌ 연결 실패 (${res.status})\n구글 서버 응답: ${errMsg}`);
        }
      } catch (err) {
        alert(`❌ 연결 테스트 중 네트워크 오류:\n${err.message}`);
      } finally {
        btnTest.disabled = false;
        btnTest.innerHTML = `<i class="fa-solid fa-vial-circle-check"></i> 연결 테스트`;
      }
    };
  }

  if (btnClose) btnClose.onclick = closeModal;
  if (btnCancel) btnCancel.onclick = closeModal;

  if (btnSave && inputKey) {
    btnSave.onclick = () => {
      const newKey = inputKey.value.trim();
      if (newKey) {
        geminiApiKey = newKey;
        localStorage.setItem('GEMINI_API_KEY', newKey);
        updateKeyStatusUI(true, "브라우저 저장소에 등록 완료");
        alert("Gemini API 키가 성공적으로 저장되었습니다.\n새 PDF 파일을 열면 AI 정밀 파싱이 적용됩니다.");
      } else {
        geminiApiKey = "";
        localStorage.removeItem('GEMINI_API_KEY');
        updateKeyStatusUI(false, "키 삭제됨 (내장 분석기 사용)");
        alert("API 키가 삭제되었습니다. 자체 내장 분석기를 사용합니다.");
      }
      closeModal();
    };
  }

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
  }
}

// ==========================================================================
// 2. DOCUMENT STRUCTURE SCANNER & ADAPTIVE LOCATOR
// ==========================================================================

// Fast extraction of all pages text from PDF
async function extractAllPagesText(pdfDoc) {
  const pages = [];
  const maxPages = pdfDoc.numPages;
  for (let p = 1; p <= maxPages; p++) {
    try {
      const page = await pdfDoc.getPage(p);
      const content = await page.getTextContent();
      const str = content.items.map(it => it.str).join(' ');
      pages.push({ pageNum: p, text: str });
    } catch (err) {
      pages.push({ pageNum: p, text: "" });
    }
  }
  return pages;
}

// Automatically detect cover presence and TOC pages
function analyzeDocumentStructure(pageTexts) {
  const detectedTocPages = [];
  let hasCover = false;

  if (pageTexts.length === 0) {
    return { hasCover: false, tocPages: [] };
  }

  // Check Page 1: Is it a cover or does it have TOC / questions directly?
  const p1Text = pageTexts[0]?.text || "";
  const hasTocWordP1 = /목\s*차|차\s*례|질의\s*순서|질의\s*목록/i.test(p1Text);
  const qCountP1 = (p1Text.match(/[?？]|\b문항\s*\d+|\b질의\s*\d+/g) || []).length;

  // If page 1 has TOC words or multiple questions, there is NO separate cover
  if (!hasTocWordP1 && qCountP1 <= 1) {
    hasCover = true;
  }

  // Check pages 1 to 6 for TOC characteristics
  const maxCheckPages = Math.min(6, pageTexts.length);
  for (let i = 0; i < maxCheckPages; i++) {
    const pageObj = pageTexts[i];
    const text = pageObj.text;
    const hasTocTitle = /목\s*차|차\s*례|질의\s*목록|질의\s*순서/i.test(text);
    const qMatches = text.match(/[?？]|\b문항\s*\d+|\b질의\s*\d+/g) || [];
    
    // Page is considered TOC if it has TOC title OR has >= 3 questions in a single page
    if (hasTocTitle || qMatches.length >= 3) {
      detectedTocPages.push(pageObj.pageNum);
    }
  }

  return {
    hasCover,
    tocPages: detectedTocPages
  };
}

// Search actual body pages using question keywords and question numbers
// This solves the problem: "No page numbers in TOC" & "No cover page" & "Arbitrary format"
function locateQuestionsByContent(items, pdfDoc, pageTexts, detectedTocPages) {
  if (!items || items.length === 0) return [];

  const lastToc = (detectedTocPages && detectedTocPages.length > 0) ? Math.max(...detectedTocPages) : 0;
  const searchStart = Math.max(1, lastToc + 1);

  const locatedItems = [];
  let prevFoundPage = searchStart;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let foundPage = null;

    // 1. Clean Title Keyword (First 8~16 non-space characters)
    const titleClean = (item.title || "").replace(/[\s\(\)\[\]\.\,\?\!\-_·]/g, '');
    const titleKeyword = titleClean.substring(0, Math.min(14, titleClean.length));

    // 2. Question Number Search Pattern: "[문항 1]", "문항 1", "1."
    const qNumPattern = new RegExp(`\\[\\s*문항\\s*${item.id}\\s*\\]|문항\\s*${item.id}\\b|질의\\s*${item.id}\\b|^\\s*${item.id}\\s*[\\.\\)]`, 'i');

    // Search forward from previous found page
    for (let p = prevFoundPage; p <= pdfDoc.numPages; p++) {
      const pText = pageTexts[p - 1]?.text || "";
      const pTextClean = pText.replace(/[\s\(\)\[\]\.\,\?\!\-_·]/g, '');

      const matchKeyword = (titleKeyword.length >= 4 && pTextClean.includes(titleKeyword));
      const matchQNum = qNumPattern.test(pText);

      if (matchKeyword || matchQNum) {
        foundPage = p;
        break;
      }
    }

    // If not found forward, search from searchStart
    if (!foundPage && searchStart <= pdfDoc.numPages) {
      for (let p = searchStart; p <= pdfDoc.numPages; p++) {
        const pText = pageTexts[p - 1]?.text || "";
        const pTextClean = pText.replace(/[\s\(\)\[\]\.\,\?\!\-_·]/g, '');
        if (titleKeyword.length >= 4 && pTextClean.includes(titleKeyword)) {
          foundPage = p;
          break;
        }
      }
    }

    // Fallback: If still not found, estimate smoothly
    if (!foundPage) {
      foundPage = Math.min(pdfDoc.numPages, prevFoundPage);
    }

    prevFoundPage = foundPage;

    locatedItems.push({
      ...item,
      startPdfPage: foundPage
    });
  }

  // Calculate endPdfPage and pageCount
  for (let i = 0; i < locatedItems.length; i++) {
    const curr = locatedItems[i];
    const next = locatedItems[i + 1];

    if (next) {
      curr.endPdfPage = Math.max(curr.startPdfPage, next.startPdfPage > curr.startPdfPage ? next.startPdfPage - 1 : curr.startPdfPage);
    } else {
      curr.endPdfPage = pdfDoc.numPages;
    }
    curr.pageCount = curr.endPdfPage - curr.startPdfPage + 1;

    // If docPage is missing or blank, automatically create docPage label
    if (!curr.docPage || curr.docPage.trim() === "") {
      curr.docPage = (curr.startPdfPage === curr.endPdfPage) 
        ? `${curr.startPdfPage}` 
        : `${curr.startPdfPage}~${curr.endPdfPage}`;
    }
  }

  return locatedItems;
}

// Built-in intelligent client-side text parser (when AI key is not set or failed)
function parseQuestionsHeuristic(pageTexts, structure) {
  const items = [];
  const targetPages = (structure.tocPages && structure.tocPages.length > 0)
    ? pageTexts.filter(p => structure.tocPages.includes(p.pageNum))
    : pageTexts;

  let currentCategory = "일반";
  let currentTeam = "";
  let questionCounter = 1;

  for (const pageObj of targetPages) {
    const text = pageObj.text || "";
    // Split sentences by question marks or linebreaks
    const chunks = text.split(/(?<=[?？])|(?=\[문항\s*\d+\])|\r?\n/);

    for (let chunk of chunks) {
      const line = chunk.trim();
      if (!line || line.length < 5) continue;

      // Detect team or category keywords
      if (line.includes("팀") && line.length < 20) {
        currentTeam = line.replace(/[^가-힣a-zA-Z0-9]/g, '');
      }

      // Check if chunk is a question
      const isQuestion = /[?？]$/.test(line) || /\[문항\s*\d+\]/i.test(line) || /^\d+[\.\)]\s+/.test(line);
      
      if (isQuestion && line.length >= 6) {
        let cleanTitle = line
          .replace(/^\[문항\s*\d+\]\s*/i, '')
          .replace(/^\d+[\.\)]\s*/, '')
          .trim();

        // Avoid duplicates
        if (cleanTitle.length >= 5 && !items.some(it => it.title === cleanTitle)) {
          // Extract possible doc page reference
          const pageMatch = line.match(/(\d+)(?:\s*~\s*(\d+))?\s*쪽/);
          const docPageStr = pageMatch ? (pageMatch[2] ? `${pageMatch[1]}~${pageMatch[2]}` : pageMatch[1]) : "";

          items.push({
            id: questionCounter++,
            team: currentTeam,
            category: currentCategory,
            officer: "",
            title: cleanTitle,
            docPage: docPageStr,
            tocPage: pageObj.pageNum,
            settle: "",
            explain: "",
            attach: "",
            opinion: ""
          });
        }
      }
    }
  }

  return items;
}

// ==========================================================================
// 3. AI-BASED PARSER (Gemini API with Fallback)
// ==========================================================================

async function parseUploadedPdf(pdfDoc, fileName) {
  const loadingOverlay = document.getElementById('ai-loading-overlay');
  const loadingTitle = document.getElementById('ai-loading-title');
  const loadingDesc = document.getElementById('ai-loading-desc');

  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  if (loadingTitle) loadingTitle.innerText = "PDF 전체 텍스트 및 구조 분석 중...";
  if (loadingDesc) loadingDesc.innerText = "문서의 표지, 목차, 질문 목록 및 쪽수 유무를 정밀 스캔하고 있습니다.";

  // 1. Fast Full Text Extraction
  const pageTexts = await extractAllPagesText(pdfDoc);
  
  // 2. Analyze Document Structure (Cover & TOC detection)
  const structure = analyzeDocumentStructure(pageTexts);
  tocPages = structure.tocPages;

  let rawParsedItems = [];

  // 3. AI Parsing if Gemini API Key is available
  if (geminiApiKey) {
    try {
      if (loadingTitle) loadingTitle.innerText = "Gemini AI가 목차를 분석하는 중...";
      if (loadingDesc) loadingDesc.innerText = "부서별 질의 문항, 카테고리, 관련 쪽수를 정밀 구조화하고 있습니다.";

      // Gather text from TOC pages or first 6 pages
      const targetPageNums = structure.tocPages.length > 0 
        ? structure.tocPages 
        : [1, 2, 3, 4].filter(p => p <= pdfDoc.numPages);

      let contextText = "";
      for (const p of targetPageNums) {
        contextText += `\n--- [PDF Page ${p}] ---\n` + (pageTexts[p - 1]?.text || "");
      }

      const prompt = `당신은 공공기관/교육청 결산 및 행정감사 질의서 분석 전문가입니다.
제공된 텍스트는 PDF 문서의 앞부분(목차 및 관련 페이지) 텍스트입니다.
중요 참고사항:
- 이 문서는 1페이지에 표지가 없을 수도 있습니다 (1페이지부터 바로 목차 또는 본문일 수 있음).
- 목차에 쪽수(페이지 번호)가 적혀있지 않을 수도 있습니다.
- 문서에 목차가 아예 없을 수도 있습니다.

문서에 나타난 모든 질의 문항 목록을 정밀하게 분석하여 순수 JSON 배열 형식으로만 반환하세요.

[요구 스키마]:
- [ { ... }, { ... } ] 형태의 JSON 배열
- 각 객체 필드:
  - id: 문항 번호 (정수 1, 2, 3...)
  - team: 담당 부서 또는 팀명 (텍스트에 나타난 대로, 없으면 "")
  - category: 세부 카테고리/소제목 (없으면 "일반")
  - officer: 담당자 이름 (있으면 기입, 없으면 "")
  - title: 질의 제목 전문 (질문 전체 문장 누락 없이)
  - docPage: 목차에 적힌 문서 본문 쪽수 (쪽수가 없거나 모르면 빈 문자열 "")
  - settle: 결산서 연관 쪽수 (없으면 "")
  - explain: 설명자료 연관 쪽수 (없으면 "")
  - attach: 첨부/부속서류 연관 쪽수 (없으면 "")
  - opinion: 의견서 연관 쪽수 (없으면 "")
  - tocPage: 해당 문항이 발견된 목차의 PDF 쪽수 (정수, 보통 1, 2 또는 3)

주의: 설명이나 마크다운 코드블록(\`\`\`json 등) 없이 오직 파싱 가능한 순수 JSON 배열만 반환하세요.

[문서 텍스트]:
${contextText}
`;

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiApiKey}`;
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        let rawReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        rawReply = rawReply.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(rawReply);
        if (Array.isArray(parsed) && parsed.length > 0) {
          rawParsedItems = parsed;
          console.log(`Gemini AI parsed ${parsed.length} questions.`);
        }
      } else {
        console.warn("Gemini API call returned status:", response.status);
      }
    } catch (aiErr) {
      console.warn("AI parsing failed or error:", aiErr);
    }
  }

  // 4. Fallback to Heuristic Client-Side Parser if AI was not used or failed
  if (!rawParsedItems || rawParsedItems.length === 0) {
    if (loadingTitle) loadingTitle.innerText = "자체 스마트 파서로 문항 추출 중...";
    rawParsedItems = parseQuestionsHeuristic(pageTexts, structure);
    console.log(`Heuristic parser found ${rawParsedItems.length} questions.`);
  }

  // 5. Ultimate Fallback (Only if uploaded file text had zero questions and matches original default file)
  if (!rawParsedItems || rawParsedItems.length === 0) {
    if (fileName && fileName.includes("0908")) {
      rawParsedItems = [...defaultItems];
      structure.tocPages = [2, 3];
    } else {
      // Create minimal question items based on pages
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        rawParsedItems.push({
          id: p,
          team: "",
          category: "문서 내용",
          officer: "",
          title: `${p}쪽 내용`,
          docPage: `${p}`,
          startPdfPage: p,
          endPdfPage: p,
          pageCount: 1
        });
      }
    }
  }

  // 6. Content-based Precise Page Location (Matches keywords to actual PDF body pages)
  if (loadingTitle) loadingTitle.innerText = "실제 PDF 본문 페이지 위치 매핑 중...";
  if (loadingDesc) loadingDesc.innerText = "각 문항의 실제 시작 및 끝 페이지를 정밀 매칭하고 있습니다.";

  const finalItems = locateQuestionsByContent(rawParsedItems, pdfDoc, pageTexts, structure.tocPages);
  
  currentItems = finalItems;
  if (structure.tocPages.length > 0) {
    tocPages = structure.tocPages;
  } else {
    tocPages = [1];
  }

  if (loadingOverlay) loadingOverlay.style.display = 'none';
}

// ==========================================================================
// 4. SIDEBAR RENDERING (Grid Mode & Title List Mode)
// ==========================================================================

function renderQuestionList() {
  const listEl = document.getElementById('q-list');
  const sidebar = document.getElementById('sidebar');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!currentPdfDoc) {
    listEl.innerHTML = `
      <div style="padding: 24px 12px; text-align: center; color: #94a3b8; font-size: 0.82rem; line-height: 1.5;">
        <i class="fa-solid fa-file-arrow-up" style="font-size: 1.8rem; margin-bottom: 8px; color: #cbd5e1; display: block;"></i>
        PDF 문서를 열면<br>새 파일의 목차가 표시됩니다.
      </div>
    `;
    return;
  }

  if (!currentItems || currentItems.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 30px; text-align: center; color: #94a3b8; font-size: 0.88rem;">
        질의 데이터가 없습니다.
      </div>
    `;
    return;
  }

  // Group items by category maintaining original order
  const categoryOrder = [];
  const groups = {};
  currentItems.forEach(item => {
    const cat = item.category || "일반";
    if (!groups[cat]) {
      groups[cat] = [];
      categoryOrder.push(cat);
    }
    groups[cat].push(item);
  });

  // Apply CSS class based on active list view mode
  if (currentListViewMode === 'list') {
    listEl.classList.add('mode-title-list');
    if (sidebar) sidebar.classList.add('mode-title-list');
  } else {
    listEl.classList.remove('mode-title-list');
    if (sidebar) sidebar.classList.remove('mode-title-list');
  }

  categoryOrder.forEach(catName => {
    const items = groups[catName];
    if (!items || items.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'cat-group';

    // Category Header Bar
    const headerEl = document.createElement('div');
    headerEl.className = 'cat-header';
    const teamName = items[0].team || '';
    headerEl.innerHTML = `
      <span class="cat-title">${catName}</span>
      <span class="cat-team-badge">${teamName}</span>
    `;
    groupEl.appendChild(headerEl);

    if (currentListViewMode === 'grid') {
      // 1) GRID MODE: 3-column Number Buttons
      const gridEl = document.createElement('div');
      gridEl.className = 'cat-btn-grid';

      items.forEach(item => {
        const btn = document.createElement('button');
        const isActive = (currentViewMode === 'question' && selectedQuestionId === item.id);
        btn.className = `btn-q-num ${isActive ? 'active' : ''}`;
        btn.innerText = item.id;
        const officerStr = item.officer ? `\n담당: ${item.officer}` : '';
        btn.title = `[문항 ${item.id}] (${item.docPage}p) ${item.title}${officerStr}`;

        btn.addEventListener('click', () => {
          openQuestion(item.id);
        });

        gridEl.appendChild(btn);
      });

      groupEl.appendChild(gridEl);
    } else {
      // 2) TITLE LIST MODE: Vertical Detailed Title Cards
      items.forEach(item => {
        const itemEl = document.createElement('div');
        const isActive = (currentViewMode === 'question' && selectedQuestionId === item.id);
        itemEl.className = `q-title-item ${isActive ? 'active' : ''}`;
        itemEl.id = `sidebar-item-${item.id}`;

        const refParts = [];
        if (item.settle) refParts.push(`결산 ${item.settle}`);
        if (item.explain) refParts.push(`설명 ${item.explain}`);
        if (item.attach) refParts.push(`첨부 ${item.attach}`);
        if (item.opinion) refParts.push(`의견 ${item.opinion}`);

        const refsHtml = refParts.length > 0
          ? `<div class="q-title-refs">${refParts.map(r => `<span class="q-title-ref-tag">${r}</span>`).join('')}</div>`
          : '';

        const pageLabel = item.docPage ? `문서 ${item.docPage}p` : `PDF ${item.startPdfPage}p`;

        itemEl.innerHTML = `
          <div class="q-title-top-row">
            <span class="q-title-badge">${item.id}</span>
            <span class="q-title-page-hint">${pageLabel}</span>
          </div>
          <div class="q-title-text" title="${item.title}">${item.title}</div>
          ${refsHtml}
        `;

        itemEl.addEventListener('click', () => {
          openQuestion(item.id);
        });

        groupEl.appendChild(itemEl);
      });
    }

    listEl.appendChild(groupEl);
  });

  // Auto scroll to active item in title list mode
  if (currentListViewMode === 'list' && selectedQuestionId) {
    setTimeout(() => {
      const activeEl = document.getElementById(`sidebar-item-${selectedQuestionId}`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 50);
  }
}

function setupSidebarTabs() {
  const btnGrid = document.getElementById('tab-btn-grid');
  const btnList = document.getElementById('tab-btn-list');

  if (btnGrid && btnList) {
    btnGrid.onclick = () => {
      if (currentListViewMode === 'grid') return;
      currentListViewMode = 'grid';
      btnGrid.classList.add('active');
      btnList.classList.remove('active');
      renderQuestionList();
    };

    btnList.onclick = () => {
      if (currentListViewMode === 'list') return;
      currentListViewMode = 'list';
      btnList.classList.add('active');
      btnGrid.classList.remove('active');
      renderQuestionList();
    };
  }
}

// ==========================================================================
// 5. CORE VIEWER & RENDERING ENGINE
// ==========================================================================

async function calcFitScale(samplePdfPageNum) {
  const viewportContainer = document.getElementById('pdf-viewport');
  if (!viewportContainer || !currentPdfDoc) return 1.15;
  try {
    const pageNum = Math.max(1, Math.min(samplePdfPageNum, currentPdfDoc.numPages));
    const page = await currentPdfDoc.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1.0 });

    const cropLeftPx = unscaledViewport.width * CROP_LEFT;
    const cropRightPx = unscaledViewport.width * CROP_RIGHT;
    const croppedWidth = unscaledViewport.width - cropLeftPx - cropRightPx;

    const isMobile = window.innerWidth <= 640;
    const paddingDeduction = isMobile ? 6 : 24;
    const availableWidth = viewportContainer.clientWidth - paddingDeduction;

    if (availableWidth <= 100 || croppedWidth <= 0) return 1.15;
    const fitScale = availableWidth / croppedWidth;
    return Math.max(0.6, Math.min(3.0, fitScale));
  } catch (err) {
    console.error("Error calculating fit scale:", err);
    return 1.15;
  }
}

async function renderQuestionAnswerPage(pageNum, q, container) {
  const card = document.createElement('div');
  card.className = 'pdf-page-card';
  card.id = `q-page-${pageNum}`;

  const tag = document.createElement('div');
  tag.className = 'page-indicator-tag';
  const relPage = (pageNum - q.startPdfPage) + 1;
  const pageCount = q.pageCount || 1;
  tag.innerText = `문항 ${q.id} (${relPage}/${pageCount} 쪽) - PDF ${pageNum}쪽`;
  card.appendChild(tag);

  const canvas = document.createElement('canvas');
  card.appendChild(canvas);
  container.appendChild(card);

  const page = await currentPdfDoc.getPage(pageNum);
  const unscaledViewport = page.getViewport({ scale: 1.0 });

  const cropLeftPx = unscaledViewport.width * CROP_LEFT;
  const cropRightPx = unscaledViewport.width * CROP_RIGHT;
  const cropTopPx = unscaledViewport.height * CROP_TOP;
  const cropBottomPx = unscaledViewport.height * CROP_BOTTOM;

  const croppedWidth = unscaledViewport.width - cropLeftPx - cropRightPx;
  const croppedHeight = unscaledViewport.height - cropTopPx - cropBottomPx;

  const finalWidth = Math.floor(croppedWidth * currentScale);
  const finalHeight = Math.floor(croppedHeight * currentScale);

  const viewport = page.getViewport({
    scale: currentScale,
    offsetX: -cropLeftPx * currentScale,
    offsetY: -cropTopPx * currentScale
  });
  const ctx = canvas.getContext('2d');

  canvas.width = finalWidth;
  canvas.height = finalHeight;
  card.style.width = finalWidth + 'px';
  card.style.height = finalHeight + 'px';

  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
}

async function renderCurrentView(autoFit = true) {
  const viewportContainer = document.getElementById('pdf-viewport');
  if (!viewportContainer || !currentPdfDoc || !currentQuestion) return;

  currentViewMode = 'question';
  const q = currentQuestion;
  selectedQuestionId = q.id;

  // Deactivate TOC button
  const btnToc = document.getElementById('btn-show-toc');
  if (btnToc) btnToc.classList.remove('active');

  renderQuestionList();

  if (autoFit) {
    currentScale = await calcFitScale(q.startPdfPage);
  }
  const zoomLevelEl = document.getElementById('zoom-level');
  if (zoomLevelEl) zoomLevelEl.innerText = Math.round(currentScale * 100) + '%';

  // Update Question Number Pill Badge
  const qNumPill = document.getElementById('badge-q-num-pill');
  if (qNumPill) {
    qNumPill.innerText = `${q.id}`;
    qNumPill.classList.remove('badge-toc-mode');
  }

  const badgeTitle = document.getElementById('current-mode-title');
  const refParts = [];
  if (q.settle) refParts.push(`결산서 ${q.settle}`);
  if (q.explain) refParts.push(`설명자료 ${q.explain}`);
  if (q.attach) refParts.push(`첨부 ${q.attach}`);
  if (q.opinion) refParts.push(`의견서 ${q.opinion}`);

  const refsHtml = refParts.length > 0 
    ? `<span class="badge-refs">${refParts.join(' · ')}</span>` 
    : '';

  if (badgeTitle) {
    badgeTitle.innerHTML = `
      <span class="badge-q-title">${q.title}</span>
      ${refsHtml}
    `;
  }
  const modeBadge = document.getElementById('current-view-mode-badge');
  if (modeBadge) {
    const refText = refParts.length > 0 ? ` (${refParts.join(' · ')})` : '';
    modeBadge.title = `[문항 ${q.id}] ${q.title}${refText}`;
  }

  viewportContainer.innerHTML = '';
  viewportContainer.scrollTop = 0;

  for (let p = q.startPdfPage; p <= q.endPdfPage; p++) {
    await renderQuestionAnswerPage(p, q, viewportContainer);
  }
}

// ==========================================================================
// 6. CONTINUOUS TOC VIEWER (Full Multi-page Vertical Scroll)
// ==========================================================================

async function renderTocPage(pageNum, currentIdx, totalPages, container) {
  const card = document.createElement('div');
  card.className = 'pdf-page-card toc-card';
  card.id = `toc-page-${pageNum}`;

  const tag = document.createElement('div');
  tag.className = 'page-indicator-tag';
  tag.innerText = `전체 목차 (${currentIdx}/${totalPages}) - PDF ${pageNum}쪽`;
  card.appendChild(tag);

  const canvas = document.createElement('canvas');
  card.appendChild(canvas);
  container.appendChild(card);

  const page = await currentPdfDoc.getPage(pageNum);
  const unscaledViewport = page.getViewport({ scale: 1.0 });

  const cropLeftPx = unscaledViewport.width * CROP_LEFT;
  const cropRightPx = unscaledViewport.width * CROP_RIGHT;
  const cropTopPx = unscaledViewport.height * CROP_TOP;
  const cropBottomPx = unscaledViewport.height * CROP_BOTTOM;

  const croppedWidth = unscaledViewport.width - cropLeftPx - cropRightPx;
  const croppedHeight = unscaledViewport.height - cropTopPx - cropBottomPx;

  const finalWidth = Math.floor(croppedWidth * currentScale);
  const finalHeight = Math.floor(croppedHeight * currentScale);

  const viewport = page.getViewport({
    scale: currentScale,
    offsetX: -cropLeftPx * currentScale,
    offsetY: -cropTopPx * currentScale
  });
  const ctx = canvas.getContext('2d');

  canvas.width = finalWidth;
  canvas.height = finalHeight;
  card.style.width = finalWidth + 'px';
  card.style.height = finalHeight + 'px';

  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
}

async function openTocView(autoFit = true) {
  if (!currentPdfDoc) {
    alert("먼저 PDF 문서를 열어주세요.");
    return;
  }

  if (!tocPages || tocPages.length === 0) {
    alert("이 문서에는 별도의 목차 페이지가 감지되지 않았습니다.\n첫 번째 문항으로 이동합니다.");
    if (currentItems.length > 0) openQuestion(currentItems[0].id, true);
    return;
  }

  currentViewMode = 'toc';
  selectedQuestionId = null;

  // Activate TOC button
  const btnToc = document.getElementById('btn-show-toc');
  if (btnToc) btnToc.classList.add('active');

  renderQuestionList();

  // Status Badge in Toolbar
  const qNumPill = document.getElementById('badge-q-num-pill');
  if (qNumPill) {
    qNumPill.innerText = '목차';
    qNumPill.classList.add('badge-toc-mode');
  }

  const badgeTitle = document.getElementById('current-mode-title');
  if (badgeTitle) {
    badgeTitle.innerHTML = `
      <span class="badge-q-title">📑 전체 목차 열람 모드 (세로 연속 스크롤)</span>
      <span class="badge-refs">${tocPages.length}페이지 전체 표시</span>
    `;
  }

  // Calculate Fit Scale using first TOC page
  const firstTocPage = tocPages[0] || 1;
  if (autoFit) {
    currentScale = await calcFitScale(firstTocPage);
  }
  const zoomLevelEl = document.getElementById('zoom-level');
  if (zoomLevelEl) zoomLevelEl.innerText = Math.round(currentScale * 100) + '%';

  const viewportContainer = document.getElementById('pdf-viewport');
  if (!viewportContainer) return;
  viewportContainer.innerHTML = '';
  viewportContainer.scrollTop = 0;

  // Render all TOC pages continuously
  for (let i = 0; i < tocPages.length; i++) {
    const pageNum = tocPages[i];
    await renderTocPage(pageNum, i + 1, tocPages.length, viewportContainer);
  }
}

async function openQuestion(questionId, autoFit = true) {
  const q = currentItems.find(i => i.id === questionId);
  if (!q) return;

  currentQuestion = q;
  await renderCurrentView(autoFit);
}

function applyZoom(newScale) {
  currentScale = Math.max(0.6, Math.min(2.5, newScale));
  if (currentViewMode === 'toc') {
    openTocView(false);
  } else {
    renderCurrentView(false);
  }
}

// ==========================================================================
// 7. PDF FILE LOADING & DYNAMIC REFRESH PIPELINE
// ==========================================================================

async function loadPdfBuffer(buffer, fileName) {
  if (!buffer || buffer.byteLength === 0) {
    alert("선택한 파일이 비어있습니다.");
    return;
  }

  currentPdfBytes = buffer.slice(0);
  currentPdfFileName = fileName || "결산예상질의_답변서.pdf";

  // Reset items to ensure fresh parse for uploaded file
  currentItems = [];
  selectedQuestionId = null;
  currentQuestion = null;

  try {
    const uint8 = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8 });
    currentPdfDoc = await loadingTask.promise;
    
    // Hide upload overlay
    const uploadOverlay = document.getElementById('upload-overlay');
    if (uploadOverlay) {
      uploadOverlay.style.display = 'none';
    }

    // Dynamic Adaptive Parsing for Uploaded PDF
    await parseUploadedPdf(currentPdfDoc, fileName);

    // Initial Start: Open Question 1 or TOC
    if (currentItems.length > 0) {
      currentQuestion = currentItems[0];
      selectedQuestionId = currentItems[0].id;
      renderQuestionList();
      await openQuestion(currentItems[0].id, true);
    } else {
      renderQuestionList();
      await openTocView(true);
    }
  } catch (err) {
    console.error("Error loading PDF:", err);
    alert("PDF 파일을 불러오는 중 오류가 발생했습니다: " + (err && err.message ? err.message : err));
  }
}

function processPdfFile(file) {
  if (!file) return;

  const fileName = file.name || '';
  const fileType = file.type || '';
  const isPdf = fileName.toLowerCase().endsWith('.pdf') || fileType.toLowerCase().includes('pdf');

  if (!isPdf) {
    alert("PDF 형식의 파일(.pdf)만 열 수 있습니다.\nHWP/HWPX 파일은 PDF로 변환 후 열어주세요.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    if (ev.target && ev.target.result) {
      loadPdfBuffer(ev.target.result, file.name);
    }
  };
  reader.onerror = (err) => {
    console.error("FileReader error:", err);
    alert("파일을 읽는 도중 오류가 발생했습니다.");
  };
  reader.readAsArrayBuffer(file);
}

// ==========================================================================
// 8. DRAG & DROP PIPELINE (Unified Window & Dropzone)
// ==========================================================================

function resetDragVisuals() {
  windowDragCounter = 0;
  const dropZone = document.getElementById('drop-zone');
  const uploadOverlay = document.getElementById('upload-overlay');
  const globalDragOverlay = document.getElementById('window-drag-overlay');
  if (dropZone) dropZone.classList.remove('dragover');
  if (uploadOverlay) uploadOverlay.classList.remove('dragover');
  if (globalDragOverlay) globalDragOverlay.classList.remove('active');
}

function handleDroppedFiles(dataTransfer) {
  if (!dataTransfer) return;
  let file = null;
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    file = dataTransfer.files[0];
  } else if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file') {
        file = item.getAsFile();
        if (file) break;
      }
    }
  }

  if (file) {
    processPdfFile(file);
  } else {
    console.warn("No file detected in dropped dataTransfer");
  }
}

// Window Drag & Drop Listeners
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  windowDragCounter++;

  const uploadOverlay = document.getElementById('upload-overlay');
  const dropZone = document.getElementById('drop-zone');
  const globalDragOverlay = document.getElementById('window-drag-overlay');
  const isOverlayActive = uploadOverlay && uploadOverlay.style.display !== 'none';

  if (isOverlayActive) {
    if (dropZone) dropZone.classList.add('dragover');
    if (uploadOverlay) uploadOverlay.classList.add('dragover');
  } else {
    if (globalDragOverlay) globalDragOverlay.classList.add('active');
  }
}, false);

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
}, false);

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  windowDragCounter--;
  if (windowDragCounter <= 0) {
    resetDragVisuals();
  }
}, false);

window.addEventListener('drop', (e) => {
  e.preventDefault();
  resetDragVisuals();
  handleDroppedFiles(e.dataTransfer);
}, false);

// ==========================================================================
// 9. INITIALIZATION & EVENT BINDINGS
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize API Key from .env or localStorage
  initApiKey();
  setupApiKeyModal();
  setupSidebarTabs();

  // 2. Setup Sidebar Resizer
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  if (sidebar && resizer) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newWidth = Math.max(160, Math.min(500, startWidth + (e.clientX - startX)));
      sidebar.style.width = newWidth + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (currentViewMode === 'toc') {
          openTocView(true);
        } else {
          renderCurrentView(true);
        }
      }
    });
  }

  // 3. Zoom Controls
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomFit = document.getElementById('btn-zoom-fit');

  if (btnZoomIn) {
    btnZoomIn.onclick = () => applyZoom(currentScale + 0.15);
  }
  if (btnZoomOut) {
    btnZoomOut.onclick = () => applyZoom(currentScale - 0.15);
  }
  if (btnZoomFit) {
    btnZoomFit.onclick = () => {
      if (currentViewMode === 'toc') {
        openTocView(true);
      } else {
        renderCurrentView(true);
      }
    };
  }

  // 4. TOC View Button in Toolbar
  const btnShowToc = document.getElementById('btn-show-toc');
  if (btnShowToc) {
    btnShowToc.onclick = () => {
      if (!currentPdfDoc) {
        alert("먼저 PDF 문서를 열어주세요.");
        return;
      }
      openTocView(true);
    };
  }

  // 5. Fullscreen Toggle
  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.onclick = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
        else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    };

    const updateFullscreenIcon = () => {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const icon = btnFullscreen.querySelector('i');
      if (icon) {
        icon.className = isFull ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
      }
      btnFullscreen.title = isFull ? '전체화면 종료' : '전체화면 모드 (주소창 숨기기)';
    };

    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
  }

  // 6. File Selection Inputs
  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        processPdfFile(e.target.files[0]);
      }
      fileInput.value = '';
    });
  }

  const btnSelectFile = document.getElementById('btn-select-file');
  if (btnSelectFile && fileInput) {
    btnSelectFile.onclick = () => fileInput.click();
  }

  const btnSelectDrop = document.getElementById('btn-select-drop');
  if (btnSelectDrop && fileInput) {
    btnSelectDrop.onclick = (e) => {
      e.stopPropagation();
      fileInput.click();
    };
  }

  // Drop Zone Listeners
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dropZone.classList.add('dragover');
    }, false);

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    }, false);

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetDragVisuals();
      handleDroppedFiles(e.dataTransfer);
    }, false);

    dropZone.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });
  }

  // Upload Overlay Listeners
  const uploadOverlay = document.getElementById('upload-overlay');
  if (uploadOverlay) {
    uploadOverlay.addEventListener('dragenter', (e) => {
      e.preventDefault();
      uploadOverlay.classList.add('dragover');
    }, false);

    uploadOverlay.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      uploadOverlay.classList.add('dragover');
    }, false);

    uploadOverlay.addEventListener('dragleave', () => {
      uploadOverlay.classList.remove('dragover');
    }, false);

    uploadOverlay.addEventListener('drop', (e) => {
      e.preventDefault();
      resetDragVisuals();
      handleDroppedFiles(e.dataTransfer);
    }, false);
  }

  // 7. Window Resize Auto Fit
  let windowResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(windowResizeTimer);
    windowResizeTimer = setTimeout(() => {
      if (currentViewMode === 'toc') {
        openTocView(true);
      } else {
        renderCurrentView(true);
      }
    }, 120);
  });

  // 8. Initial State: Do NOT auto-load! Keep upload overlay active.
  renderQuestionList();
  console.log("대시보드가 초기화 상태로 준비되었습니다. PDF 파일을 선택하거나 드롭해주세요.");
});
