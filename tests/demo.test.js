// 대회 체험 계정 시험. Supabase는 가짜예요 (실제 로그인·삭제 없음). 실행: npm test
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class {};

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SITE_URL = "https://example.test";
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_dummy";

const A = require("../api/_lib/auth");
const dispatch = require("../api/auth/[action]");

const DEMO_EMAIL = "Demo.User@Example.test";
const DEMO_PASSWORD = "Sup3r-Secret-Demo-Pw";
const setDemo = (on) => {
  if (on) { process.env.DEMO_EMAIL = DEMO_EMAIL; process.env.DEMO_PASSWORD = DEMO_PASSWORD; }
  else { delete process.env.DEMO_EMAIL; delete process.env.DEMO_PASSWORD; }
};

function makeRes() {
  const headers = {};
  const res = { code: 200, body: undefined, headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { res.code = c; return res; }, send(b) { res.body = b; return res; }, end(b) { res.body = b; return res; } };
  return res;
}
const JSONH = { "content-type": "application/json", origin: "https://example.test" };
const call = async (action, { method = "POST", body = {}, headers = JSONH } = {}) => { const res = makeRes(); await dispatch({ method, query: { action }, headers, body }, res); return res; };

function fake({ user = { id: "u1", email: "someone@example.test" }, signInError = null } = {}) {
  const log = { signIn: [], deletes: [] };
  const sb = {
    auth: {
      getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("no") }),
      signInWithPassword: async (args) => { log.signIn.push(args); return { data: {}, error: signInError }; },
    },
    from: (t) => ({ delete: () => ({ eq: async (c, v) => { log.deletes.push([t, c, v]); return { error: null }; } }) }),
  };
  A.deps.createSupabase = () => sb;
  return log;
}

test("demo: 환경변수가 없으면 기능이 꺼져 있어요 (404, 로그인 시도 안 함)", async () => {
  setDemo(false);
  const log = fake();
  const res = await call("demo", { body: { captchaToken: "t" } });
  assert.equal(res.code, 404);
  assert.equal(log.signIn.length, 0);
});

test("demo: 사람 확인 토큰이 없으면 400 (로그인 시도 안 함)", async () => {
  setDemo(true);
  try {
    const log = fake();
    const res = await call("demo", { body: {} });
    assert.equal(res.code, 400);
    assert.equal(JSON.parse(res.body).error, "captcha");
    assert.equal(log.signIn.length, 0);
  } finally { setDemo(false); }
});

test("demo: 성공하면 서버가 환경변수의 계정으로 로그인하고, 응답에는 이메일·비밀번호가 없어요", async () => {
  setDemo(true);
  try {
    const log = fake();
    let res = await call("demo", { body: { captchaToken: "tok", lang: "ko", email: "attacker@evil.test", password: "x" } });
    assert.equal(res.code, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, redirect: "/recommend" });
    assert.equal(log.signIn.length, 1);
    assert.equal(log.signIn[0].email, DEMO_EMAIL.toLowerCase(), "요청이 보낸 이메일이 아니라 환경변수의 계정");
    assert.equal(log.signIn[0].password, DEMO_PASSWORD);
    assert.equal(log.signIn[0].options.captchaToken, "tok");
    assert.ok(!res.body.includes(DEMO_PASSWORD) && !res.body.toLowerCase().includes("demo.user"));
    res = await call("demo", { body: { captchaToken: "tok", lang: "en" } });
    assert.equal(JSON.parse(res.body).redirect, "/en/recommend");
  } finally { setDemo(false); }
});

test("demo: 로그인 실패 시 계정 정보 없이 오류 코드만, 사람 확인 실패·요청 과다는 구분해요", async () => {
  setDemo(true);
  const errLog = console.error; console.error = () => {};
  try {
    fake({ signInError: { status: 400, code: "invalid_credentials", message: DEMO_PASSWORD } });
    let res = await call("demo", { body: { captchaToken: "tok" } });
    assert.equal(res.code, 500);
    assert.ok(!res.body.includes(DEMO_PASSWORD));
    fake({ signInError: { status: 400, code: "captcha_failed", message: "captcha verification process failed" } });
    res = await call("demo", { body: { captchaToken: "tok" } });
    assert.equal(res.code, 400); assert.equal(JSON.parse(res.body).error, "captcha");
    fake({ signInError: { status: 429, code: "over_request_rate_limit", message: "rate" } });
    res = await call("demo", { body: { captchaToken: "tok" } });
    assert.equal(res.code, 429);
  } finally { console.error = errLog; setDemo(false); }
});

test("demo: 다른 사이트에서 온 요청·JSON 아님·GET은 거절", async () => {
  setDemo(true);
  try {
    const log = fake();
    assert.equal((await call("demo", { headers: { ...JSONH, origin: "https://evil.test" }, body: { captchaToken: "t" } })).code, 403);
    assert.equal((await call("demo", { headers: { origin: "https://example.test", "content-type": "text/plain" }, body: { captchaToken: "t" } })).code, 415);
    assert.equal((await call("demo", { method: "GET" })).code, 405);
    assert.equal(log.signIn.length, 0);
  } finally { setDemo(false); }
});

test("demo-reset: 체험 계정만 자기 서재·기록·설정을 지울 수 있어요 (일반 계정은 403, 로그인 안 하면 401)", async () => {
  setDemo(true);
  try {
    let log = fake({ user: { id: "demo-id", email: DEMO_EMAIL } });
    let res = await call("demo-reset");
    assert.equal(res.code, 200);
    assert.deepEqual(log.deletes, [["user_library", "user_id", "demo-id"], ["recommendation_history", "user_id", "demo-id"], ["user_preferences", "user_id", "demo-id"]]);

    log = fake({ user: { id: "u2", email: "someone@example.test" } });
    res = await call("demo-reset");
    assert.equal(res.code, 403); assert.equal(log.deletes.length, 0, "일반 계정은 아무것도 못 지워요");

    log = fake({ user: null });
    res = await call("demo-reset");
    assert.equal(res.code, 401); assert.equal(log.deletes.length, 0);

    assert.equal((await call("demo-reset", { headers: { ...JSONH, origin: "https://evil.test" } })).code, 403);
  } finally { setDemo(false); }
});

test("demo-reset: 체험 기능이 꺼져 있으면 누구도 지울 수 없어요 (이메일이 같아도 403)", async () => {
  setDemo(false);
  const log = fake({ user: { id: "demo-id", email: DEMO_EMAIL } });
  const res = await call("demo-reset");
  assert.equal(res.code, 403); assert.equal(log.deletes.length, 0);
});

test("me: 체험 계정이면 demo=true, 아니면 false (쿠키가 있을 때만 확인)", async () => {
  setDemo(true);
  try {
    const cookie = { cookie: "sb-x-auth-token=abc" };
    fake({ user: { id: "demo-id", email: DEMO_EMAIL.toUpperCase() } });
    let res = await call("me", { method: "GET", headers: cookie });
    assert.deepEqual(JSON.parse(res.body).demo, true);
    fake({ user: { id: "u2", email: "someone@example.test" } });
    res = await call("me", { method: "GET", headers: cookie });
    assert.deepEqual(JSON.parse(res.body).demo, false);
  } finally { setDemo(false); }
});
