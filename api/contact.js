// Vercel 서버 함수: 홈페이지 문의 내용을 Resend로 내 이메일에 보내요.
// 비밀 키는 코드에 없어요. Vercel 환경변수에서만 읽어요:
//   RESEND_API_KEY      - Resend 키 (필수)
//   CONTACT_TO_EMAIL    - 문의를 받을 내 이메일 (필수)
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

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();

  // 스팸 봇이 채우는 숨은 칸: 값이 있으면 성공인 척 하고 아무것도 안 보내요
  if (body.website) return res.status(200).json({ ok: true });

  if (!name || name.length > 50) return res.status(400).json({ ok: false, error: "name" });
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "email" });
  }
  if (!message || message.length > 2000) return res.status(400).json({ ok: false, error: "message" });

  const key = getEnv("RESEND_API_KEY");
  const to = getEnv("CONTACT_TO_EMAIL");
  if (!key || !to) return res.status(500).json({ ok: false, error: "server" });
  const from = getEnv("CONTACT_FROM_EMAIL") || "빌려볼까 <onboarding@resend.dev>";

  const sentAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const html = `<!doctype html><html lang="ko"><body style="margin:0;background:#f6f7fb;font-family:'Malgun Gothic','Noto Sans KR',Arial,sans-serif;color:#1d2230;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="background:#4f46e5;color:#ffffff;border-radius:16px 16px 0 0;padding:20px 28px;font-size:20px;font-weight:700;">📩 홈페이지 문의가 왔어요</div>
  <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:24px 28px;line-height:1.7;font-size:16px;">
    <p style="margin:0 0 6px;"><b>이름</b> ${esc(name)}</p>
    <p style="margin:0 0 6px;"><b>이메일</b> ${esc(email)}</p>
    <p style="margin:0 0 16px;"><b>보낸 시각</b> ${esc(sentAt)} (한국 시간)</p>
    <p style="margin:0 0 6px;"><b>문의 내용</b></p>
    <div style="white-space:pre-wrap;background:#f6f7fb;border-radius:12px;padding:14px 16px;">${esc(message)}</div>
  </div>
  <p style="margin:16px 4px 0;color:#5b6275;font-size:13px;">이 메일에 바로 답장하면 문의하신 분(${esc(email)})에게 갑니다.</p>
</div></body></html>`;
  const text = `홈페이지 문의가 왔어요\n\n이름: ${name}\n이메일: ${email}\n보낸 시각: ${sentAt} (한국 시간)\n\n문의 내용:\n${message}\n`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `[홈페이지 문의] ${name.replace(/[\r\n]+/g, " ")}`,
        html,
        text,
      }),
    });
    if (!r.ok) {
      // 방문자 정보는 로그에 남기지 않아요
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
