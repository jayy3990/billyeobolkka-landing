// 내 프로필(표시 이름) 저장. 사용자 본인 권한(RLS)으로만 자기 행을 고쳐요.
const A = require("../auth");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  const b = A.readBody(req);
  const name = typeof b.displayName === "string" ? b.displayName.trim() : "";
  if (name.length > 40 || /[\u0000-\u001f]/.test(name)) return A.fail(res, 400, "name");

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { data, error: userErr } = await supabase.auth.getUser();
    if (userErr || !data || !data.user) return A.fail(res, 401, "auth");
    const { error } = await supabase.from("profiles").update({ display_name: name || null }).eq("id", data.user.id);
    if (error) {
      console.error("profile 실패", error.code);
      return A.fail(res, 400, "generic");
    }
    return A.send(res, 200, { ok: true });
  } catch (e) {
    console.error("profile 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
