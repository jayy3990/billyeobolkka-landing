// 도서관 목록 스냅샷(data/libraries.json)을 읽어서 "허용된 도서관 코드" 검사에 써요.
// 스냅샷은 scripts/sync-libraries.js 로 만들어요. 정보나루를 호출하지 않아요.

const fs = require("fs");
const path = require("path");

let loaded = null;

function load() {
  if (loaded) return loaded;
  const file = path.join(__dirname, "..", "..", "data", "libraries.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const byCode = new Map(json.libs.map((l) => [l.c, l]));
  loaded = { byCode, count: json.libs.length, generated: json.generated };
  return loaded;
}

const isKnownLibrary = (code) => typeof code === "string" && /^\d{5,8}$/.test(code) && load().byCode.has(code);
const getLibrary = (code) => load().byCode.get(code) || null;
function reset(replacement) { loaded = replacement || null; } // 시험용

module.exports = { isKnownLibrary, getLibrary, reset };
