// 추천 한 번의 전체 흐름. 순서:
//  좋아한 책 공식 정보 → (취향 단서) 마니아 추천 → 이 도서관 후보(인기+최근 입수) → Claude가 후보 안에서 선택
//  → 서버가 ISBN 검증 → 대출 가능 여부 조회
// 의존하는 모듈(정보나루·Claude)은 deps 로 바꿀 수 있게 해서, 실제 호출 없이 시험할 수 있어요.

const library = require("./library");
const claude = require("./claude");
const core = require("./recommend-core");
const shelfLib = require("./shelf");
const { AGE_GROUPS, GENDERS, LIMITS, ADULT_ADD_CODES } = require("./recommend-config");

const deps = { library, claude, random: Math.random };

async function run(input) {
  const { library: lib, claude: ai } = deps;
  const age = AGE_GROUPS[input.ageGroup].age;
  const gender = GENDERS[input.gender].gender;

  // 1) 좋아한 책: 제목·저자는 사용자 입력이 아니라 정보나루의 공식 서지정보를 써요 (실패해도 계속)
  const likedBooks = (await Promise.all(input.liked.map((i) => lib.getBook(i).catch(() => null)))).filter(Boolean);

  // 2) 취향 단서: 함께 많이 읽힌 책 (실패해도 계속 — 후보가 아니라 힌트예요)
  //    기준 책은 이번에 고른 책 + (모자라면) 내 서재에서 재밌게 읽은 최근 책, 합쳐서 최대 3권 (정보나루 호출 수는 그대로)
  const shelf = Array.isArray(input.shelf) ? input.shelf : [];
  const seeds = shelfLib.seedIsbns(likedBooks.map((b) => b.isbn13), shelf);
  const hints = seeds.length ? await lib.maniaRecs(seeds).catch(() => []) : [];

  // 3) 이 도서관 후보: 같은 성별·연령의 인기대출(소장 보장) + 최근 입수(신간 보강)
  //    모험 추천이면 내 장르 밖의 낯선 장르에서, 최근 추천받은 책(avoid)과 읽은 책은 빼고 모아요
  const adventure = input.mode === "adventure";
  const exclude = adventure ? [...shelf, ...(Array.isArray(input.avoid) ? input.avoid : [])] : shelf;
  const fetchFor = (ids, g, a) => {
    const { kdcs } = core.bucketsFor(ids);
    return Promise.all([
      Promise.all(kdcs.map((kdc) => lib.popular({ libCode: input.libCode, gender: g, age: a, kdc, addCodes: ADULT_ADD_CODES }))).then((x) => x.flat()),
      Promise.all(kdcs.map((kdc) => lib.recent({ libCode: input.libCode, kdc }).catch(() => []))).then((x) => x.flat()),
    ]);
  };
  // 모험: 낯선 장르마다 후보를 따로 모아(장르당 상한) 합쳐서, 한 장르가 후보를 독차지하지 못하게 해요
  const advCandidates = (ids, popular, recent) => {
    const per = Math.max(10, Math.floor(LIMITS.maxCandidates / ids.length));
    const seen = new Set(), out = [];
    for (const id of ids) {
      for (const c of core.assembleCandidates({ popular, recent, genres: [id], liked: likedBooks, exclude, avoidGenres: input.genres, cap: per })) {
        if (!seen.has(c.isbn13)) { seen.add(c.isbn13); out.push(c); }
      }
    }
    return out;
  };

  let offIds = [];
  let candidates, relaxed = false;
  if (adventure) {
    offIds = core.offGenres(input.genres, input.distance, deps.random, LIMITS.adventureGenres);
    let [popular, recent] = await fetchFor(offIds, gender, age);
    candidates = advCandidates(offIds, popular, recent);
    if (candidates.length < LIMITS.minPool) {
      // 후보가 모자라면 낯선 장르를 더 넓히고 성별·연령 조건도 풀어요
      relaxed = true;
      offIds = core.offGenres(input.genres, input.distance, deps.random, LIMITS.adventureWide);
      [popular, recent] = await fetchFor(offIds, null, null);
      candidates = advCandidates(offIds, popular, recent);
    }
  } else {
    const [popular, recent] = await fetchFor(input.genres, gender, age);
    candidates = core.assembleCandidates({ popular, recent, genres: input.genres, liked: likedBooks, exclude });
    if (candidates.length < LIMITS.minPool && (gender || age)) {
      // 조건이 너무 좁아서 후보가 적으면, 성별·연령 조건을 풀어서 이 도서관 전체 인기로 보강해요
      relaxed = true;
      const [widePop] = await fetchFor(input.genres, null, null);
      candidates = core.assembleCandidates({ popular: [...popular, ...widePop], recent, genres: input.genres, liked: likedBooks, exclude });
    }
  }
  if (candidates.length < 5) throw new core.PipelineError("few");

  // 4) Claude: 후보 안에서만 고르기 (결과가 검증을 못 넘으면 한 번 더)
  const byIsbn = new Map(candidates.map((c) => [c.isbn13, c]));
  const prompt = core.buildPrompt({
    lang: input.lang, ageGroup: input.ageGroup, gender: input.gender, genres: input.genres,
    liked: likedBooks, hints, candidates, shelf: shelfLib.summarize(shelf),
    adventure: adventure ? { distance: input.distance, genres: offIds } : null,
  });
  let items = null, fallback = null;
  let usage = { input: 0, output: 0 };
  // 모험은 서로 다른 낯선 장르가 섞여야 해요(후보가 허용하는 범위에서). 부족하면 한 번 더 시도하고, 그래도 안 되면 처음 결과를 써요
  const needGenres = adventure ? Math.min(LIMITS.adventureMinGenres, new Set(candidates.map((c) => c.genre)).size) : 0;
  for (let attempt = 0; attempt < 2 && !items; attempt++) {
    try {
      const out = await ai.recommend(prompt);
      usage = { input: usage.input + out.usage.input, output: usage.output + out.usage.output };
      items = core.validateOutput(out.data, candidates);
      if (items && adventure && new Set(items.map((it) => byIsbn.get(it.isbn13).genre)).size < needGenres) { fallback = fallback || items; items = null; }
    } catch (e) {
      if (e && e.code === "parse" && attempt === 0) continue; // 파싱 실패만 재시도
      throw e;
    }
  }
  if (!items) items = fallback;
  if (!items) throw new core.PipelineError("ai");

  // 5) 대출 가능 여부 (전날 기준, 캐시): Y 대출 가능 / N 대출 중 / null 확인 불가
  const avail = await Promise.all(
    items.map((it) => lib.availability(input.libCode, it.isbn13).then((v) => (v && v.has ? (v.loan ? "Y" : "N") : null)).catch(() => null))
  );

  // 바로 빌릴 수 있는 책이 위로 오게 정렬: 대출 가능(Y) → 확인 불가(null) → 대출 중(N).
  // 같은 묶음 안에서는 Claude가 고른 순서를 그대로 유지해요 (Array.prototype.sort는 안정 정렬)
  const AVAIL_ORDER = { Y: 0, null: 1, N: 2 };
  const ordered = items
    .map((it, i) => {
      const c = byIsbn.get(it.isbn13);
      return { isbn13: it.isbn13, title: c.title, author: c.author, reason: it.reason, available: avail[i], ...(adventure ? { adventure: true, genre: c.genre || null } : {}) };
    })
    .sort((a, b) => AVAIL_ORDER[a.available] - AVAIL_ORDER[b.available]);

  return {
    items: ordered,
    liked: likedBooks.map((b) => ({ isbn13: b.isbn13, title: b.title, author: b.author })),
    meta: { pool: candidates.length, relaxed, hints: hints.length, shelf: shelf.length, mode: adventure ? "adventure" : "normal", off: offIds, usage },
  };
}

module.exports = { run, deps };
