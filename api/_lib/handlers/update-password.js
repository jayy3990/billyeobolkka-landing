// 비밀번호 재설정: 메일 링크(recovery)로 들어와 세션과 표시 쿠키가 있는 사람만 새 비밀번호를 정할 수 있어요.
const A = require("../auth");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  const b = A.readBody(req);
  const lang = A.normLang(b.lang);

  if (A.checkPassword(b.password)) return A.fail(res, 400, "weak");
  if (b.password !== b.passwordConfirm) return A.fail(res, 400, "mismatch");

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { data, error: userErr } = await supabase.auth.getUser(); // 서버에서 검증
    if (userErr || !data || !data.user) return A.fail(res, 401, "auth");
    if (!A.hasRecoveryFlag(req)) return A.fail(res, 403, "forbidden");

    const { error } = await supabase.auth.updateUser({ password: b.password });
    if (error) {
      const code = A.mapAuthError(error);
      console.error("update-password 실패", error.status, error.code);
      return A.fail(res, code === "rate" ? 429 : 400, code);
    }
    A.setRecoveryFlag(res, false);
    try { await supabase.auth.signOut({ scope: "others" }); } catch (e) { /* 다른 기기 로그아웃은 가능하면만 */ }
    return A.send(res, 200, { ok: true, redirect: A.defaultAccount(lang) });
  } catch (e) {
    console.error("update-password 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
