// Vercel 서버 함수: 사전신청 완료 안내 메일을 Resend로 보내요.
// 비밀 키는 코드에 없어요. Vercel 환경변수에서만 읽어요:
//   RESEND_API_KEY      - Resend 키 (필수)
//   CONTACT_FROM_EMAIL  - 보내는 사람 (기본: 빌려볼까 <onboarding@resend.dev>, 시험용)

const fs = require("fs");
const path = require("path");

// 환경변수(Vercel)를 먼저 보고, 없으면 작업 폴더 맨 위 .env에서 읽어요 (로컬 시험용)
function getEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env"), "utf8");
    const line = file.split(/\r?\n/).find((l) => l.startsWith(name + "="));
    return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, "") : "";
  } catch (e) {
    return "";
  }
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// 안내 메일 문구 (언어 추가: 아래에 같은 모양으로 한 덩어리 더하기)
const MAIL = {
  ko: {
    brand: "빌려볼까",
    defaultFrom: "빌려볼까 <onboarding@resend.dev>",
    subject: "[빌려볼까] 사전신청 고마워요!",
    hello: (n) => `${n}님, 사전신청 고마워요!`,
    body: "신청이 잘 접수됐어요. 출시되면 가장 먼저 알려 드릴게요.",
    slogan: "오늘 빌릴 책, 같이 골라 볼까요?",
    footer: "이 메일은 빌려볼까 사전신청을 하셔서 보냈어요. 신청하신 적이 없다면 무시해 주세요.",
  },
  en: {
    brand: "Billyeobolkka",
    defaultFrom: "Billyeobolkka <onboarding@resend.dev>",
    subject: "[Billyeobolkka] Thanks for pre-registering!",
    hello: (n) => `Thanks for pre-registering, ${n}!`,
    body: "We've got your sign-up. We'll let you know first when we launch.",
    slogan: "Not sure what to borrow? Let's pick your next read.",
    footer: "You're getting this because you pre-registered for Billyeobolkka. If that wasn't you, you can ignore this email.",
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();

  // 스팸 봇이 채우는 숨은 칸: 값이 있으면 성공인 척 하고 아무것도 안 보내요
  if (body.website) return res.status(200).json({ ok: true });

  if (!name || name.length > 50) return res.status(400).json({ ok: false, error: "name" });
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "email" });
  }

  const key = getEnv("RESEND_API_KEY");
  if (!key) return res.status(500).json({ ok: false, error: "server" });
  const lang = body.lang === "en" ? "en" : "ko"; // 신청한 페이지 언어에 맞춰 메일 언어를 정해요
  const m = MAIL[lang];
  const from = getEnv("CONTACT_FROM_EMAIL") || m.defaultFrom;
  const safeName = esc(name);

  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f6f7fb;font-family:'Malgun Gothic','Noto Sans KR',Arial,sans-serif;color:#1d2230;">
<div style="max-width:520px;margin:0 auto;padding:32px 20px;">
  <div style="background:#4f46e5;color:#ffffff;border-radius:16px 16px 0 0;padding:24px 28px;font-size:22px;font-weight:800;">📖 ${m.brand}</div>
  <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px;line-height:1.7;font-size:17px;">
    <p style="margin:0 0 14px;font-size:20px;font-weight:800;">${m.hello(safeName)}</p>
    <p style="margin:0 0 14px;">${m.body}</p>
    <p style="margin:0;color:#4f46e5;font-weight:800;">${m.slogan}</p>
  </div>
  <p style="margin:16px 4px 0;color:#5b6275;font-size:13px;">${m.footer}</p>
</div></body></html>`;
  const text = `${m.hello(name)}\n${m.body}\n\n${m.slogan}\n- ${m.brand}`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: m.subject, html, text }),
    });
    if (!r.ok) {
      // 이메일 주소 같은 개인정보는 로그에 남기지 않아요
      console.error("Resend 실패", r.status, await r.text());
      return res.status(502).json({ ok: false, error: "send" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Resend 호출 오류", e && e.message);
    return res.status(502).json({ ok: false, error: "send" });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
