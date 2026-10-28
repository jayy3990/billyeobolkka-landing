// 모험 하기 시험. 정보나루·Claude·Supabase는 모두 가짜예요 (실제 호출 없음). 실행: npm test
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class {};

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SITE_URL = "https://example.test";
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_dummy";
process.env.LIBRARY_API_KEY = "SECRET-LIB-KEY-12345";

const A = require("../api/_lib/auth");
const cache = require("../api/_lib/cache");
const libs = require("../api/_lib/libs");
const core = require("../api/_lib/recommend-core");
const cfg = require("../api/_lib/recommend-config");
const pipeline = require("../api/_lib/recommend-pipeline");
const history = require("../api/_lib/history");
const recommendHandler = require("../api/recommend");

cache.deps.runtime = null;
libs.reset({ byCode: new Map([["141628", { c: "141628", n: "성남시 위례도서관", s: "경기", g: "성남시" }]]), count: 1 });

const seq = (n) => { let i = 0; return () => (i++ % n) / n; }; // 고정 난수

test("offGenres: 가까운 모험은 인접 장르에서, 먼 모험은 인접이 아닌 장르에서, 내 장르는 절대 안 나와요", () => {
  for (const chosen of [["novel"], ["science"], ["novel", "history"], ["economy", "tech", "art"]]) {
    for (let t = 0; t < 30; t++) {
      const rnd = Math.random;
      const near = core.offGenres(chosen, "near", rnd, 2);
      const far = core.offGenres(chosen, "far", rnd, 2);
      const nearSet = new Set(chosen.flatMap((g) => cfg.ADVENTURE_NEAR[g]).filter((g) => !chosen.includes(g)));
      assert.equal(near.length, 2); assert.equal(far.length, 2);
      assert.ok(near.every((g) => !chosen.includes(g) && nearSet.has(g)), `가까운: ${chosen} → ${near}`);
      // 먼 모험: 인접이 아닌 장르를 먼저 채우고, 그런 장르가 2개 미만이면(장르를 여러 개 골랐을 때) 나머지로 채워요
      const farPool = Object.keys(cfg.GENRES).filter((g) => !chosen.includes(g) && !nearSet.has(g));
      assert.ok(far.every((g) => !chosen.includes(g)), `먼: ${chosen} → ${far}`);
      assert.equal(far.filter((g) => farPool.includes(g)).length, Math.min(2, farPool.length), `먼: ${chosen} → ${far}`);
      assert.equal(new Set(near).size, 2);
    }
  }
});

test("offGenres: 후보 풀이 모자라면 나머지 장르로 채우고(내 장르 제외), 넓힐 때는 4개까지", () => {
  const nine = ["novel", "poetry", "essay", "humanities", "psychology", "economy", "society", "science", "tech"];
  const far = core.offGenres(nine, "far", Math.random, 2);
  assert.equal(far.length, 2); assert.ok(far.every((g) => !nine.includes(g)), "남은 장르(art, history)에서");
  assert.equal(core.offGenres(["novel"], "near", Math.random, 4).length, 4);
  // 같은 난수면 같은 결과 (시험 재현용)
  assert.deepEqual(core.offGenres(["novel"], "far", seq(7), 2), core.offGenres(["novel"], "far", seq(7), 2));
});

test("ADVENTURE_NEAR: 모든 장르에 인접 장르가 있고, 자기 자신은 없고, 모두 실제 장르예요", () => {
  for (const g of Object.keys(cfg.GENRES)) {
    assert.ok(cfg.ADVENTURE_NEAR[g] && cfg.ADVENTURE_NEAR[g].length >= 3, g);
    assert.ok(!cfg.ADVENTURE_NEAR[g].includes(g));
    assert.ok(cfg.ADVENTURE_NEAR[g].every((n) => cfg.GENRES[n]), g);
  }
});

test("validateInput: mode는 'adventure'만, distance는 'far'만 인정하고 나머지는 기본값(normal/near)", () => {
  const base = { lang: "ko", libCode: "141628", ageGroup: "20s", gender: "male", genres: ["novel"], liked: [] };
  const ok = (extra) => core.validateInput({ ...base, ...extra }, libs.isKnownLibrary).value;
  assert.deepEqual([ok({}).mode, ok({}).distance], ["normal", "near"]);
  assert.deepEqual([ok({ mode: "adventure", distance: "far" }).mode, ok({ mode: "adventure", distance: "far" }).distance], ["adventure", "far"]);
  assert.deepEqual([ok({ mode: "ADVENTURE", distance: "farther" }).mode, ok({ mode: "ADVENTURE", distance: "farther" }).distance], ["normal", "near"]);
  assert.equal(ok({ mode: { $ne: 1 } }).mode, "normal");
});

