// 비밀번호 찾기: 가입 여부와 상관없이 항상 같은 성공 응답 ("가입된 이메일이라면 보냈어요").
const A = require("../auth");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  const b = A.readBody(req);
  const lang = A.normLang(b.lang);
  const email = String(b.email || "").trim().toLowerCase();

  if (!A.checkEmail(email)) return A.fail(res, 400, "email");
  const token = A.captchaToken(b);
  if (!token) return A.fail(res, 400, "captcha");

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: A.siteUrl() + (lang === "en" ? "/en" : "") + "/reset-password",
      captchaToken: token,
    });
    if (error) {
      const code = A.mapAuthError(error);
      console.error("forgot 실패", error.status, error.code);
      if (code === "captcha") return A.fail(res, 400, "captcha");
      if (code === "rate") return A.fail(res, 429, "rate");
      // 그 밖의 오류는 가입 여부가 드러나지 않게 같은 성공 응답
    }
    return A.send(res, 200, { ok: true });
  } catch (e) {
    console.error("forgot 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
