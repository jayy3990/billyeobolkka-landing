// 인증 보안 규칙 시험. 실행: npm test   (가짜 Supabase를 써서 실제 계정·메일 없이 확인해요)
// Node 20(로컬)에는 내장 WebSocket이 없어서 시험에서만 빈 껍데기를 채워 둬요. 배포 서버(Node 24)에는 이미 있어요.
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = class {};

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SITE_URL = "https://example.test";
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_dummy";

const A = require("../api/_lib/auth");
const login = require("../api/_lib/handlers/login");
const signup = require("../api/_lib/handlers/signup");
const forgot = require("../api/_lib/handlers/forgot");
const logout = require("../api/_lib/handlers/logout");
const confirm = require("../api/_lib/handlers/confirm");
const update = require("../api/_lib/handlers/update-password");
const me = require("../api/_lib/handlers/me");
const page = require("../api/page");

const realCreateSupabase = A.deps.createSupabase; // 실제 @supabase/ssr 코드 (아래 마지막 시험에서 써요)

// ── 도우미 ──
function makeRes() {
  const headers = {};
  const res = {
    code: 200, body: undefined,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(c) { res.code = c; return res; },
    send(b) { res.body = b; return res; },
    end(b) { res.body = b; return res; },
    headers,
  };
  return res;
}
const json = (res) => JSON.parse(res.body);
const post = (body, extra = {}) => ({
  method: "POST", body,
  headers: { "content-type": "application/json", origin: "https://example.test", ...extra },
});
const get = (query, headers = {}) => ({ method: "GET", query, headers });
const authErr = (status, code, message) => Object.assign(new Error(message), { status, code });

function fake(overrides = {}) {
  const calls = [];
  const auth = {
    signInWithPassword: async (a) => (calls.push(["signIn", a]), { error: null }),
    signUp: async (a) => (calls.push(["signUp", a]), { error: null }),
    resetPasswordForEmail: async (e, o) => (calls.push(["reset", e, o]), { error: null }),
    getUser: async () => ({ data: { user: null }, error: authErr(401, "no_session", "auth session missing") }),
    updateUser: async (a) => (calls.push(["update", a]), { error: null }),
    signOut: async (a) => (calls.push(["signOut", a]), { error: null }),
    verifyOtp: async (a) => (calls.push(["verify", a]), { error: null }),
    ...overrides,
  };
  A.deps.createSupabase = () => ({ auth, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) });
  return calls;
}
const user = { data: { user: { id: "u1", email: "a@b.co" } }, error: null };

// ── 안전한 이동 주소 (오픈 리다이렉트 방지) ──
test("safeNext: 우리 사이트 안의 경로만 허용", () => {
  const fb = "/account";
  assert.equal(A.safeNext("/account", fb), "/account");
  assert.equal(A.safeNext("/en/account?x=1", fb), "/en/account?x=1");
  assert.equal(A.safeNext("https://example.test/en/account", fb), "/en/account"); // 우리 사이트 전체 주소는 경로만
  for (const bad of [
    "//evil.com", "https://evil.com", "http://example.test.evil.com/x", "/\\evil.com", "\\\\evil.com",
    "javascript:alert(1)", "/%2F%2Fevil.com", "/%5Cevil.com", "/a/../b", "evil.com", "", null, undefined, 123,
    "/x\r\nSet-Cookie:a=b", "/" + "a".repeat(300), "https://example.test.evil.com/x",
  ]) assert.equal(A.safeNext(bad, fb), fb, `막아야 함: ${String(bad).slice(0, 40)}`);
});

// ── 비밀번호 정책 ──
test("checkPassword: 8자 이상, 영문+숫자", () => {
  assert.equal(A.checkPassword("abcd1234"), null);
  assert.equal(A.checkPassword("Abcdef12"), null);
  for (const bad of ["short1", "abcdefgh", "12345678", "", null, undefined, 12345678, "a1".repeat(40)]) {
    assert.equal(A.checkPassword(bad), "weak", String(bad));
  }
});

