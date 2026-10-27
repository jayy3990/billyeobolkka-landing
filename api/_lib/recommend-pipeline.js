// 추천 한 번의 전체 흐름. 순서:
//  좋아한 책 공식 정보 → (취향 단서) 마니아 추천 → 이 도서관 후보(인기+최근 입수) → Claude가 후보 안에서 선택
//  → 서버가 ISBN 검증 → 대출 가능 여부 조회
// 의존하는 모듈(정보나루·Claude)은 deps 로 바꿀 수 있게 해서, 실제 호출 없이 시험할 수 있어요.

const library = require("./library");
const claude = require("./claude");
const core = require("./recommend-core");
const { AGE_GROUPS, GENDERS, LIMITS, ADULT_ADD_CODES } = require("./recommend-config");

const deps = { library, claude };

async function run(input) {
  const { library: lib, claude: ai } = deps;
  const age = AGE_GROUPS[input.ageGroup].age;
  const gender = GENDERS[input.gender].gender;

  // 1) 좋아한 책: 제목·저자는 사용자 입력이 아니라 정보나루의 공식 서지정보를 써요 (실패해도 계속)
  const likedBooks = (await Promise.all(input.liked.map((i) => lib.getBook(i).catch(() => null)))).filter(Boolean);

  // 2) 취향 단서: 함께 많이 읽힌 책 (실패해도 계속 — 후보가 아니라 힌트예요)
  const hints = likedBooks.length ? await lib.maniaRecs(likedBooks.map((b) => b.isbn13)).catch(() => []) : [];

  // 3) 이 도서관 후보: 같은 성별·연령의 인기대출(소장 보장) + 최근 입수(신간 보강)
  const { kdcs } = core.bucketsFor(input.genres);
  const fetchPop = (g, a) => Promise.all(kdcs.map((kdc) => lib.popular({ libCode: input.libCode, gender: g, age: a, kdc, addCodes: ADULT_ADD_CODES })));
  let popular = (await fetchPop(gender, age)).flat();
  const recent = (await Promise.all(kdcs.map((kdc) => lib.recent({ libCode: input.libCode, kdc }).catch(() => [])))).flat();

  let candidates = core.assembleCandidates({ popular, recent, genres: input.genres, liked: likedBooks });
  let relaxed = false;
  if (candidates.length < LIMITS.minPool && (gender || age)) {
    // 조건이 너무 좁아서 후보가 적으면, 성별·연령 조건을 풀어서 이 도서관 전체 인기로 보강해요
    relaxed = true;
    const wide = (await fetchPop(null, null)).flat();
    candidates = core.assembleCandidates({ popular: [...popular, ...wide], recent, genres: input.genres, liked: likedBooks });
  }
  if (candidates.length < 5) throw new core.PipelineError("few");

  // 4) Claude: 후보 안에서만 고르기 (결과가 검증을 못 넘으면 한 번 더)
  const byIsbn = new Map(candidates.map((c) => [c.isbn13, c]));
  const prompt = core.buildPrompt({
    lang: input.lang, ageGroup: input.ageGroup, gender: input.gender, genres: input.genres,
    liked: likedBooks, hints, candidates,
  });
  let items = null;
  let usage = { input: 0, output: 0 };
  for (let attempt = 0; attempt < 2 && !items; attempt++) {
    try {
      const out = await ai.recommend(prompt);
      usage = { input: usage.input + out.usage.input, output: usage.output + out.usage.output };
      items = core.validateOutput(out.data, candidates);
    } catch (e) {
      if (e && e.code === "parse" && attempt === 0) continue; // 파싱 실패만 재시도
      throw e;
    }
  }
  if (!items) throw new core.PipelineError("ai");

  // 5) 대출 가능 여부 (전날 기준, 캐시): Y 대출 가능 / N 대출 중 / null 확인 불가
  const avail = await Promise.all(
    items.map((it) => lib.availability(input.libCode, it.isbn13).then((v) => (v && v.has ? (v.loan ? "Y" : "N") : null)).catch(() => null))
  );

  return {
    items: items.map((it, i) => {
      const c = byIsbn.get(it.isbn13);
      return { isbn13: it.isbn13, title: c.title, author: c.author, reason: it.reason, available: avail[i] };
    }),
    liked: likedBooks.map((b) => ({ isbn13: b.isbn13, title: b.title, author: b.author })),
    meta: { pool: candidates.length, relaxed, hints: hints.length, usage },
  };
}

module.exports = { run, deps };
