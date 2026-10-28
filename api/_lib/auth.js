// 회원 인증 공용 코드 (서버에서만 실행돼요)
//  - 세션은 Supabase가 주는 토큰을 httpOnly 쿠키에만 저장해요. 브라우저 JS는 토큰을 볼 수 없어요.
//  - 사용자 확인은 getUser()로 Supabase 서버에 물어서 해요 (쿠키 값을 그대로 믿지 않아요).
//  - service_role 키는 쓰지 않아요. 공개(publishable) 키 + 사용자 본인 권한(RLS)만 써요.
// 필요한 환경변수: SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL (없으면 맨 위 .env에서 읽어요 - 로컬 시험용)

const fs = require("fs");
const path = require("path");

function getEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", ".env"), "utf8");
    const line = file.split(/\r?\n/).find((l) => l.startsWith(name + "="));
    return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : "";
  } catch (e) {
    return "";
  }
}

// ── 고정 규칙 ────────────────────────────────────────────────
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // Supabase(bcrypt) 한계

// 비밀번호 정책: 8자 이상, 영문과 숫자 포함. 통과하면 null, 아니면 오류 코드
function checkPassword(pw) {
  if (typeof pw !== "string") return "weak";
  if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) return "weak";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "weak";
  return null;
}

function checkEmail(email) {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email);
}

const normLang = (l) => (l === "en" ? "en" : "ko");

// ── 사이트 주소 / 안전한 이동 주소 ───────────────────────────────
function siteUrl() {
  const v = getEnv("SITE_URL").replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+$/.test(v) ? v : "";
}

// 로그인 뒤 등으로 이동할 주소: 우리 사이트 안의 경로만 허용 (오픈 리다이렉트 방지)
// 전체 주소(https://내사이트/...)가 들어오면 우리 사이트일 때만 경로 부분만 꺼내 써요.
function safeNext(next, fallback) {
  const site = siteUrl();
  let v = typeof next === "string" ? next.trim() : "";
  if (site && v.startsWith(site + "/")) v = v.slice(site.length);
  if (!v || v.length > 200) return fallback;
  if (!/^\/[A-Za-z0-9\-._~\/?=&%#]*$/.test(v)) return fallback; // 허용 글자만
  if (v.startsWith("//") || v.includes("\\") || v.includes("..")) return fallback;
  let decoded;
  try { decoded = decodeURIComponent(v); } catch (e) { return fallback; }
  if (decoded.startsWith("//") || decoded.includes("\\") || /[\u0000-\u001f]/.test(decoded) || decoded.includes("://")) return fallback;
  return v;
}

const defaultAccount = (lang) => (lang === "en" ? "/en/account" : "/account");
const defaultHome = (lang) => (lang === "en" ? "/en" : "/");
const loginPath = (lang) => (lang === "en" ? "/en/login" : "/login");

// ── 응답 도우미 ─────────────────────────────────────────────
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(body));
}
const fail = (res, status, error) => send(res, status, { ok: false, error });

function redirect(res, location, status = 303) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", location);
  res.status(status).end();
}

function readBody(req) {
  const b = req.body;
  if (b && typeof b === "object") return b;
  if (typeof b === "string") { try { return JSON.parse(b); } catch (e) { return {}; } }
  return {};
}

// POST 요청이 우리 사이트에서 왔는지 확인 (CSRF 방지). 통과하면 true
function sameOriginPost(req, res) {
  if (req.method !== "POST") { fail(res, 405, "method"); return false; }
  const site = siteUrl();
  if (!site) { fail(res, 500, "server"); return false; }
  const ct = String(req.headers["content-type"] || "");
  if (!ct.toLowerCase().startsWith("application/json")) { fail(res, 415, "bad_request"); return false; }
  if (req.headers.origin !== site) { fail(res, 403, "forbidden"); return false; }
  return true;
}