const book = (isbn, title, classNo, author = "작가") => ({ isbn13: isbn, title, author, classNo, addCode: "0", rank: 1 });

test("assembleCandidates(모험): 내 장르 책은 빼고, 낯선 장르 표시를 붙이고, 읽은 책·제외 목록도 빠져요", () => {
  const pop = [
    book("9780000000001", "과학책", "420"), book("9780000000002", "역사책", "911"), book("9780000000003", "읽은 역사책", "911"),
    book("9780000000004", "경제책", "320"), book("9780000000005", "철학책", "150"),
  ];
  const out = core.assembleCandidates({ popular: pop, recent: [], genres: ["history", "economy"], liked: [], exclude: [{ isbn13: "9780000000003", title: "읽은 역사책", author: "작가" }], avoidGenres: ["science"] });
  assert.deepEqual(out.map((b) => [b.title, b.genre]), [["역사책", "history"], ["경제책", "economy"]]);
});

// ── 파이프라인 ──
const kdcBooks = {
  "9": ["역사1", "역사2", "역사3", "역사4", "역사5", "역사6"].map((t, i) => book("97800000091" + String(i).padStart(2, "0"), t, "911." + i, "역사가" + i)),
  "0": ["기술1", "기술2", "기술3"].map((t, i) => book("97800000001" + String(i).padStart(2, "0"), t, "005." + i, "개발자" + i)),
  "5": ["공학1", "공학2", "공학3"].map((t, i) => book("97800000051" + String(i).padStart(2, "0"), t, "55" + i, "공학자" + i)),
  "1": ["철학1", "철학2", "철학3", "철학4"].map((t, i) => book("97800000011" + String(i).padStart(2, "0"), t, "10" + i, "철학자" + i)),
  "2": ["종교1", "종교2", "종교3"].map((t, i) => book("97800000021" + String(i).padStart(2, "0"), t, "20" + i, "신학자" + i)),
  "3": ["경제1", "경제2", "경제3", "경제4"].map((t, i) => book("97800000031" + String(i).padStart(2, "0"), t, "32" + i, "경제학자" + i)),
  "4": ["과학1", "과학2", "과학3", "과학4", "과학5"].map((t, i) => book("97800000041" + String(i).padStart(2, "0"), t, "42" + i, "과학자" + i)),
  "6": ["예술1", "예술2", "예술3", "예술4"].map((t, i) => book("97800000061" + String(i).padStart(2, "0"), t, "60" + i, "예술가" + i)),
  "8": ["소설1", "소설2", "소설3", "소설4", "소설5", "소설6"].map((t, i) => book("97800000081" + String(i).padStart(2, "0"), t, "813." + i, "소설가" + i)),
};
function wire({ onPrompt, claude, calls = { pop: [], rec: [] } } = {}) {
  pipeline.deps.library = {
    getBook: async (i) => ({ isbn13: i, title: "고른 책", author: "고른 저자" }),
    maniaRecs: async () => [],
    popular: async (o) => { calls.pop.push(o.kdc); return kdcBooks[o.kdc] || []; },
    recent: async (o) => { calls.rec.push(o.kdc); return []; },
    availability: async () => ({ has: true, loan: true }),
  };
  pipeline.deps.claude = { recommend: claude || (async (p) => {
    if (onPrompt) onPrompt(p);
    const lines = p.user.split(/\r?\n/).filter((l) => /^\d+\|/.test(l));
    return { data: { recommendations: lines.slice(0, 5).map((l) => { const [id, title] = l.split("|"); return { id: Number(id), title, reason: "취향과 이어지는 이유" }; }) }, usage: { input: 1, output: 1 } };
  }) };
  pipeline.deps.random = Math.random;
  return calls;
}
const advInput = { lang: "ko", libCode: "141628", ageGroup: "20s", gender: "male", genres: ["science"], liked: [], mode: "adventure", distance: "near", shelf: [], avoid: [] };

