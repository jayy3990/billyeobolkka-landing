// POST /api/mail/send {historyId} — 내 추천 기록 한 건을 "내 로그인 이메일"로 보내요.
// 보안: Origin 확인 → 로그인(getUser) → 기록 id 형식 확인 → 하루 5통 확보(DB) → 내 기록 조회(user_id 조건 + RLS) → 발송 → 실패하면 횟수 되돌림
//  - 받는 사람은 입력받지 않아요. 로그인 정보의 이메일로만 보내서, 남에게 보내는 악용(스팸 중계)이 불가능해요.
//  - 메일 내용은 DB에 저장된 내 기록만 써요(화면이 보낸 글은 쓰지 않아요).
const A = require("../auth");
const history = require("../history");
const mail = require("../mail");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  const id = (A.readBody(req) || {}).historyId;
  if (!history.isUuid(id)) return A.fail(res, 400, "history");

  let supabase, eventId = null;
  try {
    supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data || !data.user) return A.fail(res, 401, "auth");
    const uid = data.user.id;
    const to = data.user.email;
    // 임시 체험 계정은 이메일이 없어서 메일을 받을 수 없어요 (횟수를 쓰기 전에 거절)
    if (!to || data.user.is_anonymous === true) return A.fail(res, 400, "email");

    const rs = await supabase.rpc("reserve_usage", { p_kind: "mail" });
    const row = rs.error ? null : (Array.isArray(rs.data) ? rs.data[0] : rs.data);
    if (!row) { console.error("mail reserve 실패", rs.error && rs.error.code); return A.fail(res, 500, "server"); }
    if (!row.allowed) return A.send(res, 429, { ok: false, error: "limit" });
    eventId = row.event_id || null;

    const r = await supabase.from(history.TABLE).select(history.COLUMNS).eq("user_id", uid).eq("id", id).maybeSingle();
    if (r.error) throw new Error("db");
    if (!r.data) { await refund(supabase, eventId); return A.fail(res, 404, "not_found"); }

    await mail.send({ to, ...mail.buildEmail(history.toClient(r.data)) });
    return A.send(res, 200, { ok: true, to: mail.maskEmail(to), remaining: Number(row.remaining) || 0 });
  } catch (e) {
    await refund(supabase, eventId);
    if (e instanceof mail.MailError) return A.fail(res, e.code === "config" ? 500 : 502, e.code === "config" ? "server" : "send");
    console.error("mail 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};

async function refund(supabase, eventId) {
  if (!eventId || !supabase) return;
  try { await supabase.rpc("refund_usage", { p_event: eventId }); } catch (e) { /* 무시 */ }
}
