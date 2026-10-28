// 체험 시작: 방문자마다 이메일·비밀번호 없는 "임시 계정"을 하나씩 만들어 로그인시켜요 (Supabase 익명 로그인).
// 보안: Origin 확인 → 사람 확인(Turnstile) 토큰 필요 → 서버가 익명 계정을 만들고 세션 쿠키만 심어요.
//  임시 계정도 DB에는 정식 사용자 행이 있어서 "본인 행만 접근"(RLS) 규칙이 똑같이 적용돼요.
//  환경변수 DEMO_MODE가 꺼져 있으면 이 기능은 없는 것처럼 404예요.
const A = require("../auth");
const demo = require("../demo");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  if (!demo.enabled()) return A.fail(res, 404, "not_found");
  const b = A.readBody(req);
  const lang = A.normLang(b.lang);
  const token = A.captchaToken(b);
  if (!token) return A.fail(res, 400, "captcha");

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken: token } });
    if (error) {
      const code = A.mapAuthError(error);
      console.error("demo 임시 계정 실패", error.status, error.code);
      if (code === "captcha") return A.fail(res, 400, "captcha");
      if (code === "rate") return A.fail(res, 429, "rate");
      return A.fail(res, 500, "server");
    }
    return A.send(res, 200, { ok: true, redirect: A.defaultHome(lang) });
  } catch (e) {
    console.error("demo 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