// PUT/DELETE 요청도 같은 사이트에서 온 것만 받아요 (CSRF 방지). PUT은 JSON 본문이 있어야 하고, DELETE는 본문이 없어도 돼요.
function sameOriginMutation(req, res) {
  const m = req.method;
  if (m !== "PUT" && m !== "DELETE") { fail(res, 405, "method"); return false; }
  const site = siteUrl();
  if (!site) { fail(res, 500, "server"); return false; }
  if (m === "PUT" && !String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) { fail(res, 415, "bad_request"); return false; }
  if (req.headers.origin !== site) { fail(res, 403, "forbidden"); return false; }
  return true;
}

// ── Supabase 오류 → 정리된 코드 (원본 문구는 화면에 안 보여요) ───────────
function mapAuthError(err) {
  if (!err) return null;
  const code = String(err.code || "");
  const msg = String(err.message || "").toLowerCase();
  if (err.status === 429 || /rate_limit/.test(code)) return "rate";
  if (/captcha/.test(code) || /captcha/.test(msg)) return "captcha";
  if (code === "weak_password") return "weak";
  if (code === "same_password") return "same";
  return "generic";
}

// ── 쿠키 + Supabase 서버 클라이언트 ──────────────────────────────
const deps = {
  // 시험에서 가짜로 바꿀 수 있게 따로 둬요
  createSupabase(req, res) {
    const { createServerClient, parseCookieHeader, serializeCookieHeader } = require("@supabase/ssr");
    const url = getEnv("SUPABASE_URL");
    const key = getEnv("SUPABASE_ANON_KEY");
    if (!url || !key) throw new Error("Supabase 환경변수가 없어요");
    const secure = siteUrl().startsWith("https://");
    return createServerClient(url, key, {
      cookieOptions: { httpOnly: true, secure, sameSite: "lax", path: "/" },
      cookies: {
        getAll: () => parseCookieHeader(req.headers.cookie || "").map((c) => ({ name: c.name, value: c.value ?? "" })),
        setAll: (list) => {
          const out = list.map(({ name, value, options }) =>
            serializeCookieHeader(name, value, { ...options, httpOnly: true, secure, sameSite: "lax", path: "/" })
          );
          const prev = res.getHeader("Set-Cookie");
          res.setHeader("Set-Cookie", [].concat(prev || [], out));
        },
      },
      auth: { flowType: "pkce", detectSessionInUrl: false },
    });
  },
};

// 비밀번호 재설정 메일 링크로 들어온 사람만 새 비밀번호를 정할 수 있게 하는 짧은 표시 쿠키
const RECOVERY_COOKIE = "bb-recovery";
function setRecoveryFlag(res, on) {
  const secure = siteUrl().startsWith("https://") ? "; Secure" : "";
  const c = `${RECOVERY_COOKIE}=${on ? "1" : ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${on ? 900 : 0}${secure}`;
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [].concat(prev || [], c));
}
function hasRecoveryFlag(req) {
  return /(?:^|;\s*)bb-recovery=1(?:;|$)/.test(req.headers.cookie || "");
}

// 로그아웃 때 sb- 로 시작하는 세션 쿠키를 모두 지워요
function clearSessionCookies(req, res) {
  const secure = siteUrl().startsWith("https://") ? "; Secure" : "";
  const names = (req.headers.cookie || "").split(/;\s*/).map((p) => p.split("=")[0]).filter((n) => n.startsWith("sb-"));
  const prev = res.getHeader("Set-Cookie");
  const out = names.map((n) => `${n}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  res.setHeader("Set-Cookie", [].concat(prev || [], out));
}

// Turnstile 토큰 모양 확인 (실제 검증은 Supabase가 해요)
function captchaToken(body) {
  const t = body && body.captchaToken;
  return typeof t === "string" && t.length > 0 && t.length <= 2048 ? t : "";
}

module.exports = {
  getEnv, siteUrl, safeNext, defaultAccount, defaultHome, loginPath, checkPassword, checkEmail, normLang,
  send, fail, redirect, readBody, sameOriginPost, sameOriginMutation, mapAuthError, deps,
  RECOVERY_COOKIE, setRecoveryFlag, hasRecoveryFlag, clearSessionCookies, captchaToken,
  PASSWORD_MIN, PASSWORD_MAX,
};
