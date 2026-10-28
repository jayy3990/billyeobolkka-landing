// 대회 체험(임시 계정) 시험. Supabase는 가짜예요 (실제 계정 생성 없음). 실행: npm test
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class {};

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SITE_URL = "https://example.test";
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_dummy";

const A = require("../api/_lib/auth");
const dispatch = require("../api/auth/[action]");
const demoLib = require("../api/_lib/demo");

const setMode = (v) => { if (v === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = v; };

function makeRes() {
  const headers = {};
  const res = { code: 200, body: undefined, headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; }, getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { res.code = c; return res; }, send(b) { res.body = b; return res; }, end(b) { res.body = b; return res; } };
  return res;
}
const JSONH = { "content-type": "application/json", origin: "https://example.test" };
const call = async (action, { method = "POST", body = {}, headers = JSONH } = {}) => { const res = makeRes(); await dispatch({ method, query: { action }, headers, body }, res); return res; };

function fake({ user = null, anonError = null } = {}) {
  const log = { anon: [], signInPw: 0, rpc: [] };
  const sb = {
    auth: {
      getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("no") }),
      signInAnonymously: async (args) => { log.anon.push(args); return { data: {}, error: anonError }; },
      signInWithPassword: async () => { log.signInPw++; return { data: {}, error: null }; },
    },
    rpc: async (name, args) => { log.rpc.push([name, args && args.p_kind]); return { data: [{ allowed: true, event_id: "e", remaining: 1 }], error: null }; },
  };
  A.deps.createSupabase = () => sb;
  return log;
}

test("DEMO_MODE: on/true/1만 켜지고, 비어 있거나 다른 값이면 꺼져 있어요", () => {
  for (const v of ["on", "ON", "true", "1", " On "]) { setMode(v); assert.equal(demoLib.enabled(), true, v); }
  for (const v of [undefined, "", "off", "false", "0", "yes"]) { setMode(v); assert.equal(demoLib.enabled(), false, String(v)); }
  setMode(undefined);
});

test("demo: 꺼져 있으면 404이고 계정을 만들지 않아요", async () => {
  setMode(undefined);
  const log = fake();
  const res = await call("demo", { body: { captchaToken: "t" } });
  assert.equal(res.code, 404);
  assert.equal(log.anon.length, 0);
});

test("demo: 사람 확인 토큰이 없으면 400 (계정을 만들지 않아요)", async () => {
  setMode("on");
  try {
    const log = fake();
    const res = await call("demo", { body: {} });
    assert.equal(res.code, 400);
    assert.equal(JSON.parse(res.body).error, "captcha");
    assert.equal(log.anon.length, 0);
  } finally { setMode(undefined); }
});

test("demo: 성공하면 임시 계정을 만들고(사람 확인 토큰 전달) 메인으로 이동. 비밀번호 로그인은 쓰지 않아요", async () => {
  setMode("on");
  try {
    const log = fake();
    let res = await call("demo", { body: { captchaToken: "tok", lang: "ko", email: "attacker@evil.test", password: "x" } });
    assert.equal(res.code, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, redirect: "/" });
    assert.equal(log.anon.length, 1);
    assert.deepEqual(log.anon[0], { options: { captchaToken: "tok" } }, "요청이 보낸 이메일·비밀번호는 쓰지 않아요");
    assert.equal(log.signInPw, 0);
    res = await call("demo", { body: { captchaToken: "tok", lang: "en" } });
    assert.equal(JSON.parse(res.body).redirect, "/en");
  } finally { setMode(undefined); }
});

test("demo: 실패 시 원문 없이 오류 코드만, 사람 확인 실패·요청 과다·익명 로그인 꺼짐을 구분해요", async () => {
  setMode("on");
  const errLog = console.error; console.error = () => {};
  try {
    fake({ anonError: { status: 422, code: "anonymous_provider_disabled", message: "Anonymous sign-ins are disabled secret-detail" } });
    let res = await call("demo", { body: { captchaToken: "tok" } });
    assert.equal(res.code, 500);
    assert.ok(!res.body.includes("secret-detail") && !/anonymous/i.test(res.body));
    fake({ anonError: { status: 400, code: "captcha_failed", message: "captcha verification process failed" } });
    res = await call("demo", { body: { captchaToken: "tok" } });
    assert.equal(res.code, 400); assert.equal(JSON.parse(res.body).error, "captcha");
    fake({ anonError: { status: 429, code: "over_request_rate_limit", message: "rate" } });
    res = await call("demo", { body: { captchaToken: "tok" } });
    assert.equal(res.code, 429);
  } finally { console.error = errLog; setMode(undefined); }
});

test("demo: 다른 사이트에서 온 요청·JSON 아님·GET은 거절", async () => {
  setMode("on");
  try {
    const log = fake();
    assert.equal((await call("demo", { headers: { ...JSONH, origin: "https://evil.test" }, body: { captchaToken: "t" } })).code, 403);
    assert.equal((await call("demo", { headers: { origin: "https://example.test", "content-type": "text/plain" }, body: { captchaToken: "t" } })).code, 415);
    assert.equal((await call("demo", { method: "GET" })).code, 405);
    assert.equal(log.anon.length, 0);
  } finally { setMode(undefined); }
});

test("공용 체험 계정 기능은 없어요: demo-reset 동작은 404", async () => {
  fake({ user: { id: "u1", email: "a@b.co" } });
  assert.equal((await call("demo-reset")).code, 404);
});

test("me: 임시(익명) 계정이면 anonymous=true, 일반 계정이면 false", async () => {
  const cookie = { cookie: "sb-x-auth-token=abc" };
  fake({ user: { id: "anon-1", email: "", is_anonymous: true } });
  let res = await call("me", { method: "GET", headers: cookie });
  assert.equal(JSON.parse(res.body).anonymous, true);
  fake({ user: { id: "u2", email: "someone@example.test", is_anonymous: false } });
  res = await call("me", { method: "GET", headers: cookie });
  assert.equal(JSON.parse(res.body).anonymous, false);
  fake({ user: { id: "u3", email: "x@y.co" } }); // 값이 없으면 일반 계정으로 봐요
  res = await call("me", { method: "GET", headers: cookie });
  assert.equal(JSON.parse(res.body).anonymous, false);
});

test("메일로 받기: 임시 계정은 400으로 거절되고 횟수도 쓰지 않아요", async () => {
  const log = fake({ user: { id: "anon-1", email: "", is_anonymous: true } });
  let res = await call("../mail", {}); // 다른 묶음 주소는 이 묶음에서 404
  assert.equal(res.code, 404);
  const mail = require("../api/mail/[action]");
  res = makeRes();
  await mail({ method: "POST", query: { action: "send" }, headers: JSONH, body: { historyId: "00000000-0000-4000-8000-000000000001" } }, res);
  assert.equal(res.code, 400); assert.equal(JSON.parse(res.body).error, "email");
  assert.ok(!log.rpc.some((r) => r[0] === "reserve_usage"), "횟수를 쓰지 않아요");
  // 이메일이 있어도 익명 표시가 있으면 거절
  const log2 = fake({ user: { id: "anon-2", email: "x@y.co", is_anonymous: true } });
  res = makeRes();
  await mail({ method: "POST", query: { action: "send" }, headers: JSONH, body: { historyId: "00000000-0000-4000-8000-000000000001" } }, res);
  assert.equal(res.code, 400);
  assert.ok(!log2.rpc.some((r) => r[0] === "reserve_usage"));
});
