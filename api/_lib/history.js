// 추천 기록 저장·정리·변환. 서버에서만 실행돼요.
//  - 기록은 로그인한 사용자 본인의 권한(RLS)으로만 읽고 써요. user_id는 로그인 정보에서만 가져와요.
//  - 저장하는 책 제목·저자·추천 이유는 서버가 가진 값(정보나루 공식 값 + 검증을 통과한 AI 글)이고, 길이를 제한해요.
//  - 기록 저장이 실패해도 추천 결과는 그대로 보여 줘요(저장은 "있으면 좋은" 부가 기능이라 실패를 삼켜요).

const libs = require("./libs");
const { clean } = require("./recommend-core");

const TABLE = "recommendation_history";
const KEEP = 30; // 사용자당 보관하는 최근 기록 수
const COLUMNS = "id, created_at, lang, lib_code, age_group, gender, genres, liked, items";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID.test(v);

// 추천 한 번 → DB에 넣을 한 줄 (화면에서 온 값이 아니라 검증이 끝난 입력·결과만 써요)
function buildRow(uid, input, out) {
  const likedSrc = Array.isArray(out.liked) ? out.liked : [];
  return {
    user_id: uid,
    lang: input.lang === "en" ? "en" : "ko",
    lib_code: input.libCode,
    age_group: input.ageGroup,
    gender: input.gender,
    genres: input.genres,
    liked: likedSrc.slice(0, 3).map((b) => ({ isbn13: String(b.isbn13), title: clean(b.title, 80), author: clean(b.author, 40) })),
    items: out.items.slice(0, 8).map((it) => ({
      isbn13: String(it.isbn13),
      title: clean(it.title, 80),
      author: clean(it.author, 40),
      reason: clean(it.reason, 300),
      available: it.available === "Y" || it.available === "N" ? it.available : null,
    })),
  };
}

// 저장 + 오래된 기록 정리. 성공하면 true, 실패하면 false (예외를 밖으로 내보내지 않아요)
async function save(supabase, uid, input, out) {
  try {
    const ins = await supabase.from(TABLE).insert(buildRow(uid, input, out));
    if (ins.error) { console.error("history 저장 실패", ins.error.code); return false; }
    // 최근 KEEP건만 남기고 나머지는 지워요 (본인 행만: 조회·삭제 모두 user_id 조건 + RLS)
    const old = await supabase.from(TABLE).select("id").eq("user_id", uid).order("created_at", { ascending: false }).range(KEEP, KEEP + 99);
    const ids = ((old && old.data) || []).map((r) => r.id).filter(isUuid);
    if (ids.length) await supabase.from(TABLE).delete().eq("user_id", uid).in("id", ids);
    return true;
  } catch (e) {
    console.error("history 오류", e && e.message);
    return false;
  }
}

// DB 행 → 화면용 (도서관 이름은 스냅샷에서 찾고, 사라진 도서관은 null)
function toClient(row) {
  if (!row) return null;
  const lib = libs.getLibrary(row.lib_code);
  const liked = Array.isArray(row.liked) ? row.liked : [];
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    id: String(row.id),
    createdAt: row.created_at,
    lang: row.lang === "en" ? "en" : "ko",
    libCode: lib ? row.lib_code : null,
    libName: lib ? lib.n : null,
    libSido: lib ? lib.s : null,
    libGu: lib ? lib.g : null,
    ageGroup: row.age_group,
    gender: row.gender,
    genres: Array.isArray(row.genres) ? row.genres : [],
    liked: liked.slice(0, 3).map((b) => ({ isbn13: String(b.isbn13 || ""), title: String(b.title || ""), author: String(b.author || "") })),
    items: items.slice(0, 8).map((it) => ({
      isbn13: String(it.isbn13 || ""), title: String(it.title || ""), author: String(it.author || ""),
      reason: String(it.reason || ""), available: it.available === "Y" || it.available === "N" ? it.available : null,
    })),
  };
}

module.exports = { TABLE, KEEP, COLUMNS, isUuid, buildRow, save, toClient };
