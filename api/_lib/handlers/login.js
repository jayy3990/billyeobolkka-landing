// 로그인: 성공하면 세션을 httpOnly 쿠키에 심고, 안전하게 검사한 이동 주소를 돌려줘요.
// 실패는 어느 쪽이 틀렸는지 알려 주지 않고 항상 같은 코드("credentials")예요.
const A = require("../auth");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  const b = A.readBody(req);
  const lang = A.normLang(b.lang);
  const email = String(b.email || "").trim().toLowerCase();
  const password = typeof b.password === "string" ? b.password : "";

  if (!A.checkEmail(email) || !password || password.length > 200) return A.fail(res, 401, "credentials");
  const token = A.captchaToken(b);
  if (!token) return A.fail(res, 400, "captcha");

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken: token } });
    if (error) {
      const code = A.mapAuthError(error);
      console.error("login 실패", error.status, error.code);
      if (code === "captcha") return A.fail(res, 400, "captcha");
      if (code === "rate") return A.fail(res, 429, "rate");
      return A.fail(res, 401, "credentials"); // 이메일/비밀번호/미인증 구분 없이 같은 응답
    }
    return A.send(res, 200, { ok: true, redirect: A.safeNext(b.next, A.defaultAccount(lang)) });
  } catch (e) {
    console.error("login 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
