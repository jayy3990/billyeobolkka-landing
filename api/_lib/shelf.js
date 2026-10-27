// 내 서재(읽은 책) 저장·변환·추천용 요약. 서버에서만 실행돼요.
//  - 서재는 로그인한 사용자 본인의 권한(RLS)으로만 읽고 써요. user_id는 로그인 정보에서만 가져와요.
//  - 제목·저자는 서버가 가진 값(정보나루 공식 값 / 본인 추천 기록)이에요. 화면이 보낸 제목은 쓰지 않아요.
const { clean } = require("./recommend-core");

const TABLE = "user_library";
const MAX = 300; // 사용자당 최대 권수
const COLUMNS = "id, isbn13, title, author, rating, added_at";
const RATINGS = ["liked", "ok", "disliked"];
const ISBN13 = /^\d{13}$/;
const isIsbn = (v) => typeof v === "string" && ISBN13.test(v);
const isRating = (v) => RATINGS.includes(v);

function toClient(row) {
  return {
    isbn13: String(row.isbn13),
    title: String(row.title || ""),
    author: String(row.author || ""),
    rating: isRating(row.rating) ? row.rating : null,
    addedAt: row.added_at,
  };
}

// 서재 전체(최신순). 추천 때 읽는 용도라 실패하면 빈 목록을 돌려줘요(추천을 막지 않아요).
async function load(supabase, uid) {
  try {
    const r = await supabase.from(TABLE).select(COLUMNS).eq("user_id", uid).order("added_at", { ascending: false }).limit(MAX);
    if (r.error) { console.error("서재 조회 실패", r.error.code); return []; }
    return (r.data || []).filter((x) => isIsbn(String(x.isbn13))).map(toClient);
  } catch (e) {
    console.error("서재 오류", e && e.message);
    return [];
  }
}

// 추천 프롬프트용: 취향이 잘 드러나는 순서(재밌게 읽음 → 별로 → 그 밖)로 일부만, 글자 수 제한
const LABEL = { liked: "재밌게 읽음", disliked: "별로", ok: "보통" };
function summarize(shelf, limits = { liked: 8, disliked: 5, other: 6 }) {
  const by = (f) => shelf.filter(f);
  const pick = (arr, n) => arr.slice(0, n).map((b) => ({ title: clean(b.title, 60), author: clean(b.author, 30), rating: LABEL[b.rating] || "읽음(평가 없음)" }));
  return [
    ...pick(by((b) => b.rating === "liked"), limits.liked),
    ...pick(by((b) => b.rating === "disliked"), limits.disliked),
    ...pick(by((b) => b.rating !== "liked" && b.rating !== "disliked"), limits.other),
  ];
}

// 비슷한 책 조회의 기준이 될 ISBN: 사용자가 이번에 고른 책 먼저, 모자라면 서재에서 재밌게 읽은 최근 책으로 채워 최대 max권
function seedIsbns(likedIsbns, shelf, max = 3) {
  const out = [];
  for (const i of likedIsbns) if (out.length < max && !out.includes(i)) out.push(i);
  for (const b of shelf) if (out.length < max && b.rating === "liked" && !out.includes(b.isbn13)) out.push(b.isbn13);
  return out;
}

module.exports = { TABLE, MAX, COLUMNS, RATINGS, isIsbn, isRating, toClient, load, summarize, seedIsbns };