// ── 로그인 ──
test("login: 다른 사이트에서 온 요청은 막아요 (CSRF)", async () => {
  fake();
  const res = makeRes();
  await login(post({ email: "a@b.co", password: "x", captchaToken: "t" }, { origin: "https://evil.test" }), res);
  assert.equal(res.code, 403);
});

test("login: 캡차 토큰 없으면 거절", async () => {
  fake();
  const res = makeRes();
  await login(post({ email: "a@b.co", password: "x" }), res);
  assert.equal(res.code, 400);
  assert.equal(json(res).error, "captcha");
});

test("login: 실패 사유(이메일/비밀번호/미인증)를 구분하지 않고, 원문 오류를 안 보여요", async () => {
  const bodies = [];
  for (const e of [
    authErr(400, "invalid_credentials", "Invalid login credentials"),
    authErr(400, "email_not_confirmed", "Email not confirmed"),
    authErr(400, "user_not_found", "User not found secret-detail"),
  ]) {
    fake({ signInWithPassword: async () => ({ error: e }) });
    const res = makeRes();
    await login(post({ email: "a@b.co", password: "pw", captchaToken: "t" }), res);
    assert.equal(res.code, 401);
    assert.ok(!/secret-detail|Invalid login|not confirmed/i.test(res.body), "원문 노출 금지");
    bodies.push(res.body);
  }
  assert.equal(new Set(bodies).size, 1, "모든 실패 응답이 같아야 해요");
  assert.deepEqual(JSON.parse(bodies[0]), { ok: false, error: "credentials" });
});

test("login: 성공 시 안전한 주소로만 이동", async () => {
  fake();
  const cases = [["/en/account", "/en/account"], ["//evil.com", "/account"], ["https://evil.com", "/account"], [undefined, "/account"]];
  for (const [next, expected] of cases) {
    const res = makeRes();
    await login(post({ email: "A@B.co", password: "pw", captchaToken: "t", next }), res);
    assert.equal(json(res).redirect, expected, String(next));
  }
});

// ── 회원가입 ──
test("signup: 비밀번호 규칙·확인 불일치·캡차를 서버에서 검사", async () => {
  const calls = fake();
  const mk = (o) => ({ email: "a@b.co", password: "abcd1234", passwordConfirm: "abcd1234", captchaToken: "t", ...o });
  let res = makeRes(); await signup(post(mk({ password: "short", passwordConfirm: "short" })), res);
  assert.equal(json(res).error, "weak");
  res = makeRes(); await signup(post(mk({ passwordConfirm: "abcd12345" })), res);
  assert.equal(json(res).error, "mismatch");
  res = makeRes(); await signup(post(mk({ email: "bad" })), res);
  assert.equal(json(res).error, "email");
  res = makeRes(); await signup(post(mk({ captchaToken: undefined })), res);
  assert.equal(json(res).error, "captcha");
  assert.equal(calls.length, 0, "검사에 걸리면 Supabase를 부르지 않아요");
});

test("signup: 이미 가입된 이메일이어도 같은 성공 응답 (계정 노출 방지)", async () => {
  fake({ signUp: async () => ({ error: authErr(422, "user_already_exists", "User already registered") }) });
  const res = makeRes();
  await signup(post({ email: "a@b.co", password: "abcd1234", passwordConfirm: "abcd1234", captchaToken: "t" }), res);
  assert.deepEqual(json(res), { ok: true });
  assert.equal(res.code, 200);
});

test("signup: 메일 링크 주소는 SITE_URL 기준, 언어를 함께 저장", async () => {
  const calls = fake();
  const res = makeRes();
  await signup(post({ email: "a@b.co", password: "abcd1234", passwordConfirm: "abcd1234", captchaToken: "t", lang: "en" }), res);
  const [, args] = calls[0];
  assert.equal(args.options.emailRedirectTo, "https://example.test/en/account");
  assert.equal(args.options.data.lang, "en");
  assert.equal(args.options.captchaToken, "t");
});

