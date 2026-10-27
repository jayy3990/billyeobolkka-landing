// /api/history — 로그인한 사용자의 추천 기록
//   GET              : 내 기록 목록 (최신순, 최대 30건)
//   GET ?id=<uuid>   : 기록 한 건 (다시 추천할 때 조건을 채우는 데 써요)
//   DELETE ?id=<uuid>: 기록 한 건 삭제
//   DELETE           : 내 기록 전체 삭제
// 보안: Origin 확인(변경 요청) → 로그인(getUser) → 본인 행만(user_id 조건 + DB의 RLS). 기록 id는 UUID 형식만 받아요.
const A = require("./_lib/auth");
const history = require("./_lib/history");

module.exports = async (req, res) => {
  const method = req.method;
  if (method !== "GET" && method !== "DELETE") return A.fail(res, 405, "method");
  if (method === "DELETE" && !A.sameOriginMutation(req, res)) return;

  const rawId = req.query && req.query.id;
  const hasId = rawId !== undefined && rawId !== "";
  if (hasId && !history.isUuid(rawId)) return A.fail(res, 400, "id");

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data || !data.user) return A.fail(res, 401, "auth");
    const uid = data.user.id;

    if (method === "GET") {
      let r;
      if (hasId) {
        r = await supabase.from(history.TABLE).select(history.COLUMNS).eq("user_id", uid).eq("id", rawId).maybeSingle();
        if (r.error) { console.error("history 조회 실패", r.error.code); return A.fail(res, 500, "server"); }
        if (!r.data) return A.fail(res, 404, "not_found");
        return A.send(res, 200, { ok: true, record: history.toClient(r.data) });
      }
      r = await supabase.from(history.TABLE).select(history.COLUMNS).eq("user_id", uid).order("created_at", { ascending: false }).limit(history.KEEP);
      if (r.error) { console.error("history 목록 실패", r.error.code); return A.fail(res, 500, "server"); }
      return A.send(res, 200, { ok: true, records: (r.data || []).map(history.toClient) });
    }

    // DELETE: id가 있으면 그 한 건, 없으면 내 기록 전체
    let q = supabase.from(history.TABLE).delete().eq("user_id", uid);
    if (hasId) q = q.eq("id", rawId);
    const d = await q;
    if (d.error) { console.error("history 삭제 실패", d.error.code); return A.fail(res, 500, "server"); }
    return A.send(res, 200, { ok: true });
  } catch (e) {
    console.error("history 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
