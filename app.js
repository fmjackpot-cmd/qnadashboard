// PDF.js Worker Configuration
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

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

  if (geminiApiKey) {
    updateKeyStatusUI(true, "기본 API 키 등록됨 (정상 작동)");
  } else {
    updateKeyStatusUI(false, "미설정 (자체 스마트 텍스트 분석기 사용)");
  }
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

// Global Page Mappings: PDF physical page vs Printed bottom page
let pdfToPrintedMap = {};
let printedToPdfMap = {};

// Fast extraction of all pages text and bottom printed page numbers from PDF
async function extractAllPagesText(pdfDoc) {
  const pages = [];
  const maxPages = pdfDoc.numPages;
  pdfToPrintedMap = {};
  printedToPdfMap = {};

  for (let p = 1; p <= maxPages; p++) {
    try {
      const page = await pdfDoc.getPage(p);
      const textContent = await page.getTextContent();
      const unscaled = page.getViewport({ scale: 1.0 });
      const pageHeight = unscaled.height;

      // Extract all text items
      const items = textContent.items || [];
      const str = items.map(it => it.str).join(' ');

      // Bottom footer items (y < 80px or bottom 10% of page)
      const footerItems = items.filter(it => {
        const yFromBottom = it.transform[5];
        return yFromBottom < 80 || (pageHeight > 0 && yFromBottom / pageHeight < 0.10);
      });
      const footerRaw = footerItems.map(it => it.str).join(' ').replace(/\u0000/g, '').trim();

      // Detect printed page number from footer
      // Patterns: "- 1 -", "- 65 -", "[ 1 ]", "1", "1 / 45"
      let detectedPrintedPage = null;
      const dashMatch = footerRaw.match(/[-—–]\s*(\d{1,4})\s*[-—–]/);
      if (dashMatch) {
        detectedPrintedPage = parseInt(dashMatch[1], 10);
      } else {
        const standaloneMatch = footerRaw.match(/(?:^|\s)(\d{1,4})(?:\s*$|\s*\/\s*\d+)/);
        if (standaloneMatch) {
          detectedPrintedPage = parseInt(standaloneMatch[1], 10);
        }
      }

      pages.push({
        pageNum: p,
        text: str,
        footerText: footerRaw,
        printedPage: detectedPrintedPage
      });

      if (detectedPrintedPage !== null && !isNaN(detectedPrintedPage) && detectedPrintedPage > 0) {
        pdfToPrintedMap[p] = detectedPrintedPage;
        // Keep the earliest physical page for duplicate printed page if any
        if (!printedToPdfMap[detectedPrintedPage]) {
          printedToPdfMap[detectedPrintedPage] = p;
        }
      }
    } catch (err) {
      pages.push({ pageNum: p, text: "", footerText: "", printedPage: null });
    }
  }

  // Smooth interpolation for missing printed pages between known printed pages
  for (let p = 2; p < maxPages; p++) {
    if (!pdfToPrintedMap[p] && pdfToPrintedMap[p - 1] && pdfToPrintedMap[p + 1]) {
      const prev = pdfToPrintedMap[p - 1];
      const next = pdfToPrintedMap[p + 1];
      if (next === prev + 2) {
        const interpolated = prev + 1;
        pdfToPrintedMap[p] = interpolated;
        if (!printedToPdfMap[interpolated]) {
          printedToPdfMap[interpolated] = p;
        }
        if (pages[p - 1]) pages[p - 1].printedPage = interpolated;
      }
    }
  }

  console.log(`Printed page mapping established: ${Object.keys(printedToPdfMap).length} mapped pages out of ${maxPages} PDF pages.`);
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

// Search actual body pages using question brackets 【1】, 【2】 and keywords
// High-Precision Title-to-Page Scoring Engine
// Matches question titles against actual PDF page body text using:
// 1. Clean No-Space Substring match (1000 pts)
// 2. Top-of-page header area weighting (+500 pts)
// 3. Significant phrase / token overlap ratio (+150~450 pts)
// 4. Bracketed question number pattern (+300 pts)
// 5. Sequential monotonicity constraint (page N >= page N-1)
function locateQuestionsByContent(items, pdfDoc, pageTexts, detectedTocPages) {
  if (!items || items.length === 0) return [];

  const lastToc = (detectedTocPages && detectedTocPages.length > 0) ? Math.max(...detectedTocPages) : 0;
  // Exclude TOC and cover pages from body search
  let searchStart = Math.max(1, lastToc + 1);

  // Skip any nearly blank transition pages
  while (searchStart <= pdfDoc.numPages && (pageTexts[searchStart - 1]?.text || "").replace(/[^가-힣a-zA-Z0-9]/g, '').length < 15) {
    searchStart++;
  }

  // 1. Pre-process and cache normalized text for all pages
  const pageCache = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const rawText = pageTexts[p - 1]?.text || "";
    // Clean string with all whitespace, brackets, punctuation removed
    const cleanNoSpace = rawText.replace(/[\s\(\)\[\]\.\,\?\!\-_·ㆍ•「」『』<>\/\\~○●■▶◆\:\;]/g, '');
    // Header snippet (first 600 characters) where question title boxes reside
    const headerRaw = rawText.substring(0, 600);
    const headerCleanNoSpace = headerRaw.replace(/[\s\(\)\[\]\.\,\?\!\-_·ㆍ•「」『』<>\/\\~○●■▶◆\:\;]/g, '');

    // Detect if this page is a data/table heavy appendix page (e.g. 위원회 현황, 예산 집행 표)
    const isTableHeavy = /(?:위원회명|집행률|예산액|집행액|불용액|천원|\b\d{1,3},\d{3}\b)/.test(rawText) &&
      (rawText.match(/\b\d{1,3},\d{3}\b/g) || []).length >= 5;

    pageCache.push({
      pageNum: p,
      rawText: rawText,
      cleanNoSpace: cleanNoSpace,
      headerCleanNoSpace: headerCleanNoSpace,
      isTableHeavy: isTableHeavy
    });
  }

  // Common stopwords to exclude from token overlap
  const stopWords = new Set([
    "현황은", "사유는", "대책은", "계획은", "의견은", "방안은", 
    "최근", "대한", "관련", "따른", "기준", "운영", "지원", 
    "내역은", "이유는", "결과는", "사업", "추진", "어떠한가", "무엇인가"
  ]);

  const locatedItems = [];
  let prevFoundPage = searchStart;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const qId = Number(item.id) || (i + 1);
    const originalTitle = (item.title || "").trim();

    // Strip any residual leading question numbers, bullets, noise from title
    let pureTitle = originalTitle;
    while (/^[\s\d\.\-\)\/【】\[\]○●■▶문항]+/.test(pureTitle)) {
      pureTitle = pureTitle.replace(/^[\s\d\.\-\)\/【】\[\]○●■▶문항]+/, '').trim();
    }
    if (!pureTitle) pureTitle = originalTitle;
    item.title = pureTitle; // Update item title to purified title

    // Clean title with no whitespace and no punctuation
    const titleNoSpace = pureTitle.replace(/[\s\(\)\[\]\.\,\?\!\-_·ㆍ•「」『』<>\/\\~○●■▶◆\:\;]/g, '');

    // Title token words (length >= 2, non-stopwords)
    const titleTokens = pureTitle
      .replace(/[\s\(\)\[\]\.\,\?\!\-_·ㆍ•「」『』<>\/\\~○●■▶◆\:\;]/g, ' ')
      .split(' ')
      .filter(w => w.length >= 2 && !stopWords.has(w));

    // Salient prefix phrase (first 8~12 chars)
    const prefixSnippet = titleNoSpace.length >= 8 
      ? titleNoSpace.substring(0, Math.min(12, titleNoSpace.length)) 
      : titleNoSpace;
    const midSnippet = titleNoSpace.length >= 16 
      ? titleNoSpace.substring(4, 14) 
      : "";

    // Bracket patterns for question number
    const bracketRegex = new RegExp(`【\\s*${qId}\\s*】|\\[\\s*문항\\s*${qId}\\s*\\]|【\\s*문항\\s*${qId}\\s*】|\\b문항\\s*${qId}\\b`, 'i');
    // If item was already directly mapped via printedToPdfMap from TOC, honor it directly!
    let foundPage = null;
    let bestPage = null;
    let highestScore = 0;
    const pageSearchStart = Math.max(searchStart, prevFoundPage);

    if (item.startPdfPage && item.startPdfPage >= searchStart && item.startPdfPage <= pdfDoc.numPages) {
      foundPage = item.startPdfPage;
      console.log(`Question ${qId} ("${originalTitle.substring(0, 15)}...") directly mapped to PDF page ${foundPage} via printed page ${item.docPage}`);
    } else if (item.docPage && !isNaN(parseInt(item.docPage, 10)) && printedToPdfMap[parseInt(item.docPage, 10)]) {
      foundPage = printedToPdfMap[parseInt(item.docPage, 10)];
      console.log(`Question ${qId} ("${originalTitle.substring(0, 15)}...") mapped to PDF page ${foundPage} via docPage ${item.docPage}`);
    } else {
      for (let p = pageSearchStart; p <= pdfDoc.numPages; p++) {
        const pageInfo = pageCache[p - 1];
        if (!pageInfo || pageInfo.cleanNoSpace.length < 20) continue;

        let score = 0;

        // Tier 1: Complete title match (ignoring whitespace and punctuation)
        if (titleNoSpace.length >= 5 && pageInfo.cleanNoSpace.includes(titleNoSpace)) {
          score += 1000;
          if (pageInfo.headerCleanNoSpace.includes(titleNoSpace)) {
            score += 500;
          }
        }

        // Tier 2: Salient prefix phrase match (first 8~12 characters)
        if (prefixSnippet.length >= 6 && pageInfo.cleanNoSpace.includes(prefixSnippet)) {
          score += 400;
          if (pageInfo.headerCleanNoSpace.includes(prefixSnippet)) {
            score += 300;
          }
        }

        // Tier 3: Middle salient phrase match
        if (midSnippet.length >= 6 && pageInfo.cleanNoSpace.includes(midSnippet)) {
          score += 250;
        }

        // Tier 4: Significant token overlap
        if (titleTokens.length > 0) {
          let matchCount = 0;
          let headerMatchCount = 0;
          for (const token of titleTokens) {
            if (pageInfo.cleanNoSpace.includes(token)) {
              matchCount++;
              if (pageInfo.headerCleanNoSpace.includes(token)) {
                headerMatchCount++;
              }
            }
          }

          const matchRatio = matchCount / titleTokens.length;
          if (matchRatio >= 0.8) score += 400;
          else if (matchRatio >= 0.5) score += 250;
          else if (matchRatio >= 0.3 && matchCount >= 2) score += 120;

          score += headerMatchCount * 100;
        }

        // Tier 5: Bracketed question number match
        if (bracketRegex.test(pageInfo.rawText)) {
          score += 400;
        }

        // Anti-false-positive: Penalize pages that are data-heavy tables if title is not in the header
        if (pageInfo.isTableHeavy && !pageInfo.headerCleanNoSpace.includes(prefixSnippet)) {
          score -= 500;
        }

        // Track highest scoring page
        if (score > highestScore) {
          highestScore = score;
          bestPage = p;
        }

        if (score >= 1200) {
          break;
        }
      }

      // Minimum confidence threshold: 220 points
      if (highestScore >= 220 && bestPage !== null) {
        foundPage = bestPage;
        console.log(`Question ${qId} ("${originalTitle.substring(0, 15)}...") matched to PDF page ${foundPage} (score: ${highestScore})`);
      } else {
        foundPage = Math.min(pdfDoc.numPages, prevFoundPage);
        console.warn(`Question ${qId} ("${originalTitle.substring(0, 15)}...") low match score (${highestScore}), placed at PDF page ${foundPage}`);
      }
    }

    prevFoundPage = foundPage;

    locatedItems.push({
      ...item,
      id: qId,
      startPdfPage: foundPage
    });
  }

  // 3. Compute accurate endPdfPage and pageCount
  for (let i = 0; i < locatedItems.length; i++) {
    const curr = locatedItems[i];
    const next = locatedItems[i + 1];

    if (next && next.startPdfPage > curr.startPdfPage) {
      curr.endPdfPage = next.startPdfPage - 1;
    } else if (next && next.startPdfPage === curr.startPdfPage) {
      curr.endPdfPage = curr.startPdfPage;
    } else {
      curr.endPdfPage = pdfDoc.numPages;
    }

    curr.pageCount = Math.max(1, curr.endPdfPage - curr.startPdfPage + 1);

    // Format docPage based on BOTTOM PRINTED PAGE NUMBER as required
    let startPrinted = pdfToPrintedMap[curr.startPdfPage];
    if (!startPrinted) {
      for (let sp = curr.startPdfPage; sp <= curr.endPdfPage; sp++) {
        if (pdfToPrintedMap[sp]) {
          startPrinted = pdfToPrintedMap[sp];
          break;
        }
      }
    }
    if (!startPrinted) startPrinted = curr.docPage || curr.startPdfPage;

    let endPrinted = pdfToPrintedMap[curr.endPdfPage];
    if (!endPrinted) {
      for (let ep = curr.endPdfPage; ep >= curr.startPdfPage; ep--) {
        if (pdfToPrintedMap[ep]) {
          endPrinted = pdfToPrintedMap[ep];
          break;
        }
      }
    }
    if (!endPrinted) endPrinted = startPrinted;

    if (startPrinted !== endPrinted) {
      curr.docPage = `${startPrinted}~${endPrinted}`;
    } else {
      curr.docPage = `${startPrinted}`;
    }

    curr.physicalPageLabel = (curr.startPdfPage === curr.endPdfPage)
      ? `PDF ${curr.startPdfPage}p`
      : `PDF ${curr.startPdfPage}~${curr.endPdfPage}p`;
  }

  return locatedItems;
}