// ── 비밀번호 찾기 ──
test("forgot: 가입 여부와 상관없이 항상 같은 응답", async () => {
  const bodies = [];
  for (const impl of [
    async () => ({ error: null }),
    async () => ({ error: authErr(400, "user_not_found", "User not found") }),
    async () => ({ error: authErr(500, "unexpected_failure", "boom") }),
  ]) {
    fake({ resetPasswordForEmail: impl });
    const res = makeRes();
    await forgot(post({ email: "a@b.co", captchaToken: "t" }), res);
    assert.equal(res.code, 200);
    bodies.push(res.body);
  }
  assert.equal(new Set(bodies).size, 1);
});

test("forgot: 재설정 링크 주소는 SITE_URL 기준", async () => {
  const calls = fake();
  await forgot(post({ email: "a@b.co", captchaToken: "t", lang: "en" }), makeRes());
  assert.equal(calls[0][2].redirectTo, "https://example.test/en/reset-password");
});

// ── 메일 링크(PKCE 교환) ──
test("confirm: 잘못된 type/토큰 없음은 로그인 화면으로", async () => {
  fake();
  for (const q of [{ type: "magiclink", token_hash: "abc" }, { type: "email" }, { token_hash: "abc" }]) {
    const res = makeRes();
    await confirm(get(q), res);
    assert.equal(res.code, 303);
    assert.equal(res.headers.location, "/login?error=link");
  }
});

test("confirm: 성공하면 안전한 next로 이동, 바깥 주소는 무시", async () => {
  const calls = fake();
  let res = makeRes();
  await confirm(get({ type: "email", token_hash: "abc", next: "https://example.test/en/account" }), res);
  assert.equal(res.headers.location, "/en/account");
  assert.equal(calls[0][1].type, "email");
  res = makeRes();
  await confirm(get({ type: "email", token_hash: "abc", next: "https://evil.com/steal" }), res);
  assert.equal(res.headers.location, "/account");
});

test("confirm: recovery 성공 시에만 재설정 표시 쿠키(httpOnly)를 심어요", async () => {
  fake();
  let res = makeRes();
  await confirm(get({ type: "recovery", token_hash: "abc", next: "/reset-password" }), res);
  const cookie = [].concat(res.headers["set-cookie"] || []).join(";");
  assert.match(cookie, /bb-recovery=1/);
  assert.match(cookie, /HttpOnly/);
  assert.equal(res.headers.location, "/reset-password");
  res = makeRes();
  await confirm(get({ type: "email", token_hash: "abc", next: "/account" }), res);
  assert.ok(!res.headers["set-cookie"], "일반 인증에는 표시 쿠키 없음");
});

test("confirm: 토큰이 틀리면 로그인 화면으로 (원문 오류 없음)", async () => {
  fake({ verifyOtp: async () => ({ error: authErr(403, "otp_expired", "Token has expired or is invalid") }) });
  const res = makeRes();
  await confirm(get({ type: "email", token_hash: "abc", next: "/en/account" }), res);
  assert.equal(res.headers.location, "/en/login?error=link");
});

// ── 새 비밀번호 설정 ──
test("update-password: 로그인 안 했거나 메일 링크로 안 온 사람은 거절", async () => {
  fake(); // 로그인 안 함
  let res = makeRes();
  await update(post({ password: "abcd1234", passwordConfirm: "abcd1234" }, { cookie: "bb-recovery=1" }), res);
  assert.equal(res.code, 401);

  const calls = fake({ getUser: async () => user }); // 로그인은 했지만 표시 쿠키 없음
  res = makeRes();
  await update(post({ password: "abcd1234", passwordConfirm: "abcd1234" }, { cookie: "sb-x-auth-token=1" }), res);
  assert.equal(res.code, 403);
  assert.ok(!calls.some((c) => c[0] === "update"), "비밀번호를 바꾸면 안 돼요");
});