test("pipeline(모험): 후보는 모두 내 장르(과학) 밖이고, 결과에 모험 표시·낯선 장르가 붙고, 프롬프트에 모험 규칙이 들어가요", async () => {
  let prompt = null;
  const calls = wire({ onPrompt: (p) => { prompt = p; } });
  const out = await pipeline.run(advInput);
  assert.ok(out.items.length >= 3);
  assert.ok(out.items.every((i) => i.adventure === true && cfg.GENRES[i.genre]), JSON.stringify(out.items.map((i) => i.genre)));
  assert.ok(out.items.every((i) => i.genre !== "science" && !i.title.startsWith("과학")), "내 장르 책은 없어요");
  assert.ok(out.meta.off.every((g) => cfg.ADVENTURE_NEAR.science.includes(g)), "가까운 모험: 과학의 인접 장르만 " + out.meta.off);
  assert.equal(out.meta.mode, "adventure");
  assert.ok(!calls.pop.includes("4"), "내 장르의 분류(4)는 조회하지 않아요: " + calls.pop);
  assert.match(prompt.system, /모험 추천/);
  assert.match(prompt.user, /<adventure>\n거리: 가까운 모험/);
  assert.match(prompt.user, /낯선 장르: /);
  assert.match(prompt.user, /형식: .*낯선 장르/);
  assert.equal((prompt.user.match(/<adventure>/g) || []).length, 1);
});

test("pipeline(모험, 먼 모험): 인접 장르가 아닌 곳에서 골라요", async () => {
  wire();
  for (let t = 0; t < 12; t++) {
    const out = await pipeline.run({ ...advInput, genres: ["novel"], distance: "far" });
    const near = cfg.ADVENTURE_NEAR.novel;
    assert.ok(out.meta.off.every((g) => !near.includes(g) && g !== "novel"), "먼: " + out.meta.off);
  }
});

test("pipeline(모험): 읽은 책(서재)과 최근 추천받은 책(avoid)은 빠지고, 일반 추천에서는 avoid를 쓰지 않아요", async () => {
  const calls = wire({ onPrompt: () => {} });
  pipeline.deps.random = () => 0; // 항상 같은 장르가 뽑히게
  const first = await pipeline.run(advInput);
  const picked = first.items[0];
  const shelf = [{ isbn13: picked.isbn13, title: picked.title, author: picked.author, rating: "liked" }];
  const second = await pipeline.run({ ...advInput, shelf });
  assert.ok(!second.items.some((i) => i.isbn13 === picked.isbn13), "서재의 책은 제외");
  const third = await pipeline.run({ ...advInput, avoid: [{ isbn13: picked.isbn13, title: picked.title, author: picked.author }] });
  assert.ok(!third.items.some((i) => i.isbn13 === picked.isbn13), "최근 추천한 책은 제외");
  // 일반 추천에서는 avoid가 후보를 줄이지 않아요
  wire();
  const normal = await pipeline.run({ ...advInput, mode: "normal", genres: ["history"], avoid: kdcBooks["9"].map((b) => ({ isbn13: b.isbn13, title: b.title, author: b.author })) });
  assert.ok(normal.items.length >= 3 && normal.items.every((i) => i.adventure === undefined));
  void calls;
});

test("pipeline(모험): 한 장르로만 몰린 결과는 한 번 더 시도하고, 그래도 안 되면 처음 결과를 써요", async () => {
  // 후보를 한 장르(역사)에서만 고르는 Claude → 다양성 부족 → 재시도
  let n = 0;
  const pickOnly = (prefix, count) => async (p) => {
    n++;
    const lines = p.user.split(/\r?\n/).filter((l) => /^\d+\|/.test(l));
    const sel = (n === 1 ? lines.filter((l) => l.split("|")[1].startsWith(prefix)) : lines).slice(0, count);
    return { data: { recommendations: sel.map((l) => { const [id, title] = l.split("|"); return { id: Number(id), title, reason: "이유" }; }) }, usage: { input: 1, output: 1 } };
  };
  wire({ claude: pickOnly("역사", 4) });
  pipeline.deps.random = () => 0;
  const out = await pipeline.run({ ...advInput, genres: ["novel"], distance: "near" });
  assert.ok(n >= 1);
  if (new Set(out.meta.off).size >= 2) assert.equal(n, 2, "다양성이 부족해서 재시도");
  // 항상 한 장르만 고르는 Claude → 2번 시도 후 처음 결과를 그대로 사용 (실패하지 않아요)
  n = 0;
  wire({ claude: async (p) => { n++; const lines = p.user.split(/\r?\n/).filter((l) => /^\d+\|/.test(l)); const first = lines[0].split("|")[1].slice(0, 2); const sel = lines.filter((l) => l.split("|")[1].startsWith(first)).slice(0, 4); return { data: { recommendations: sel.map((l) => { const [id, title] = l.split("|"); return { id: Number(id), title, reason: "이유" }; }) }, usage: { input: 1, output: 1 } }; } });
  const out2 = await pipeline.run({ ...advInput, genres: ["novel"], distance: "near" });
  assert.ok(out2.items.length >= 3);
});

