// 도서관 정보나루(data4library.kr) Open API 클라이언트. 서버에서만 실행돼요.
//  - 키(LIBRARY_API_KEY)는 서버 환경변수에서만 읽고, 로그·응답·오류 메시지에 절대 넣지 않아요.
//  - 정보나루는 오류도 HTTP 200으로 주고 본문에 errCode 를 담아서, 반드시 errCode 를 확인해요.
//  - 일일 호출 한도가 작을 수 있어서 결과를 캐시하고(cache.js), 호출 횟수를 줄이는 방향으로 써요.
//  - bookImageURL(표지)은 이용 조건(비영리 화면 표시 한정) 때문에 아예 가져오지 않아요.

const { getEnv } = require("./auth");
const cache = require("./cache");
const { LIMITS } = require("./recommend-config");

const BASE = "https://data4library.kr/api/";

class LibraryError extends Error {
  constructor(code) {
    super("library:" + code);
    this.code = code; // "config" | "network" | "http" | "parse" | "limit" | "auth" | "libCode" | "api"
  }
}

// 시험에서 가짜로 바꿀 수 있게 따로 둬요
const deps = { fetch: (...a) => fetch(...a), calls: 0 };

async function request(endpoint, params, timeoutMs = 28000) {
  const key = getEnv("LIBRARY_API_KEY");
  if (!key) throw new LibraryError("config");
  const qs = new URLSearchParams({ authKey: key, format: "json", ...params });
  let res;
  try {
    res = await deps.fetch(BASE + endpoint + "?" + qs.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new LibraryError("network");
  }
  deps.calls++;
  console.log("정보나루 호출", endpoint, "#" + deps.calls); // 파라미터(키 포함)는 출력하지 않아요
  if (!res.ok) throw new LibraryError("http");
  let json;
  try { json = await res.json(); } catch (e) { throw new LibraryError("parse"); }
  const r = json && json.response;
  if (!r || typeof r !== "object") throw new LibraryError("parse");
  if (r.errCode) {
    const code = String(r.errCode);
    console.error("정보나루 오류코드", code);
    if (/auth/i.test(code)) throw new LibraryError("auth");
    if (/libcode/i.test(code)) throw new LibraryError("libCode");
    if (/limit|traffic|over|quota|exceed/i.test(code) || /호출|한도|초과/.test(String(r.error || ""))) throw new LibraryError("limit");
    throw new LibraryError("api");
  }
  return r;
}

const arr = (v) => (Array.isArray(v) ? v : []);
// docs[].doc / docs[].book 껍데기를 벗겨요
const docsOf = (r) => arr(r.docs).map((d) => (d && (d.doc || d.book)) || d).filter((d) => d && typeof d === "object");

// 저자 칸 정리: "나관중 지음 ;황석영 옮김" → "나관중", "원작: 대니얼 디포 ;번역: 양수현" → "대니얼 디포"
function cleanAuthor(a) {
  let s = String(a || "").split(/[;；]/)[0];
  s = s.replace(/^\s*(지은이|원작|저자|글·그림|글|그림|엮은이|편저)\s*[:：]\s*/, "");
  s = s.replace(/\s*(지음|지은이|원작|엮음|씀|저|글)\s*$/, "");
  return s.trim();
}

// 응답 한 권을 필요한 칸만 남겨요 (표지 URL은 일부러 버려요)
function slim(d) {
  return {
    isbn13: String(d.isbn13 || "").trim(),
    title: String(d.bookname || "").trim(),
    author: cleanAuthor(d.authors),
    classNo: String(d.class_no || "").trim(),
    addCode: String(d.addition_symbol || "").trim(),
    year: String(d.publication_year || "").trim(),
    regDate: String(d.reg_date || "").trim(),
    rank: Number(d.ranking) || 0,
    loanCount: Number(d.loan_count) || 0,
  };
}

const ISBN13 = /^\d{13}$/;
const day = (d) => d.toISOString().slice(0, 10);
function loanPeriod() {
  const end = new Date(Date.now() - 24 * 3600 * 1000); // 정보나루: 조회일 전날까지
  const start = new Date(end);
  start.setMonth(start.getMonth() - LIMITS.loanMonths);
  return { startDt: day(start), endDt: day(end) };
}

// ── 개별 조회 ─────────────────────────────────────────────────

// ISBN → 공식 서지정보 (제목·저자는 사용자 입력이 아니라 이 결과를 프롬프트에 써요)
async function getBook(isbn13) {
  if (!ISBN13.test(isbn13)) return null;
  return cache.cached(`book:${isbn13}`, 30 * 86400, async () => {
    const r = await request("srchBooks", { isbn13, pageSize: "1" });
    const d = docsOf(r)[0];
    return d ? slim(d) : { isbn13, title: "", author: "", classNo: "", addCode: "", year: "", regDate: "", rank: 0, loanCount: 0, missing: true };
  }).then((b) => (b && !b.missing ? b : null));
}

// 제목 검색(좋아한 책 고르기용): 같은 작품의 여러 판본은 하나로 합쳐 상위 몇 권만
async function searchByTitle(q) {
  const norm = String(q).trim().toLowerCase().replace(/\s+/g, " ");
  return cache.cached(`search:${norm}`, 86400, async () => {
    const r = await request("srchBooks", { title: String(q).trim(), pageSize: "30" });
    const seen = new Set();
    const out = [];
    for (const d of docsOf(r).map(slim)) {
      if (!ISBN13.test(d.isbn13) || !d.title) continue;
      const k = workKey(d);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ isbn13: d.isbn13, title: d.title, author: d.author });
      if (out.length >= 6) break;
    }
    return out;
  });
}

