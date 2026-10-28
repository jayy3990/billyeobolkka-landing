// 추천 기록 시험. Supabase·정보나루·Claude는 모두 가짜예요 (실제 DB·호출 없음). 실행: npm test
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
const history = require("../api/_lib/history");
const pipeline = require("../api/_lib/recommend-pipeline");
const historyHandler = require("../api/history");
const recommendHandler = require("../api/recommend");

cache.deps.runtime = null;
libs.reset({
  byCode: new Map([
    ["141628", { c: "141628", n: "성남시 위례도서관", s: "경기", g: "성남시" }],
    ["111347", { c: "111347", n: "강남구립도곡정보문화도서관", s: "서울", g: "강남구" }],
  ]),
  count: 2,
});

function makeRes() {
  const headers = {};
  const res = { code: 200, body: undefined, headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { res.code = c; return res; }, send(b) { res.body = b; return res; }, end(b) { res.body = b; return res; } };
  return res;
}
const json = (res) => JSON.parse(res.body);
const ORIGIN = { origin: "https://example.test" };

// 가짜 DB: recommendation_history 표 (RLS는 DB가 하고, 여기서는 서버가 거는 조건·호출 모양을 확인해요)
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function makeStore(initial = []) {
  const store = { rows: initial.slice(), seq: 1000, log: [], failInsert: false };
  const query = (mode) => {
    const filters = []; let order = null, lim = null, range = null;
    const run = () => {
      let r = store.rows.filter((row) => filters.every((f) => f(row)));
      if (mode === "delete") { const ids = new Set(r.map((x) => x.id)); store.rows = store.rows.filter((x) => !ids.has(x.id)); store.log.push(["delete", r.length]); return { data: null, error: null }; }
      if (order) r = r.slice().sort((a, b) => (order[1].ascending === false ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)));
      if (range) r = r.slice(range[0], range[1] + 1);
      if (lim != null) r = r.slice(0, lim);
      return { data: r, error: null };
    };
    const api = {
      eq: (c, v) => { filters.push((row) => row[c] === v); return api; },
      in: (c, vs) => { filters.push((row) => vs.includes(row[c])); return api; },
      order: (c, o) => { order = [c, o || {}]; return api; },
      limit: (n) => { lim = n; return api; },
      range: (a, b) => { range = [a, b]; return api; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] || null, error: null }; },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return api;
  };
  store.table = {
    insert: (row) => ({
      select: () => ({
        maybeSingle: async () => {
          store.log.push(["insert", row]);
          if (store.failInsert) return { data: null, error: { code: "XX" } };
          store.seq++;
          const saved = { id: uuid(store.seq), created_at: new Date(Date.UTC(2026, 9, 27, 0, 0, store.seq % 3600)).toISOString(), ...row };
          store.rows.push(saved);
          return { data: { id: saved.id }, error: null };
        },
      }),
    }),
    select: () => query("select"),
    delete: () => query("delete"),
  };
  return store;
}
function fakeSupabase(store, { user = { id: "u1" }, reserve = { allowed: true, event_id: "ev1", remaining: 4 } } = {}) {
  const sb = {
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("no") }) },
    rpc: async (name) => (name === "reserve_usage" ? { data: [reserve], error: null } : { data: true, error: null }),
    from: (t) => { assert.equal(t, "recommendation_history"); return store.table; },
  };
  A.deps.createSupabase = () => sb;
  return sb;
}

const input = { lang: "ko", libCode: "141628", ageGroup: "20s", gender: "male", genres: ["novel", "history"], liked: ["9788937462788"], saveHistory: true };
const out = {
  items: [
    { isbn13: "9788936433598", title: "채식주의자", author: "한강", reason: "절제된 문장 <b>굵게</b>", available: "Y" },
    { isbn13: "9791161571188", title: "불편한 편의점", author: "김호연", reason: "따뜻한 이야기예요.", available: "N" },
    { isbn13: "9788936434120", title: "소년이 온다", author: "한강", reason: "역사 속 시선", available: null },
  ],
  liked: [{ isbn13: "9788937462788", title: "노인과 바다", author: "어니스트 헤밍웨이" }],
};
const row = (n, userId = "u1", extra = {}) => ({ id: uuid(n), user_id: userId, created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(), lang: "ko", lib_code: "141628", age_group: "20s", gender: "male", genres: ["novel"], liked: [], items: [{ isbn13: "9788936433598", title: "채식주의자", author: "한강", reason: "이유", available: "Y" }], ...extra });

