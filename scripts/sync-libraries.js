// 정보나루 '정보공개 도서관' 전체 목록을 data/libraries.json 으로 저장해요.
//  - 실행: node scripts/sync-libraries.js   (정보나루 호출 약 4회: 전국 1,600여 곳을 500개씩)
//  - 키는 LIBRARY_API_KEY 환경변수, 없으면 작업 폴더 맨 위 .env 에서 읽어요. 키 값은 출력하지 않아요.
//  - 분기에 한 번쯤 다시 실행하면 돼요. 만들어진 파일은 git에 올려서 배포에 포함해요.
//  - 화면의 "지역 → 도서관" 선택과 서버의 도서관 코드 허용 목록에 쓰여서, 추천 때는 이 목록을 위해 정보나루를 호출하지 않아요.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "libraries.json");
const MAX_CALLS = 6; // 안전장치: 호출 상한

function getEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = fs.readFileSync(path.join(ROOT, "..", "..", ".env"), "utf8");
    const line = file.split(/\r?\n/).find((l) => l.startsWith(name + "="));
    return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : "";
  } catch (e) {
    return "";
  }
}

// 시도 이름 표준화(주소 첫 단어) + 화면 정렬 순서
const SIDO_ORDER = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
function sidoKey(first) {
  const s = String(first || "");
  if (s.startsWith("서울")) return "서울";
  if (s.startsWith("부산")) return "부산";
  if (s.startsWith("대구")) return "대구";
  if (s.startsWith("인천")) return "인천";
  if (s.startsWith("광주")) return "광주";
  if (s.startsWith("대전")) return "대전";
  if (s.startsWith("울산")) return "울산";
  if (s.startsWith("세종")) return "세종";
  if (s.startsWith("경기")) return "경기";
  if (s.startsWith("강원")) return "강원";
  if (s.startsWith("충청북") || s === "충북") return "충북";
  if (s.startsWith("충청남") || s === "충남") return "충남";
  if (s.startsWith("전북") || s.startsWith("전라북")) return "전북";
  if (s.startsWith("전라남") || s === "전남") return "전남";
  if (s.startsWith("경상북") || s === "경북") return "경북";
  if (s.startsWith("경상남") || s === "경남") return "경남";
  if (s.startsWith("제주")) return "제주";
  return "";
}

// 주소 → 시도 / 시군구 (예: "경기도 성남시 수정구 위례순환로 125" → 경기 / 성남시)
function splitAddress(address) {
  const parts = String(address || "").trim().split(/\s+/);
  const sido = sidoKey(parts[0]);
  let gu = parts[1] || "";
  if (sido === "세종") gu = "세종특별자치시"; // 세종은 시군구가 없어요
  if (!/(시|군|구)$/.test(gu)) gu = "기타";
  return { sido, gu };
}

(async () => {
  const key = getEnv("LIBRARY_API_KEY");
  if (!key) { console.error("LIBRARY_API_KEY가 없어요"); process.exit(1); }

  const libs = [];
  let calls = 0;
  let total = Infinity;
  for (let page = 1; libs.length < total; page++) {
    if (++calls > MAX_CALLS) { console.error("호출 상한 도달, 중단"); process.exit(1); }
    const qs = new URLSearchParams({ authKey: key, format: "json", pageNo: String(page), pageSize: "500" });
    const res = await fetch(`https://data4library.kr/api/libSrch?${qs}`, { signal: AbortSignal.timeout(60000) });
    const json = await res.json();
    const r = json && json.response;
    if (!r || r.errCode) { console.error("정보나루 오류:", r && r.errCode); process.exit(1); }
    total = Number(r.numFound) || 0;
    const got = (r.libs || []).map((x) => x.lib);
    if (!got.length) break;
    libs.push(...got);
    console.log(`  ${page}페이지: ${got.length}곳 (누적 ${libs.length}/${total})`);
  }

  const seen = new Set();
  const out = [];
  let unknown = 0;
  for (const l of libs) {
    const code = String(l.libCode || "").trim();
    if (!/^\d{5,8}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    const { sido, gu } = splitAddress(l.address);
    if (!sido) { unknown++; continue; }
    out.push({
      c: code,                                   // 도서관 코드
      n: String(l.libName || "").trim(),         // 이름
      a: String(l.address || "").trim(),         // 주소
      b: Number(l.BookCount) || 0,               // 소장 단행본 수
      s: sido,                                   // 시도
      g: gu,                                     // 시군구
    });
  }
  out.sort((x, y) => SIDO_ORDER.indexOf(x.s) - SIDO_ORDER.indexOf(y.s) || x.g.localeCompare(y.g, "ko") || x.n.localeCompare(y.n, "ko"));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: out.length, sido: SIDO_ORDER, libs: out }));
  const bySido = {};
  for (const l of out) bySido[l.s] = (bySido[l.s] || 0) + 1;
  console.log(`저장: ${path.relative(ROOT, OUT)} (${out.length}곳, 시도 불명 ${unknown}곳 제외) | 정보나루 호출 ${calls}회`);
  console.log("시도별:", JSON.stringify(bySido));
})().catch((e) => { console.error("오류:", e.message); process.exit(1); });
