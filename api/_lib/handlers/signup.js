// 회원가입: 이메일+비밀번호 → 인증 메일 발송. 가입 여부와 상관없이 같은 성공 응답을 줘요.
const A = require("../auth");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  const b = A.readBody(req);
  const lang = A.normLang(b.lang);
  const email = String(b.email || "").trim().toLowerCase();

  if (!A.checkEmail(email)) return A.fail(res, 400, "email");
  if (A.checkPassword(b.password)) return A.fail(res, 400, "weak");
  if (b.password !== b.passwordConfirm) return A.fail(res, 400, "mismatch");
  const token = A.captchaToken(b);
  if (!token) return A.fail(res, 400, "captcha");

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { error } = await supabase.auth.signUp({
      email,
      password: b.password,
      options: { emailRedirectTo: A.siteUrl() + A.defaultAccount(lang), captchaToken: token, data: { lang } },
    });
    if (error) {
      // 이미 가입된 이메일이어도 같은 응답 (계정 존재 여부를 알려 주지 않아요)
      if (error.code === "user_already_exists") return A.send(res, 200, { ok: true });
      const code = A.mapAuthError(error);
      console.error("signup 실패", error.status, error.code); // 이메일 등 개인정보는 로그에 안 남겨요
      return A.fail(res, code === "rate" ? 429 : 400, code);
    }
    return A.send(res, 200, { ok: true });
  } catch (e) {
    console.error("signup 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