// ═══ 저장 행 만들기 ═══
test("buildRow: user_id는 인자(로그인 정보)에서만, 글자 수 제한·태그 제거, 표지 등 모르는 칸은 버려요", () => {
  const big = { ...out, items: Array.from({ length: 12 }, (_, i) => ({ isbn13: "97890000" + (10000 + i), title: "제목".repeat(60), author: "저자".repeat(40), reason: "이유".repeat(400) + "<script>", available: "Y", bookImageURL: "https://img/x.jpg", extra: "x" })) };
  const r = history.buildRow("u1", { ...input, user_id: "attacker", memo: "x" }, big);
  assert.equal(r.user_id, "u1");
  assert.deepEqual(Object.keys(r).sort(), ["age_group", "gender", "genres", "items", "lang", "lib_code", "liked", "mode", "user_id"]);
  assert.equal(r.items.length, 8, "최대 8권");
  for (const it of r.items) {
    assert.ok(it.title.length <= 80 && it.author.length <= 40 && it.reason.length <= 300);
    assert.ok(!it.reason.includes("<") && !("bookImageURL" in it) && !("extra" in it));
  }
  assert.deepEqual(Object.keys(r.items[0]).sort(), ["author", "available", "isbn13", "reason", "title"]);
  const small = history.buildRow("u1", input, out);
  assert.deepEqual(small.liked, [{ isbn13: "9788937462788", title: "노인과 바다", author: "어니스트 헤밍웨이" }]);
  assert.equal(small.items[2].available, null);
  assert.equal(history.buildRow("u1", { ...input, lang: "fr" }, out).lang, "ko");
});

test("save: 저장하고 최근 30건만 남겨요 (다른 사람 기록은 그대로)", async () => {
  const mine = Array.from({ length: 33 }, (_, i) => row(i + 1));
  const others = Array.from({ length: 5 }, (_, i) => row(500 + i, "u2"));
  const store = makeStore([...mine, ...others]);
  const sb = fakeSupabase(store);
  assert.equal(await history.save(sb, "u1", input, out), uuid(1001), "새 기록의 id를 돌려줘요");
  const myRows = store.rows.filter((r) => r.user_id === "u1");
  assert.equal(myRows.length, 30, "내 기록은 30건");
  assert.equal(store.rows.filter((r) => r.user_id === "u2").length, 5, "다른 사람 기록은 안 건드려요");
  assert.ok(myRows.some((r) => r.id === uuid(1001)), "방금 저장한 기록은 남아요");
  assert.ok(!myRows.some((r) => r.id === uuid(1)), "가장 오래된 기록이 지워져요");
  assert.equal(store.log.find((l) => l[0] === "insert")[1].user_id, "u1");
});

test("save: DB 저장이 실패하면 null (예외를 밖으로 내보내지 않아요)", async () => {
  const store = makeStore(); store.failInsert = true;
  const errLog = console.error; console.error = () => {};
  try { assert.equal(await history.save(fakeSupabase(store), "u1", input, out), null); } finally { console.error = errLog; }
});

