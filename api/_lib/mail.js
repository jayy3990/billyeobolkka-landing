// 추천 결과 메일 만들기·보내기. 서버에서만 실행돼요.
//  - 메일 내용은 DB에 저장된 내 추천 기록(서버가 가진 값)만 써요. 화면이 보낸 글은 쓰지 않아요.
//  - 모든 글자는 HTML로 이스케이프하고, 제목의 줄바꿈은 없애요(헤더 주입 방지).
//  - Resend 키는 환경변수에서만 읽고, 로그·응답에 내보내지 않아요.
const { getEnv, siteUrl } = require("./auth");

class MailError extends Error {
  constructor(code) { super("mail:" + code); this.code = code; } // "config" | "send"
}
const deps = { fetch: (...a) => fetch(...a) };

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (s) => String(s == null ? "" : s).replace(new RegExp("[\\r\\n\\u2028\\u2029]+", "g"), " ").trim();

// a***@gmail.com 처럼 가려서 화면에 알려 줘요
function maskEmail(email) {
  const [u, d] = String(email || "").split("@");
  if (!u || !d) return "";
  return u.slice(0, 1) + "***@" + d;
}

const TEXT = {
  ko: {
    subject: (lib, n) => `[빌려볼까] ${lib}에서 추천하는 책 ${n}권`,
    heading: (lib) => `${lib}에서 추천하는 책`,
    sub: (when) => `${when}에 받은 추천이에요.`,
    avail: { Y: "대출 가능", N: "대출 중", unknown: "대출 여부 확인 불가" },
    availNote: "대출 상태는 추천받은 당시(전날 기준) 값이라 지금과 다를 수 있어요. 방문 전 도서관에 확인하세요.",
    ai: "추천 이유는 AI가 쓴 글이라 틀릴 수 있어요.",
    history: "내 추천 기록 보기",
    why: "이 메일은 빌려볼까에서 내가 직접 \"메일로 받기\"를 눌러 보낸 메일이에요.",
    locale: "ko-KR",
  },
  en: {
    subject: (lib, n) => `[Billyeobolkka] ${n} picks from ${lib}`,
    heading: (lib) => `Picks from ${lib}`,
    sub: (when) => `Your picks from ${when}.`,
    avail: { Y: "Available to borrow", N: "On loan", unknown: "Availability unknown" },
    availNote: "Loan status is as of when the picks were made (previous day) and may differ now. Please check with the library before visiting.",
    ai: "The reasons are AI-written and may contain mistakes.",
    history: "View my picks history",
    why: "You're receiving this because you pressed \"Email me\" on Billyeobolkka.",
    locale: "en-US",
  },
};

// 추천 기록 한 건(history.toClient 결과) → { subject, html, text }
function buildEmail(record) {
  const lang = record.lang === "en" ? "en" : "ko";
  const t = TEXT[lang];
  const lib = oneLine(record.libName) || (lang === "en" ? "your library" : "내 도서관");
  const items = Array.isArray(record.items) ? record.items.slice(0, 8) : [];
  let when = "";
  try { when = new Intl.DateTimeFormat(t.locale, { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(record.createdAt)); } catch (e) { when = ""; }
  const site = siteUrl();
  const link = site ? site + (lang === "en" ? "/en" : "") + "/history" : "";
  const keyOf = (a) => (a === "Y" || a === "N" ? a : "unknown");
  const badgeColor = { Y: "background:#e6f6ec;color:#14532d;", N: "background:#fff4d6;color:#7a4b00;", unknown: "background:#eceef6;color:#3b4157;" };

  const rows = items.map((it, i) => {
    const k = keyOf(it.available);
    return `<div style="border:1px solid #d9dce8;border-radius:14px;padding:14px 16px;margin:0 0 12px;">
  <div style="font-size:17px;font-weight:700;line-height:1.4;">${i + 1}. ${esc(it.title)}</div>
  ${it.author ? `<div style="color:#5b6275;font-size:14px;">${esc(it.author)}</div>` : ""}
  <div style="margin-top:8px;line-height:1.7;">${esc(it.reason)}</div>
  <span style="display:inline-block;margin-top:8px;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:700;${badgeColor[k]}">${esc(t.avail[k])}</span>
</div>`;
  }).join("\n");

  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f4f8f4;font-family:'Malgun Gothic','Noto Sans KR',Arial,sans-serif;color:#1d2230;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="background:#1f6b4f;color:#ffffff;border-radius:16px 16px 0 0;padding:20px 28px;font-size:20px;font-weight:700;">📚 ${esc(t.heading(lib))}</div>
  <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:24px 28px;font-size:16px;">
    ${when ? `<p style="margin:0 0 16px;color:#5b6275;">${esc(t.sub(when))}</p>` : ""}
    ${rows}
    <p style="margin:16px 0 0;color:#5b6275;font-size:13px;line-height:1.6;">${esc(t.availNote)}<br>${esc(t.ai)}</p>
    ${link ? `<p style="margin:16px 0 0;"><a href="${esc(link)}" style="color:#1f6b4f;font-weight:700;">${esc(t.history)}</a></p>` : ""}
  </div>
  <p style="margin:16px 4px 0;color:#5b6275;font-size:12px;">${esc(t.why)}</p>
</div></body></html>`;

  const textRows = items.map((it, i) => `${i + 1}. ${oneLine(it.title)}${it.author ? " / " + oneLine(it.author) : ""}\n   ${oneLine(it.reason)}\n   [${t.avail[keyOf(it.available)]}]`).join("\n\n");
  const text = `${t.heading(lib)}\n${when ? t.sub(when) + "\n" : ""}\n${textRows}\n\n${t.availNote}\n${t.ai}\n${link ? "\n" + t.history + ": " + link + "\n" : ""}\n${t.why}\n`;

  return { subject: oneLine(t.subject(lib, items.length)).slice(0, 150), html, text };
}

// Resend로 한 통 보내요. 실패하면 MailError("config" | "send") (키·받는 사람 주소는 로그에 남기지 않아요)
async function send({ to, subject, html, text }) {
  const key = getEnv("RESEND_API_KEY");
  if (!key) throw new MailError("config");
  const from = getEnv("MAIL_FROM_EMAIL") || getEnv("CONTACT_FROM_EMAIL") || "빌려볼까 <onboarding@resend.dev>";
  let r;
  try {
    r = await deps.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
  } catch (e) {
    console.error("Resend 호출 오류", e && e.message);
    throw new MailError("send");
  }
  if (!r.ok) {
    console.error("Resend 실패", r.status);
    throw new MailError("send");
  }
}

module.exports = { MailError, deps, esc, maskEmail, buildEmail, send };