test("pipeline(모험): 낯선 장르의 후보가 너무 적으면 'few' (횟수 되돌리기는 추천 핸들러가 해요)", async () => {
  wire();
  pipeline.deps.library.popular = async () => [book("9780000000001", "역사1", "911"), book("9780000000002", "역사2", "911")];
  await assert.rejects(() => pipeline.run({ ...advInput, genres: ["novel"] }), (e) => e.code === "few");
});

// ── 핸들러·기록 ──
function fakeSb({ histRows = [], user = { id: "u1" } } = {}) {
  const saved = [];
  const sb = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async (name, args) => ({ data: name === "reserve_usage" ? [{ allowed: true, event_id: "ev", remaining: 4 }] : true, error: null }),
    from: (t) => {
      if (t === "user_library") return { select: () => { const a = { eq: () => a, order: () => a, limit: () => a, then: (r) => Promise.resolve({ data: [], error: null }).then(r) }; return a; } };
      assert.equal(t, "recommendation_history");
      return {
        insert: (row) => ({ select: () => ({ maybeSingle: async () => { saved.push(row); return { data: { id: "00000000-0000-4000-8000-000000000777" }, error: null }; } }) }),
        select: (cols) => { const f = { eq: () => f, order: () => f, limit: () => f, range: () => f, in: () => f, then: (r) => Promise.resolve({ data: cols === "items" ? histRows : [], error: null }).then(r) }; return f; },
        delete: () => { const d = { eq: () => d, in: () => d, then: (r) => Promise.resolve({ error: null }).then(r) }; return d; },
      };
    },
  };
  A.deps.createSupabase = () => sb;
  return { saved };
}
const makeRes = () => { const res = { code: 200, body: undefined, setHeader() {}, status(c) { res.code = c; return res; }, send(b) { res.body = b; return res; }, end(b) { res.body = b; return res; } }; return res; };
const post = (body) => ({ method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body });

test("POST /api/recommend (모험): 기록에 mode=adventure와 낯선 장르가 저장되고, 최근 추천 책이 후보에서 빠져요", async () => {
  wire();
  pipeline.deps.random = () => 0;
  const probe = await pipeline.run(advInput);
  const recent = probe.items[0];
  const { saved } = fakeSb({ histRows: [{ items: [{ isbn13: recent.isbn13, title: recent.title, author: recent.author }] }] });
  const res = makeRes();
  await recommendHandler(post({ lang: "ko", libCode: "141628", ageGroup: "20s", gender: "male", genres: ["science"], liked: [], mode: "adventure", distance: "near" }), res);
  assert.equal(res.code, 200);
  const b = JSON.parse(res.body);
  assert.ok(b.items.every((i) => i.adventure === true));
  assert.ok(!b.items.some((i) => i.isbn13 === recent.isbn13), "최근 추천한 책은 모험에서 다시 나오지 않아요");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].mode, "adventure");
  assert.ok(saved[0].items.every((it) => cfg.GENRES[it.genre]), "기록에도 낯선 장르가 남아요");
});

test("POST /api/recommend (일반): 기록의 mode는 normal이고 책에 genre·adventure 칸이 없어요", async () => {
  wire();
  const { saved } = fakeSb();
  const res = makeRes();
  await recommendHandler(post({ lang: "ko", libCode: "141628", ageGroup: "20s", gender: "male", genres: ["history"], liked: [] }), res);
  assert.equal(res.code, 200);
  assert.equal(saved[0].mode, "normal");
  assert.ok(saved[0].items.every((it) => !("genre" in it)));
  assert.ok(JSON.parse(res.body).items.every((i) => !("adventure" in i)));
});

test("history.toClient: mode와 책의 genre를 안전하게 돌려줘요(모르는 값은 normal/null)", () => {
  const c = history.toClient({ id: "x", created_at: "2026-10-28T00:00:00Z", lang: "ko", lib_code: "141628", age_group: "20s", gender: "male", genres: [], liked: [], mode: "hack", items: [{ isbn13: "1", title: "t", genre: "science" }, { isbn13: "2", title: "t", genre: "<b>" }] });
  assert.equal(c.mode, "normal");
  assert.deepEqual(c.items.map((i) => i.genre), ["science", null]);
  assert.equal(history.toClient({ id: "x", created_at: "", lang: "ko", lib_code: "141628", mode: "adventure", items: [] }).mode, "adventure");
});