// ═══ 추천 → 기록 연결 ═══
const books = ["봄날의 기록", "여름밤 이야기", "가을 편지", "겨울 바다", "새벽 기차", "낮은 산"].map((t, i) => ({ isbn13: "97890000" + (10000 + i), title: t, author: "작가" + String.fromCharCode(65 + i), classNo: "813.7", addCode: "0", rank: i }));
function wirePipeline() {
  pipeline.deps.library = {
    getBook: async (i) => ({ isbn13: i, title: "노인과 바다", author: "어니스트 헤밍웨이" }),
    maniaRecs: async () => [], popular: async () => books, recent: async () => [], availability: async () => ({ has: true, loan: true }),
  };
  pipeline.deps.claude = { recommend: async (p) => {
    const lines = p.user.split(/\r?\n/);
    const recs = [1, 2, 3, 4].map((id) => ({ id, title: lines.find((l) => l.startsWith(id + "|")).split("|")[1], reason: "추천 이유 " + id }));
    return { data: { recommendations: recs }, usage: { input: 1, output: 1 } };
  } };
}
const recReq = (body) => ({ method: "POST", headers: { "content-type": "application/json", ...ORIGIN }, body });
const recBody = { lang: "ko", libCode: "141628", ageGroup: "20s", gender: "male", genres: ["novel"], liked: ["9788937462788"] };

test("POST /api/recommend: 성공하면 기록을 남기고(historySaved), 끄면 남기지 않아요", async () => {
  wirePipeline();
  let store = makeStore(); fakeSupabase(store);
  let res = makeRes(); await recommendHandler(recReq(recBody), res);
  assert.equal(res.code, 200);
  assert.equal(json(res).historySaved, true);
  assert.equal(json(res).historyId, store.rows[0].id, "기록 id를 화면에 알려 줘요 (서재에 담을 때 써요)");
  assert.equal(store.rows.length, 1);
  const saved = store.rows[0];
  assert.equal(saved.user_id, "u1");
  assert.equal(saved.items.length, 4);
  assert.equal(saved.items[0].title, "봄날의 기록", "제목은 서버(정보나루) 값");
  assert.equal(saved.items[0].available, "Y");
  assert.deepEqual(saved.liked, [{ isbn13: "9788937462788", title: "노인과 바다", author: "어니스트 헤밍웨이" }]);
  assert.ok(!("memo" in saved));

  store = makeStore(); fakeSupabase(store);
  res = makeRes(); await recommendHandler(recReq({ ...recBody, saveHistory: false }), res);
  assert.equal(res.code, 200); assert.equal(json(res).historySaved, false);
  assert.equal(store.rows.length, 0, "끄면 저장 안 해요");
});

test("POST /api/recommend: 기록 저장이 실패해도 추천 결과는 그대로 (historySaved=false)", async () => {
  wirePipeline();
  const store = makeStore(); store.failInsert = true; fakeSupabase(store);
  const errLog = console.error; console.error = () => {};
  const res = makeRes();
  try { await recommendHandler(recReq(recBody), res); } finally { console.error = errLog; }
  assert.equal(res.code, 200);
  const b = json(res);
  assert.equal(b.ok, true); assert.equal(b.items.length, 4); assert.equal(b.historySaved, false);
});

// ═══ /api/history ═══
const gReq = (query = {}) => ({ method: "GET", headers: {}, query });
const dReq = (query = {}, extra = ORIGIN) => ({ method: "DELETE", headers: { ...extra }, query });

test("GET /api/history: 내 기록만 최신순 최대 30건, 도서관 이름 포함", async () => {
  const store = makeStore([...Array.from({ length: 35 }, (_, i) => row(i + 1)), ...Array.from({ length: 3 }, (_, i) => row(900 + i, "u2")), row(700, "u1", { lib_code: "999999" })]);
  fakeSupabase(store);
  const res = makeRes(); await historyHandler(gReq(), res);
  assert.equal(res.code, 200);
  const list = json(res).records;
  assert.equal(list.length, 30);
  assert.ok(list.every((r, i) => i === 0 || list[i - 1].createdAt >= r.createdAt), "최신순");
  assert.ok(!list.some((r) => [900, 901, 902].map(uuid).includes(r.id)), "다른 사람 기록 없음");
  const first = list.find((r) => r.id === uuid(35));
  assert.deepEqual([first.libName, first.libSido, first.libGu], ["성남시 위례도서관", "경기", "성남시"]);
  assert.equal(res.headers["cache-control"], "no-store");
  const gone = list.find((r) => r.id === uuid(700));
  assert.equal(gone.libCode, null, "스냅샷에서 사라진 도서관은 null");
});

