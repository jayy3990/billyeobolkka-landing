// 도서 추천 허용값 표. 서버는 화면에서 온 값을 이 표와 대조해서 "허용된 것만" 써요.
// 사용자가 입력한 글자는 이 표를 거쳐 ID(영문 키)로만 바뀌어서 정보나루·Claude로 나가요.

// 연령대: 정보나루 age 코드 (1은 청소년 14~19세, 20=20대 ... 60=60세 이상). null = 조건 없음
const AGE_GROUPS = {
  any: { age: null, label: "선택 안 함" },
  teen: { age: "14", label: "10대 후반(청소년)" },
  "20s": { age: "20", label: "20대" },
  "30s": { age: "30", label: "30대" },
  "40s": { age: "40", label: "40대" },
  "50s": { age: "50", label: "50대" },
  "60s": { age: "60", label: "60세 이상" },
};

// 성별: 정보나루 gender 코드 (0 남성, 1 여성). null = 조건 없음
const GENDERS = {
  any: { gender: null, label: "선택 안 함" },
  male: { gender: "0", label: "남성" },
  female: { gender: "1", label: "여성" },
};

// 장르 → 정보나루 KDC 대분류(kdc) + 서버에서 class_no(분류번호)로 한 번 더 거르는 규칙
// 문학(8)은 분류번호의 형식 자리로 구분해요: 소설 8?3, 시 8?1, 수필 8?4. 세계문학전집은 808 로 분류되는 도서관이 많아 소설에 포함해요.
const GENRES = {
  novel: { label: "소설", kdc: ["8"], re: /^(8[1-9]3|808)/ },
  poetry: { label: "시", kdc: ["8"], re: /^8[1-9]1/ },
  essay: { label: "에세이", kdc: ["8"], re: /^(8[1-9]4|818)/ },
  humanities: { label: "인문·철학·종교", kdc: ["1", "2"], re: null },
  psychology: { label: "심리·자기계발", kdc: ["1", "3"], re: /^(18|19|325\.2)/ },
  economy: { label: "경제·경영", kdc: ["3"], re: /^32/ },
  society: { label: "사회·정치·법", kdc: ["3"], re: /^3[3-6]/ },
  science: { label: "과학", kdc: ["4"], re: null },
  tech: { label: "IT·기술", kdc: ["0", "5"], re: /^(00[45]|5)/ },
  art: { label: "예술·문화", kdc: ["6"], re: null },
  history: { label: "역사·여행", kdc: ["9"], re: null },
};

const LIMITS = {
  maxGenres: 3, // 한 번에 고를 수 있는 장르 수
  maxLiked: 3, // 좋아한 책 수
  maxBuckets: 4, // 한 요청에서 호출하는 KDC 대분류 수 (정보나루 호출 절약)
  poolPerBucket: 100, // 대분류당 가져오는 인기대출 권수
  recentPerBucket: 100, // 대분류당 가져오는 최근 입수 권수
  maxCandidates: 120, // Claude에 보내는 후보 권수 상한
  minPool: 15, // 이보다 적으면 성별·연령 조건을 풀어서 다시 가져와요
  recommendMin: 3, // 검증 후 이만큼은 있어야 결과로 인정
  recommendMax: 8,
  adventureGenres: 2, // 모험 때 한 번에 가져오는 낯선 장르 수
  adventureWide: 4, // 후보가 모자랄 때 넓히는 낯선 장르 수
  adventureMinGenres: 2, // 모험 결과에 섞여야 하는 서로 다른 장르 수(후보가 허용하는 범위에서)
  loanMonths: 12, // 인기대출 집계 기간(개월). 정보나루 권장: 최소 3개월
};

// 모험 하기: 장르별 "가까운(인접)" 장르. 가까운 모험은 여기서, 먼 모험은 그 밖의 장르에서 골라요.
const ADVENTURE_NEAR = {
  novel: ["essay", "history", "humanities", "poetry"],
  poetry: ["essay", "novel", "art", "humanities"],
  essay: ["novel", "humanities", "psychology", "art"],
  humanities: ["psychology", "history", "society", "essay"],
  psychology: ["humanities", "essay", "society", "economy"],
  economy: ["society", "psychology", "tech", "history"],
  society: ["economy", "history", "humanities", "psychology"],
  science: ["tech", "humanities", "history", "economy"],
  tech: ["science", "economy", "art", "society"],
  art: ["history", "humanities", "essay", "poetry"],
  history: ["society", "humanities", "art", "novel"],
};

// 장서에서 제외할 독자 대상(ISBN 부가기호): 5·6 학습참고서, 7 아동
const EXCLUDED_ADD_CODES = ["5", "6", "7"];
// 인기대출 조회에 쓰는 부가기호: 0 교양, 1 실용, 2 여성, 4 청소년, 9 전문
const ADULT_ADD_CODES = "0;1;2;4;9";

module.exports = { AGE_GROUPS, GENDERS, GENRES, ADVENTURE_NEAR, LIMITS, EXCLUDED_ADD_CODES, ADULT_ADD_CODES };
