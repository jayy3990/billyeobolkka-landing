// 체험 로그인: 대회 현장에서 누구나 버튼 한 번으로 체험 계정에 들어가게 해요.
// 보안: Origin 확인 → 사람 확인(Turnstile) 토큰 필요 → 서버가 환경변수의 체험 계정으로 로그인(비밀번호는 화면으로 나가지 않아요).
//  환경변수(DEMO_EMAIL·DEMO_PASSWORD)가 없으면 이 기능은 꺼져 있어요(404).
const A = require("../auth");
const demo = require("../demo");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  const c = demo.creds();
  if (!c) return A.fail(res, 404, "not_found");
  const b = A.readBody(req);
  const lang = A.normLang(b.lang);
  const token = A.captchaToken(b);
  if (!token) return A.fail(res, 400, "captcha");

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { error } = await supabase.auth.signInWithPassword({ email: c.email, password: c.password, options: { captchaToken: token } });
    if (error) {
      const code = A.mapAuthError(error);
      console.error("demo 로그인 실패", error.status, error.code); // 계정 정보는 남기지 않아요
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