// High-Precision Table-format TOC Parser (e.g. Financial Statements, 4-column tables: [순번 | 질의 목록 | 페이지 | 비고])
function parseTableToc(pageTexts, structure) {
  const targetPages = (structure.tocPages && structure.tocPages.length > 0)
    ? structure.tocPages
    : [1, 2, 3, 4].filter(p => p <= pageTexts.length);

  // Combine TOC pages text
  let combined = "";
  for (const p of targetPages) {
    const text = pageTexts[p - 1]?.text || "";
    combined += `\n${text}\n`;
  }

  // Pre-clean TOC text: strip null characters, page numbers like "- 2 -", and header notes
  combined = combined
    .replace(/\u0000/g, '')
    .replace(/[-—–]\s*\d+\s*[-—–]/g, ' ')
    .replace(/※\s*\*.*?(?=(?:\b\d{1,3}\s+[*]?\s*[\uAC00-\uD7AF]))/gs, ' ')
    .replace(/순\s*질의\s*목록\s*페이지\s*비고/g, ' ');

  const items = [];

  // Table row regex:
  // [ID] [Title up to ? or ？] [Page number] [Optional category/remarks]
  const rowPattern = /(?:^|\s)(\d{1,3})\s+([^?？\n\r]{3,250}[?？])\s+(\d{1,3})(?:\s+([\uAC00-\uD7AF\s\<\>]+?))?(?=\s+\d{1,3}\s+[^?？\n\r]{3,250}[?？]|\s+(?:자산|부채|수익|비용|법령|용어)\s+|\s*-\s*\d+\s*-|$)/g;

  let m;
  let lastCategory = "재무결산 질의";
  let lastRowEndIndex = 0;

  while ((m = rowPattern.exec(combined)) !== null) {
    lastRowEndIndex = rowPattern.lastIndex;
    const qId = parseInt(m[1], 10);
    const rawTitle = m[2];
    const docPageStr = m[3].trim();
    const docPageNum = parseInt(docPageStr, 10);
    const remarks = (m[4] || '').trim().replace(/\s+/g, ' ');

    if (remarks && remarks.length >= 2 && !/^\d+$/.test(remarks)) {
      lastCategory = remarks;
    }

    // Clean title: remove leading '*', '○', '-', and normalize whitespaces
    let cleanTitle = rawTitle.trim()
      .replace(/^[*○●■▶\-·\d\.\s]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Directly map docPage (printed page) to physical PDF page via printedToPdfMap
    let startPdfPage = null;
    if (!isNaN(docPageNum) && printedToPdfMap[docPageNum]) {
      startPdfPage = printedToPdfMap[docPageNum];
    }

    items.push({
      id: qId,
      team: "재정복지과",
      category: lastCategory || "재무결산 질의",
      officer: "",
      title: cleanTitle,
      docPage: docPageStr,
      startPdfPage: startPdfPage,
      tocPage: targetPages[0] || 1,
      settle: "",
      explain: "",
      attach: "",
      opinion: ""
    });
  }

  // Also capture annex/appendix sections (자산, 부채, 수익, 비용, 법령, 용어 등) strictly after questions
  if (items.length >= 10) {
    const appendixText = combined.substring(lastRowEndIndex);
    const sectionRegex = /(자산|부채|수익|비용|법령|용어)\s+([^?？\d\r\n]+?)\s+(\d{1,3})(?=\s+(?:자산|부채|수익|비용|법령|용어)\s+|\s*$)/g;
    let secId = items.length + 1;
    while ((m = sectionRegex.exec(appendixText)) !== null) {
      const secType = m[1];
      const secName = (m[1] + ' ' + m[2]).trim().replace(/\s+/g, ' ');
      const secDocPageStr = m[3].trim();
      const secDocPageNum = parseInt(secDocPageStr, 10);

      let startPdfPage = null;
      if (!isNaN(secDocPageNum) && printedToPdfMap[secDocPageNum]) {
        startPdfPage = printedToPdfMap[secDocPageNum];

        // Check if there is a divider/cover page (간지) immediately preceding this section
        // e.g. "관 련 법 규" (PDF 119) before printed 111 (PDF 121)
        // e.g. "재무결산 용어설명" (PDF 147) before printed 139 (PDF 149)
        if (startPdfPage > 2) {
          const secKeywords = [secType, ...secName.split(/\s+/)].filter(k => k.length >= 2);
          let candidateStart = startPdfPage;
          for (let checkP = startPdfPage - 1; checkP >= Math.max(1, startPdfPage - 4); checkP--) {
            // Stop if preceding page has a printed footer (it belongs to previous section)
            if (pdfToPrintedMap[checkP]) break;
            const pText = (pageTexts[checkP - 1]?.text || '').replace(/\s+/g, '');
            const matchesKeyword = secKeywords.some(kw => pText.includes(kw) || kw.includes(pText));
            if (matchesKeyword || pText.length === 0) {
              candidateStart = checkP;
            } else {
              break;
            }
          }
          startPdfPage = candidateStart;
        }
      }

      items.push({
        id: secId++,
        team: "재정복지과",
        category: `참고자료 (${secType})`,
        officer: "",
        title: secName,
        docPage: secDocPageStr,
        startPdfPage: startPdfPage,
        tocPage: targetPages[targetPages.length - 1] || 1,
        settle: "",
        explain: "",
        attach: "",
        opinion: ""
      });
    }
  }

  return items;
}

// Built-in intelligent client-side text parser (when AI key is not set or failed)
function parseQuestionsHeuristic(pageTexts, structure) {
  // 1. Check if TOC matches standard 4-column Table format (e.g. 재무결산 질의서)
  const targetPages = (structure.tocPages && structure.tocPages.length > 0)
    ? pageTexts.filter(p => structure.tocPages.includes(p.pageNum))
    : pageTexts;

  const combinedTocText = targetPages.map(p => p.text || '').join(' ');
  const isTableToc = /순\s*질의\s*목록|질의\s*목록\s*페이지/i.test(combinedTocText) ||
    (/\b\d{1,2}\s+[^?？]{3,}[\?？]\s+\d{1,3}/.test(combinedTocText) && (combinedTocText.match(/[\?？]/g) || []).length >= 5);

  if (isTableToc) {
    const tableItems = parseTableToc(pageTexts, structure);
    if (tableItems.length >= 5) {
      console.log(`Table TOC parser successfully extracted ${tableItems.length} questions.`);
      return tableItems;
    }
  }

  // 2. Fallback to General Format Parser (Line & Question Token based)
  const items = [];
  let currentCategory = "일반";
  let currentTeam = "";
  let questionCounter = 1;

  for (const pageObj of targetPages) {
    const text = pageObj.text || "";
    // Split into chunks by question marks, bracketed items, or linebreaks
    const chunks = text.split(/(?<=[?？])|(?=\[문항\s*\d+\])|\r?\n/);

    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      const line = chunk.trim();
      if (!line || line.length < 5) continue;

      // Detect team keywords (학생배치팀, 조직관리팀, 법무팀 등)
      const teamMatch = line.match(/([가-힣]{2,6}(?:팀|과|담당))/);
      if (teamMatch) {
        currentTeam = teamMatch[1];
        currentCategory = teamMatch[1];
      }

      // Check if chunk is a question (ends with ? or contains 【X】 or [문항 X])
      const isQuestion = /[?？]$/.test(line) || /【\s*\d+\s*】/.test(line) || /\[문항\s*\d+\]/i.test(line);
      
      if (isQuestion && line.length >= 6) {
        // Strip table noise, author names, team names, bullet symbols before question title
        let cleanTitle = line;
        
        // If line has '○', the question starts right after '○'
        if (cleanTitle.includes('○')) {
          cleanTitle = cleanTitle.substring(cleanTitle.indexOf('○') + 1);
        } else if (cleanTitle.includes('【')) {
          cleanTitle = cleanTitle.substring(cleanTitle.indexOf('】') + 1);
        }

        // Cut trailing officer/team noise after question mark if any
        if (cleanTitle.includes('?')) {
          cleanTitle = cleanTitle.substring(0, cleanTitle.lastIndexOf('?') + 1);
        } else if (cleanTitle.includes('？')) {
          cleanTitle = cleanTitle.substring(0, cleanTitle.lastIndexOf('？') + 1);
        }

        // Thoroughly strip ALL leading residual numbers, dots, dashes, brackets, and prefixes (e.g. "4 27. " -> "")
        while (/^[\s\d\.\-\)\/【】\[\]○●■▶문항]+/.test(cleanTitle)) {
          cleanTitle = cleanTitle.replace(/^[\s\d\.\-\)\/【】\[\]○●■▶문항]+/, '').trim();
        }

        cleanTitle = cleanTitle
          .replace(/^[가-힣\s]{2,5}(?:의원|위원|팀장)\s*/, '')
          .replace(/^[가-힣\s]{2,6}(?:팀|과|담당)\s*/, '')
          .trim();

        // Avoid duplicates
        if (cleanTitle.length >= 5 && !items.some(it => it.title === cleanTitle)) {
          // Detect officer/author from original chunk
          let officer = "";
          const officerMatch = line.match(/([가-힣]{2,4}\s*의원|언론|현안)/);
          if (officerMatch) officer = officerMatch[1];

          // Detect docPage number:
          // 1) First check inside the line itself (if not strictly cut at ?)
          let docPage = "";
          const inlineMatch = line.match(/[?？]\s*(?:쪽수|쪽|p|page)?\s*(\d{1,3})(?:\s*[-~]\s*(\d{1,3}))?/i);
          if (inlineMatch) {
            docPage = inlineMatch[2] ? `${inlineMatch[1]}~${inlineMatch[2]}` : inlineMatch[1];
          }

          // 2) If not found, look at the very beginning of the subsequent chunk(s) (table column for docPage)
          if (!docPage && c + 1 < chunks.length) {
            const nextChunk = (chunks[c + 1] || "").trim();
            const nextMatch = nextChunk.match(/^(?:문서|쪽수|쪽|p|page)?\s*(\d{1,3})(?:\s*[-~]\s*(\d{1,3}))?/i);
            if (nextMatch) {
              docPage = nextMatch[2] ? `${nextMatch[1]}~${nextMatch[2]}` : nextMatch[1];
            }
          }

          // 3) Direct physical PDF page lookup via printedToPdfMap
          let startPdfPage = null;
          if (docPage) {
            const startNum = parseInt(docPage.split(/[-~]/)[0], 10);
            if (!isNaN(startNum) && printedToPdfMap[startNum]) {
              startPdfPage = printedToPdfMap[startNum];
            }
          }

          items.push({
            id: questionCounter++,
            team: currentTeam || "행정과",
            category: currentCategory || "질의 문항",
            officer: officer,
            title: cleanTitle,
            docPage: docPage,
            startPdfPage: startPdfPage,
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
// 3. AI-BASED PARSER (Multi-Model Resilient Fallback)
// ==========================================================================

async function parseUploadedPdf(pdfDoc, fileName) {
  const loadingOverlay = document.getElementById('ai-loading-overlay');
  const loadingTitle = document.getElementById('ai-loading-title');
  const loadingDesc = document.getElementById('ai-loading-desc');

  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  if (loadingTitle) loadingTitle.innerText = "PDF 전체 텍스트 및 구조 분석 중...";
  if (loadingDesc) loadingDesc.innerText = "문서의 표지, 목차, 질문 목록 및 본문 쪽수를 정밀 스캔하고 있습니다.";

  // 1. Fast Full Text Extraction
  const pageTexts = await extractAllPagesText(pdfDoc);
  
  // 2. Analyze Document Structure (Cover & TOC detection)
  const structure = analyzeDocumentStructure(pageTexts);
  tocPages = structure.tocPages;

  let rawParsedItems = [];

  // 3. AI Parsing with Multi-Model Fallback (3.5-flash-lite -> 3.5-flash -> flash-latest)
  if (geminiApiKey) {
    const candidateModels = [
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-flash-latest"
    ];

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

[중요 파싱 규칙]:
1. id 필드: 문항 순번 (1부터 시작하는 정수 1, 2, 3...)을 반드시 부여하세요.
2. title 필드: 앞에 붙은 순번(1, 2...), 기호(○, -, ■), 의원명(김남국 의원 등), 팀명 등을 모두 제외하고 오직 순수한 '질의 제목 전문'만 넣으세요.
   (예: "초·중·고등학교의 과밀학급 및 과대학교 현황과 대책은?")
3. category 필드: 팀명(예: "학생배치팀", "조직관리팀", "법무팀" 등)으로 그룹화하세요.
4. team 필드: 해당 팀명을 넣으세요.
5. officer 필드: 구분/의원명(예: "문정복 의원", "김남국 의원", "언론", "현안" 등)이 있으면 넣고 없으면 빈 문자열 ""로 두세요.
6. docPage 필드: 목차 표의 '쪽수' 컬럼에 명시된 시작 쪽수(예: "1", "6", "8", "9", "11" 등 숫자 문자열)를 추출하세요. 쪽수가 없으면 빈 문자열 ""로 두세요.
7. [매우 중요 - 불필요한 태그 추출 금지]:
   문서 목차에 '결산서 쪽수', '설명자료 쪽수' 등의 명시적인 연관 쪽수 헤더/컬럼이 없는 일반 감사 질의서(국정감사 등)의 경우, 없는 참조 쪽수를 억지로 유추하거나 생성하지 마세요.
   settle, explain, attach, opinion 필드는 목차에 해당 컬럼이 명시되어 있을 때만 추출하고, 없으면 반드시 빈 문자열 ""로 설정하세요.
8. 오직 파싱 가능한 순수 JSON 배열만 반환하세요. 마크다운 코드블록은 제외하세요.

[반환 JSON 스키마 예시]:
[
  {
    "id": 1,
    "title": "초·중·고등학교의 과밀학급 및 과대학교 현황과 대책은?",
    "category": "학생배치팀",
    "team": "학생배치팀",
    "officer": "문정복 의원",
    "docPage": "1",
    "settle": "",
    "explain": "",
    "attach": "",
    "opinion": ""
  }
]

[문서 텍스트]:
${contextText}
`;

    for (const modelName of candidateModels) {
      try {
        if (loadingTitle) loadingTitle.innerText = `Gemini AI(${modelName})가 목차 분석 중...`;
        if (loadingDesc) loadingDesc.innerText = "질의 문항, 팀별 카테고리, 담당 의원을 정밀 구조화하고 있습니다.";

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
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
            console.log(`Gemini AI (${modelName}) successfully parsed ${parsed.length} questions.`);
            break; // Success! Exit model loop
          }
        } else {
          console.warn(`Model ${modelName} returned status ${response.status}, trying next model...`);
        }
      } catch (err) {
        console.warn(`Model ${modelName} failed:`, err);
      }
    }
  }

  // 4. Fallback to Heuristic Client-Side Parser if AI was not used or failed
  if (!rawParsedItems || rawParsedItems.length === 0) {
    if (loadingTitle) loadingTitle.innerText = "자체 스마트 파서로 문항 추출 중...";
    rawParsedItems = parseQuestionsHeuristic(pageTexts, structure);
    console.log(`Heuristic parser found ${rawParsedItems.length} questions.`);
  }

  // 5. Ultimate Fallback (If no questions could be parsed from TOC or body)
  if (!rawParsedItems || rawParsedItems.length === 0) {
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
        pageCount: 1,
        settle: "",
        explain: "",
        attach: "",
        opinion: ""
      });
    }
  }

  // 5-1. Normalize and guarantee item.id as valid integers and clean fields
  if (Array.isArray(rawParsedItems)) {
    rawParsedItems = rawParsedItems.map((item, idx) => {
      const rawId = item.id !== undefined ? item.id : (item.no || item.num || item.order);
      const parsedId = parseInt(rawId, 10);
      const validId = (!isNaN(parsedId) && parsedId > 0) ? parsedId : (idx + 1);

      return {
        id: validId,
        team: (item.team || item.department || "").trim(),
        category: (item.category || item.team || "일반").trim(),
        officer: (item.officer || item.author || "").trim(),
        title: (item.title || "").trim(),
        docPage: (item.docPage ? String(item.docPage).trim() : ""),
        startPdfPage: item.startPdfPage || null,
        settle: (item.settle ? String(item.settle).trim() : ""),
        explain: (item.explain ? String(item.explain).trim() : ""),
        attach: (item.attach ? String(item.attach).trim() : ""),
        opinion: (item.opinion ? String(item.opinion).trim() : "")
      };
    });
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

    // Category Header Bar (Hide duplicate team badge if catName equals teamName)
    const headerEl = document.createElement('div');
    headerEl.className = 'cat-header';
    const teamName = (items[0].team || '').trim();
    const hasSeparateTeam = teamName && teamName !== catName.trim();
    headerEl.innerHTML = `
      <span class="cat-title">${catName}</span>
      ${hasSeparateTeam ? `<span class="cat-team-badge">${teamName}</span>` : ''}
    `;
    groupEl.appendChild(headerEl);

    if (currentListViewMode === 'grid') {
      // 1) GRID MODE: 3-column Number Buttons
      const gridEl = document.createElement('div');
      gridEl.className = 'cat-btn-grid';

      items.forEach((item, idx) => {
        const id = Number(item.id) || (idx + 1);
        const btn = document.createElement('button');
        const isActive = (currentViewMode === 'question' && selectedQuestionId === id);
        btn.className = `btn-q-num ${isActive ? 'active' : ''}`;
        btn.innerText = id;
        const officerStr = item.officer ? `\n담당: ${item.officer}` : '';
        const pageStr = item.docPage ? `문서 ${item.docPage}쪽` : `PDF ${item.startPdfPage}p`;
        const tooltipStr = `[문항 ${id}] ${pageStr} (PDF ${item.startPdfPage}p) ${item.title}${officerStr}`;
        btn.title = tooltipStr;

        btn.addEventListener('click', () => {
          openQuestion(id);
          closeMobileSidebar();
        });

        gridEl.appendChild(btn);
      });

      groupEl.appendChild(gridEl);
    } else {
      // 2) TITLE LIST MODE: Vertical Detailed Title Cards
      items.forEach((item, idx) => {
        const id = Number(item.id) || (idx + 1);
        const itemEl = document.createElement('div');
        const isActive = (currentViewMode === 'question' && selectedQuestionId === id);
        itemEl.className = `q-title-item ${isActive ? 'active' : ''}`;
        itemEl.id = `sidebar-item-${id}`;

        // Only include reference tags if actual page numbers exist
        const refParts = [];
        if (item.settle && item.settle.trim() && /\d/.test(item.settle)) refParts.push(`결산 ${item.settle.trim()}`);
        if (item.explain && item.explain.trim() && /\d/.test(item.explain)) refParts.push(`설명 ${item.explain.trim()}`);
        if (item.attach && item.attach.trim() && /\d/.test(item.attach)) refParts.push(`첨부 ${item.attach.trim()}`);
        if (item.opinion && item.opinion.trim() && /\d/.test(item.opinion)) refParts.push(`의견 ${item.opinion.trim()}`);

        const refsHtml = refParts.length > 0
          ? `<div class="q-title-refs">${refParts.map(r => `<span class="q-title-ref-tag">${r}</span>`).join('')}</div>`
          : '';

        const pageLabel = item.docPage ? `문서 ${item.docPage}쪽` : `PDF ${item.startPdfPage}p`;

        itemEl.innerHTML = `
          <div class="q-title-top-row">
            <span class="q-title-badge">${id}</span>
            <span class="q-title-page-hint">${pageLabel}</span>
          </div>
          <div class="q-title-text" title="${item.title}">${item.title}</div>
          ${refsHtml}
        `;

        itemEl.addEventListener('click', () => {
          openQuestion(id);
          closeMobileSidebar();
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
  const qId = Number(q.id) || 1;
  const relPage = (pageNum - q.startPdfPage) + 1;
  const pageCount = q.pageCount || 1;
  const printedPageNum = pdfToPrintedMap[pageNum] || pageNum;
  tag.innerText = `문항 ${qId} (${relPage}/${pageCount} 쪽) - 문서 ${printedPageNum}쪽 (PDF ${pageNum}p)`;
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
  const qId = Number(q.id) || 1;
  selectedQuestionId = qId;

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
    qNumPill.innerText = `${qId}`;
    qNumPill.classList.remove('badge-toc-mode');
  }

  const badgeTitle = document.getElementById('current-mode-title');
  const refParts = [];
  if (q.settle && q.settle.trim() && /\d/.test(q.settle)) refParts.push(`결산서 ${q.settle.trim()}`);
  if (q.explain && q.explain.trim() && /\d/.test(q.explain)) refParts.push(`설명자료 ${q.explain.trim()}`);
  if (q.attach && q.attach.trim() && /\d/.test(q.attach)) refParts.push(`첨부 ${q.attach.trim()}`);
  if (q.opinion && q.opinion.trim() && /\d/.test(q.opinion)) refParts.push(`의견서 ${q.opinion.trim()}`);

  // Only show badge-refs if there are actual valid reference pages!
  const refsHtml = refParts.length > 0 
    ? `<span class="badge-refs">${refParts.join(' · ')}</span>` 
    : '';

  if (badgeTitle) {
    const pageLabelStr = q.docPage ? `문서 ${q.docPage}쪽` : `PDF ${q.startPdfPage}p`;
    badgeTitle.innerHTML = `
      <span class="badge-q-title">${q.title}</span>
      <span class="badge-refs" style="background:#f0fdf4; color:#15803d; border-color:#bbf7d0;">${pageLabelStr}</span>
      ${refsHtml}
    `;
  }
  const modeBadge = document.getElementById('current-view-mode-badge');
  if (modeBadge) {
    const pageLabelStr = q.docPage ? `문서 ${q.docPage}쪽 (PDF ${q.startPdfPage}~${q.endPdfPage}p)` : `PDF ${q.startPdfPage}p`;
    const refText = refParts.length > 0 ? ` (${refParts.join(' · ')})` : '';
    modeBadge.title = `[문항 ${qId}] ${pageLabelStr} ${q.title}${refText}`;
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
  const targetId = Number(questionId);
  const q = currentItems.find(i => Number(i.id) === targetId);
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

  // 8. Mobile Sidebar & Quick Navigation Controls
  setupMobileNavigation();

  // 9. Initial State: Do NOT auto-load! Keep upload overlay active.
  renderQuestionList();
  console.log("대시보드가 초기화 상태로 준비되었습니다. PDF 파일을 선택하거나 드롭해주세요.");
});

// Mobile Sidebar Drawer Functions
function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('mobile-open');
  if (backdrop) backdrop.classList.add('active');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

// Previous / Next Question Navigation
function goToPrevQuestion() {
  if (!currentItems || currentItems.length === 0) return;
  if (!selectedQuestionId) {
    openQuestion(currentItems[0].id, true);
    return;
  }
  const currentIdx = currentItems.findIndex(item => Number(item.id) === Number(selectedQuestionId));
  if (currentIdx > 0) {
    openQuestion(currentItems[currentIdx - 1].id, true);
  }
}

function goToNextQuestion() {
  if (!currentItems || currentItems.length === 0) return;
  if (!selectedQuestionId) {
    openQuestion(currentItems[0].id, true);
    return;
  }
  const currentIdx = currentItems.findIndex(item => Number(item.id) === Number(selectedQuestionId));
  if (currentIdx >= 0 && currentIdx < currentItems.length - 1) {
    openQuestion(currentItems[currentIdx + 1].id, true);
  }
}

function setupMobileNavigation() {
  const btnToggle = document.getElementById('btn-toggle-sidebar');
  const btnClose = document.getElementById('btn-close-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btnPrev = document.getElementById('btn-prev-q');
  const btnNext = document.getElementById('btn-next-q');

  if (btnToggle) btnToggle.onclick = toggleMobileSidebar;
  if (btnClose) btnClose.onclick = closeMobileSidebar;
  if (backdrop) backdrop.onclick = closeMobileSidebar;

  if (btnPrev) btnPrev.onclick = goToPrevQuestion;
  if (btnNext) btnNext.onclick = goToNextQuestion;

  // Keyboard navigation (Left / Right arrow keys)
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowLeft') {
      goToPrevQuestion();
    } else if (e.key === 'ArrowRight') {
      goToNextQuestion();
    }
  });
}