test("GET /api/history?id=: 내 기록 한 건, 남의 기록·없는 기록은 404, 이상한 id는 DB 조회 없이 400", async () => {
  const store = makeStore([row(1), row(2, "u2")]);
  fakeSupabase(store);
  let res = makeRes(); await historyHandler(gReq({ id: uuid(1) }), res);
  assert.equal(res.code, 200); assert.equal(json(res).record.id, uuid(1));
  res = makeRes(); await historyHandler(gReq({ id: uuid(2) }), res);
  assert.equal(res.code, 404, "다른 사람의 기록은 없는 것처럼");
  res = makeRes(); await historyHandler(gReq({ id: uuid(77) }), res); assert.equal(res.code, 404);
  for (const bad of ["abc", "1; drop table", "../x", uuid(1) + "x", ["a", "b"]]) {
    res = makeRes(); await historyHandler(gReq({ id: bad }), res);
    assert.equal(res.code, 400, JSON.stringify(bad));
  }
});

test("DELETE /api/history: 한 건·전체 삭제는 내 기록에만 적용돼요", async () => {
  let store = makeStore([row(1), row(2), row(3, "u2")]);
  fakeSupabase(store);
  let res = makeRes(); await historyHandler(dReq({ id: uuid(1) }), res);
  assert.deepEqual(json(res), { ok: true });
  assert.deepEqual(store.rows.map((r) => r.id).sort(), [uuid(2), uuid(3)]);
  // 남의 기록 id로 삭제를 시도해도 아무것도 지워지지 않아요
  res = makeRes(); await historyHandler(dReq({ id: uuid(3) }), res);
  assert.ok(store.rows.some((r) => r.id === uuid(3)), "다른 사람 기록은 그대로");
  // 전체 삭제: 내 것만
  store = makeStore([row(1), row(2), row(3, "u2")]); fakeSupabase(store);
  res = makeRes(); await historyHandler(dReq(), res);
  assert.deepEqual(store.rows.map((r) => r.id), [uuid(3)]);
});

test("/api/history: 로그인 안 함 401, 다른 사이트 DELETE 403, 허용 안 된 방식 405", async () => {
  fakeSupabase(makeStore([row(1)]), { user: null });
  let res = makeRes(); await historyHandler(gReq(), res); assert.equal(res.code, 401);
  res = makeRes(); await historyHandler(dReq(), res); assert.equal(res.code, 401);
  const store = makeStore([row(1)]); fakeSupabase(store);
  res = makeRes(); await historyHandler(dReq({}, { origin: "https://evil.test" }), res); assert.equal(res.code, 403);
  res = makeRes(); await historyHandler(dReq({}, {}), res); assert.equal(res.code, 403, "Origin 없는 DELETE도 거절");
  assert.equal(store.rows.length, 1, "거절된 요청은 아무것도 지우지 않아요");
  for (const m of ["POST", "PUT", "PATCH"]) { res = makeRes(); await historyHandler({ method: m, headers: { ...ORIGIN, "content-type": "application/json" }, query: {}, body: {} }, res); assert.equal(res.code, 405, m); }
});

test("toClient: 깨진 값이 와도 안전한 모양으로 (title 등은 문자열, 8권·3권 제한)", () => {
  const c = history.toClient({ id: uuid(1), created_at: "2026-10-27T00:00:00Z", lang: "xx", lib_code: "141628", age_group: "20s", gender: "male", genres: "novel", liked: "x", items: Array.from({ length: 12 }, (_, i) => ({ isbn13: i, title: null, author: undefined, reason: { a: 1 }, available: "maybe" })) });
  assert.equal(c.lang, "ko"); assert.deepEqual(c.genres, []); assert.deepEqual(c.liked, []);
  assert.equal(c.items.length, 8);
  assert.ok(c.items.every((it) => typeof it.title === "string" && typeof it.reason === "string" && it.available === null));
  assert.equal(history.toClient(null), null);
});