// 마니아 추천(함께 많이 읽힌 책) — 취향 단서로만 써요 (소장 여부는 보장되지 않아요)
async function maniaRecs(isbns) {
  const list = [...new Set(isbns.filter((i) => ISBN13.test(i)))].sort().slice(0, 5);
  if (!list.length) return [];
  return cache.cached(`mania:${list.join(",")}`, 7 * 86400, async () => {
    const r = await request("recommandList", { isbn13: list.join(";"), type: "mania" });
    return docsOf(r).map(slim).filter((b) => b.title).slice(0, 20);
  });
}

// 이 도서관의 인기대출도서(성별·연령·분류 조건) — 그 도서관에서 빌려 간 책이라 소장이 확실해요
async function popular({ libCode, gender, age, kdc, addCodes }) {
  const { startDt, endDt } = loanPeriod();
  const params = { libCode, kdc, addCode: addCodes, startDt, endDt, pageSize: String(LIMITS.poolPerBucket) };
  if (gender) params.gender = gender;
  if (age) params.age = age;
  const key = ["pop", libCode, gender || "-", age || "-", kdc, addCodes, startDt.slice(0, 7)].join(":");
  return cache.cached(key, 86400, async () => {
    const r = await request("loanItemSrchByLib", params);
    return docsOf(r).map(slim).filter((b) => ISBN13.test(b.isbn13) && b.title);
  });
}

// 이 도서관의 최근 입수 도서(분류 조건) — 신간 보강용
async function recent({ libCode, kdc }) {
  const key = `recent:${libCode}:${kdc}:${new Date().toISOString().slice(0, 10)}`;
  return cache.cached(key, 86400, async () => {
    const r = await request("itemSrch", { libCode, type: "ALL", kdc, pageSize: String(LIMITS.recentPerBucket) });
    return docsOf(r).map(slim).filter((b) => ISBN13.test(b.isbn13) && b.title);
  });
}

// 소장·대출 가능 여부 (대출 가능은 전날 기준)
async function availability(libCode, isbn13) {
  const key = `avail:${libCode}:${isbn13}`;
  return cache.cached(key, 12 * 3600, async () => {
    const r = await request("bookExist", { libCode, isbn13 }, 15000);
    const res = r.result || {};
    return { has: res.hasBook === "Y", loan: res.loanAvailable === "Y" };
  });
}

// 같은 작품(판본 달라도)을 하나로 묶는 열쇠: 제목 앞부분 + 저자 첫 단어
function workKey(b) {
  const t = String(b.title || "").toLowerCase().replace(/[\s\-:·.,!?'"“”‘’()\[\]=/~_]+/g, "").replace(/\d+$/, "").slice(0, 24);
  const a = String(b.author || "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ")[0] || "";
  return t + "|" + a.toLowerCase();
}

module.exports = { LibraryError, deps, request, cleanAuthor, docsOf, slim, getBook, searchByTitle, maniaRecs, popular, recent, availability, workKey, loanPeriod };
