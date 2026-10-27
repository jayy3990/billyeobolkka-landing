// 메일로 받기 시험. Supabase·Resend는 모두 가짜예요 (실제 발송 없음). 실행: npm test
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class {};

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SITE_URL = "https://example.test";
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_dummy";
process.env.RESEND_API_KEY = "re_SECRET_TEST_KEY_123";
delete process.env.MAIL_FROM_EMAIL;

const A = require("../api/_lib/auth");
const libs = require("../api/_lib/libs");
const mail = require("../api/_lib/mail");
const dispatcher = require("../api/mail/[action]");

libs.reset({ byCode: new Map([["141628", { c: "141628", n: "성남시 위례도서관", s: "경기", g: "성남시" }]]), count: 1 });

function makeRes() {
  const headers = {};
  const res = { code: 200, body: undefined, headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { res.code = c; return res; }, send(b) { res.body = b; return res; }, end(b) { res.body = b; return res; } };
  return res;
}
const json = (res) => JSON.parse(res.body);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JSONH = { "content-type": "application/json", origin: "https://example.test" };
const req = (body, headers = JSONH, action = "send", method = "POST") => ({ method, headers, body, query: { action } });

const record = (n, extra = {}) => ({
  id: uuid(n), user_id: "u1", created_at: "2026-10-27T01:00:00Z", lang: "ko", lib_code: "141628", age_group: "20s", gender: "male", genres: ["novel"], liked: [],
  items: [
    { isbn13: "9788936433598", title: "채식주의자", author: "한강", reason: "절제된 문장이 인상적이에요.", available: "Y" },
    { isbn13: "9791161571188", title: "불편한 편의점", author: "김호연", reason: "따뜻한 이야기예요.", available: "N" },
    { isbn13: "9788936434120", title: "소년이 온다", author: "한강", reason: "역사 속 시선", available: null },
  ], ...extra,
});

function setup({ rows = [record(1)], user = { id: "u1", email: "reader@example.test" }, allowed = true, sendOk = true } = {}) {
  const rpc = [], sent = [];
  const sb = {
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("no") }) },
    rpc: async (name, args) => { rpc.push([name, args && args.p_kind]); return { data: name === "reserve_usage" ? [{ allowed, event_id: allowed ? "ev1" : null, remaining: allowed ? 4 : 0 }] : true, error: null }; },
    from: (t) => {
      assert.equal(t, "recommendation_history");
      return { select: () => { const f = []; const api = { eq: (c, v) => { f.push((r) => r[c] === v); return api; }, maybeSingle: async () => ({ data: rows.find((r) => f.every((g) => g(r))) || null, error: null }) }; return api; } };
    },
  };
  A.deps.createSupabase = () => sb;
  process.env.RESEND_API_KEY = "re_SECRET_TEST_KEY_123";
  mail.deps.fetch = async (url, opt) => { sent.push({ url, opt, body: JSON.parse(opt.body) }); return { ok: sendOk, status: sendOk ? 200 : 422 }; };
  return { rpc, sent };
}
const call = async (r) => { const res = makeRes(); await dispatcher(r, res); return res; };

test("buildEmail: 제목·본문의 특수문자는 이스케이프되고 제목의 줄바꿈은 사라져요", () => {
  const rec = { lang: "ko", libName: "도서관\r\nBcc: evil@x.test", createdAt: "2026-10-27T01:00:00Z", items: [{ title: "<script>alert(1)</script>", author: "a\"b", reason: "<img src=x onerror=1>", available: "Y" }] };
  const m = mail.buildEmail(rec);
  assert.ok(!/[\r\n]/.test(m.subject), "제목에 줄바꿈 없음");
  assert.ok(!m.html.includes("<script>") && !m.html.includes("<img"), "태그가 그대로 들어가지 않아요");
  assert.ok(m.html.includes("&lt;script&gt;"));
  assert.match(m.text, /1\. <script>/, "텍스트 본문은 그대로(HTML이 아니라서)");
  assert.ok(m.html.includes("https://example.test/history"));
});

test("buildEmail: 영어 기록은 영어로, 대출 상태 3가지 표시", () => {
  const m = mail.buildEmail({ ...record(1), libName: "Wirye Library", lang: "en", createdAt: "2026-10-27T01:00:00Z" });
  assert.match(m.subject, /Billyeobolkka/);
  assert.match(m.html, /Available to borrow/); assert.match(m.html, /On loan/); assert.match(m.html, /Availability unknown/);
  assert.ok(m.html.includes("https://example.test/en/history"));
});

test("maskEmail", () => {
  assert.equal(mail.maskEmail("reader@example.test"), "r***@example.test");
  assert.equal(mail.maskEmail(""), ""); assert.equal(mail.maskEmail("abc"), "");
});

