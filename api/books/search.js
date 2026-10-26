// POST /api/books/search — 로그인한 사용자만. "좋아한 책"을 고르기 위한 제목 검색.
// 사용자가 쓴 글은 정보나루 검색어로만 쓰이고(허용 글자·길이 제한), 결과의 제목·저자·ISBN은 정보나루 응답이에요.
// 하루 검색 횟수도 제한해요(DB). 추천 때는 여기서 고른 ISBN만 서버로 보내요.
const A = require("../_lib/auth");
const lib = require("../_lib/library");

const QUERY_OK = /^[\p{L}\p{N}\s·:'’\-.,!?&()]+$/u;

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  const q = String((A.readBody(req) || {}).q == null ? "" : A.readBody(req).q).trim().replace(/\s+/g, " ");
  if (q.length < 1 || q.length > 40 || !QUERY_OK.test(q)) return A.fail(res, 400, "query");

  let supabase, eventId = null;
  try {
    supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data || !data.user) return A.fail(res, 401, "auth");

    const rs = await supabase.rpc("reserve_usage", { p_kind: "search" });
    const row = rs.error ? null : (Array.isArray(rs.data) ? rs.data[0] : rs.data);
    if (!row) return A.fail(res, 500, "server");
    if (!row.allowed) return A.send(res, 429, { ok: false, error: "limit" });
    eventId = row.event_id || null;

    const results = await lib.searchByTitle(q);
    return A.send(res, 200, { ok: true, results });
  } catch (e) {
    if (eventId && supabase) { try { await supabase.rpc("refund_usage", { p_event: eventId }); } catch (x) { /* 무시 */ } }
    if (e instanceof lib.LibraryError) {
      console.error("검색 실패(정보나루)", e.code);
      return e.code === "limit" ? A.fail(res, 503, "library_limit") : A.fail(res, 502, "library");
    }
    console.error("검색 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