test("update-password: 정상 흐름 + 약한 비밀번호는 서버에서 거절", async () => {
  const calls = fake({ getUser: async () => user });
  let res = makeRes();
  await update(post({ password: "weak", passwordConfirm: "weak" }, { cookie: "bb-recovery=1" }), res);
  assert.equal(json(res).error, "weak");
  res = makeRes();
  await update(post({ password: "abcd1234", passwordConfirm: "abcd1234" }, { cookie: "bb-recovery=1" }), res);
  assert.equal(res.code, 200);
  assert.ok(calls.some((c) => c[0] === "update"));
  assert.ok(calls.some((c) => c[0] === "signOut" && c[1].scope === "others"), "다른 기기 로그아웃");
  assert.match([].concat(res.headers["set-cookie"]).join(";"), /bb-recovery=;.*Max-Age=0/);
});

// ── 로그아웃 / 상태 / 보호 페이지 ──
test("logout: 세션 쿠키를 모두 지워요", async () => {
  fake();
  const res = makeRes();
  await logout(post({}, { cookie: "sb-x-auth-token.0=aaa; sb-x-auth-token.1=bbb; other=1" }), res);
  const c = [].concat(res.headers["set-cookie"]).join("\n");
  assert.match(c, /sb-x-auth-token\.0=; .*Max-Age=0/);
  assert.match(c, /sb-x-auth-token\.1=; .*Max-Age=0/);
  assert.ok(!/other=/.test(c));
});

test("me: 쿠키가 없으면 Supabase를 부르지 않고 '로그아웃 상태'", async () => {
  const calls = fake({ getUser: async () => { calls.push(["getUser"]); return user; } });
  const res = makeRes();
  await me(get({}, {}), res);
  assert.deepEqual(json(res), { ok: true, loggedIn: false });
  assert.equal(calls.length, 0);
});

test("보호 페이지: 로그인 안 하면 내용 대신 로그인 화면으로 보내요", async () => {
  fake(); // getUser 실패
  let res = makeRes();
  await page(get({ name: "account", lang: "ko" }), res);
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, "/login?next=%2Faccount");
  assert.ok(!res.body);
  res = makeRes();
  await page(get({ name: "account", lang: "en" }), res);
  assert.equal(res.headers.location, "/en/login?next=%2Fen%2Faccount");
  res = makeRes();
  await page(get({ name: "../secret", lang: "ko" }), res);
  assert.equal(res.code, 404);
});

test("재설정 페이지: 로그인했어도 메일 링크로 안 왔으면 막아요", async () => {
  fake({ getUser: async () => user });
  const res = makeRes();
  await page(get({ name: "reset-password", lang: "ko" }, { cookie: "sb-x=1" }), res);
  assert.equal(res.code, 302);
  assert.match(res.headers.location, /forgot-password/);
});