test("send: 내 로그인 이메일로만 보내고(body.to 무시), 키는 헤더에만 쓰며 응답엔 가린 주소만 나가요", async () => {
  const { sent, rpc } = setup();
  const res = await call(req({ historyId: uuid(1), to: "victim@evil.test", email: "victim@evil.test" }));
  assert.equal(res.code, 200);
  const b = json(res);
  assert.deepEqual(b, { ok: true, to: "r***@example.test", remaining: 4 });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ["reader@example.test"]);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].opt.headers.Authorization, "Bearer re_SECRET_TEST_KEY_123");
  assert.ok(!res.body.includes("re_SECRET"), "응답에 키 없음");
  assert.ok(sent[0].body.subject.includes("성남시 위례도서관"));
  assert.ok(sent[0].body.html.includes("채식주의자") && sent[0].body.text.includes("채식주의자"));
  assert.deepEqual(rpc.filter((r) => r[0] === "reserve_usage"), [["reserve_usage", "mail"]]);
});

test("send: 남의 기록·없는 기록은 404 (메일 안 나가고 횟수 되돌림)", async () => {
  const { sent, rpc } = setup({ rows: [record(1, { user_id: "u2" })] });
  let res = await call(req({ historyId: uuid(1) })); assert.equal(res.code, 404);
  res = await call(req({ historyId: uuid(9) })); assert.equal(res.code, 404);
  assert.equal(sent.length, 0);
  assert.equal(rpc.filter((r) => r[0] === "refund_usage").length, 2);
});

test("send: 발송 실패(502)면 횟수를 되돌려요, 오류 본문엔 키가 없어요", async () => {
  const errLog = console.error; console.error = () => {};
  try {
    const ctx = setup({ sendOk: false });
    let res = await call(req({ historyId: uuid(1) }));
    assert.equal(res.code, 502); assert.equal(json(res).error, "send"); assert.ok(!res.body.includes("re_SECRET"));
    assert.equal(ctx.rpc.filter((r) => r[0] === "refund_usage").length, 1);
  } finally { console.error = errLog; process.env.RESEND_API_KEY = "re_SECRET_TEST_KEY_123"; }
});

test("send: 하루 5통을 넘으면 429이고 메일은 나가지 않아요", async () => {
  const { sent } = setup({ allowed: false });
  const res = await call(req({ historyId: uuid(1) }));
  assert.equal(res.code, 429); assert.equal(json(res).error, "limit"); assert.equal(sent.length, 0);
});

test("send: 로그인 안 함 401, 다른 사이트/JSON 아님 403·415, 잘못된 id 400, 허용 안 된 방식 405, 모르는 동작 404", async () => {
  let ctx = setup({ user: null });
  assert.equal((await call(req({ historyId: uuid(1) }))).code, 401);
  ctx = setup();
  assert.equal((await call(req({ historyId: uuid(1) }, { ...JSONH, origin: "https://evil.test" }))).code, 403);
  assert.equal((await call(req({ historyId: uuid(1) }, { origin: "https://example.test", "content-type": "text/plain" }))).code, 415);
  for (const bad of [{}, { historyId: "x" }, { historyId: uuid(1) + "x" }, { historyId: ["a"] }]) assert.equal((await call(req(bad))).code, 400, JSON.stringify(bad));
  assert.equal((await call(req({ historyId: uuid(1) }, JSONH, "send", "GET"))).code, 405);
  assert.equal((await call(req({ historyId: uuid(1) }, JSONH, "nope"))).code, 404);
  assert.equal((await call(req({ historyId: uuid(1) }, JSONH, "__proto__"))).code, 404);
  assert.equal(ctx.sent.length, 0, "거절된 요청은 메일을 보내지 않아요");
});

test("발신 주소: MAIL_FROM_EMAIL → CONTACT_FROM_EMAIL → 시험용 기본값 순서", async () => {
  const keep = { m: process.env.MAIL_FROM_EMAIL, c: process.env.CONTACT_FROM_EMAIL };
  try {
    delete process.env.MAIL_FROM_EMAIL; delete process.env.CONTACT_FROM_EMAIL;
    let ctx = setup(); await call(req({ historyId: uuid(1) }));
    assert.match(ctx.sent[0].body.from, /onboarding@resend\.dev/);
    process.env.CONTACT_FROM_EMAIL = "빌려볼까 <c@example.test>";
    ctx = setup(); await call(req({ historyId: uuid(1) }));
    assert.match(ctx.sent[0].body.from, /c@example\.test/);
    process.env.MAIL_FROM_EMAIL = "빌려볼까 <m@example.test>";
    ctx = setup(); await call(req({ historyId: uuid(1) }));
    assert.match(ctx.sent[0].body.from, /m@example\.test/);
  } finally {
    if (keep.m === undefined) delete process.env.MAIL_FROM_EMAIL; else process.env.MAIL_FROM_EMAIL = keep.m;
    if (keep.c === undefined) delete process.env.CONTACT_FROM_EMAIL; else process.env.CONTACT_FROM_EMAIL = keep.c;
  }
});