// ── 실제 @supabase/ssr 로 쿠키가 안전하게 심어지는지 (네트워크만 가짜) ──
test("실제 클라이언트: 로그인 성공 시 세션 쿠키가 httpOnly + Secure + SameSite=Lax", async () => {
  A.deps.createSupabase = realCreateSupabase;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", email: "a@b.co", role: "authenticated", exp: now + 3600, iat: now, aud: "authenticated" })}.sig`;
  const realFetch = global.fetch;
  let sentBody;
  global.fetch = async (url, init) => {
    sentBody = init && init.body ? String(init.body) : "";
    return new Response(JSON.stringify({
      access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "refresh-secret",
      user: { id: "u1", aud: "authenticated", role: "authenticated", email: "a@b.co", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const res = makeRes();
    await login(post({ email: "a@b.co", password: "pw", captchaToken: "turnstile-token" }), res);
    assert.equal(res.code, 200, res.body);
    const cookies = [].concat(res.headers["set-cookie"] || []);
    assert.ok(cookies.length >= 1, "세션 쿠키가 있어야 해요");
    for (const c of cookies) {
      assert.match(c, /HttpOnly/i);
      assert.match(c, /Secure/i);
      assert.match(c, /SameSite=Lax/i);
      assert.match(c, /Path=\//);
    }
    assert.ok(cookies.some((c) => /^sb-/.test(c)), "sb- 세션 쿠키");
    assert.match(sentBody, /turnstile-token/, "캡차 토큰이 Supabase로 전달돼요");
    assert.ok(!res.body.includes("refresh-secret") && !res.body.includes(jwt), "토큰이 응답 본문에 나오면 안 돼요");
  } finally {
    global.fetch = realFetch;
  }
});

// ── 사전신청 메일 함수: 사람 확인(Turnstile) ──
test("signup-mail: TURNSTILE_SECRET_KEY가 있으면 토큰 검증을 통과해야만 메일을 보내요", async () => {
  const mail = require("../api/signup-mail");
  process.env.RESEND_API_KEY = "re_dummy_key_1234567890";
  process.env.TURNSTILE_SECRET_KEY = "0xSECRET";
  const realFetch = global.fetch;
  const sent = [];
  let verifyResult = true;
  global.fetch = async (url, init) => {
    if (String(url).includes("siteverify")) return { json: async () => ({ success: verifyResult }) };
    sent.push(url);
    return { ok: true };
  };
  const call = async (body) => {
    const res = makeRes();
    const r = { method: "POST", body, headers: {} };
    res.json = (b) => { res.body = JSON.stringify(b); return res; };
    await mail(r, res);
    return res;
  };
  try {
    let res = await call({ name: "Sam", email: "a@b.co" });                       // 토큰 없음
    assert.equal(res.code, 400); assert.equal(sent.length, 0);
    res = await call({ name: "Sam", email: "a@b.co", captchaToken: "x" });       // 검증 통과
    assert.equal(res.code, 200); assert.equal(sent.length, 1);
    verifyResult = false;
    res = await call({ name: "Sam", email: "a@b.co", captchaToken: "x" });       // 검증 실패
    assert.equal(res.code, 400); assert.equal(sent.length, 1, "검증 실패 시 메일을 보내면 안 돼요");
  } finally {
    global.fetch = realFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

// ── 인증 함수 묶음(api/auth/[action].js) ──
test("api/auth/[action]: 허용된 동작만 해당 처리기로 보내고, 모르는 동작은 404", async () => {
  const dispatch = require("../api/auth/[action]");
  const mkRes = () => { const r = { code: 200, headers: {}, body: undefined, setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, getHeader(k) { return r.headers[k.toLowerCase()]; }, status(c) { r.code = c; return r; }, send(b) { r.body = b; return r; }, end(b) { r.body = b; return r; } }; return r; };
  fake();
  for (const bad of ["", "nope", "../signup", "__proto__", "constructor", "toString", undefined, ["login"]]) {
    const res = mkRes(); dispatch({ method: "POST", query: { action: bad }, headers: {} }, res);
    assert.equal(res.code, 404, String(bad));
  }
  // 로그인 처리기로 연결되는지: 다른 사이트 Origin 이면 403 (처리기의 CSRF 검사까지 도달)
  let res = mkRes(); await dispatch({ method: "POST", query: { action: "login" }, headers: { "content-type": "application/json", origin: "https://evil.test" }, body: {} }, res);
  assert.equal(res.code, 403);
  // me 는 쿠키 없이 GET 하면 로그아웃 상태
  res = mkRes(); await dispatch({ method: "GET", query: { action: "me" }, headers: {} }, res);
  assert.deepEqual(JSON.parse(res.body), { ok: true, loggedIn: false });
});
