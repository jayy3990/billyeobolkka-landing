// 다국어 페이지 만들기: src/*.template.html + i18n/<언어>.json → 언어별 HTML
//   한국어(기본) → /index.html, /apply.html      영어 → /en/index.html, /en/apply.html
// 실행: node build-i18n.js   (배포 때는 build.sh가 자동으로 불러요. 만들어진 HTML은 git에 올리지 않아요)
//
// 새 언어 추가: i18n/<코드>.json 만들기(ko.json 복사해서 번역) + 아래 LANGS에 한 줄 추가
// 새 페이지 추가: src/<이름>.template.html 만들기 + 아래 PAGES에 한 줄 추가 + json에 meta.<이름> 추가

const fs = require("fs");
const path = require("path");

const SITE = "https://billyeobolkka-landing.vercel.app";
const KO_FONT = '"Pretendard","Noto Sans KR","Malgun Gothic",system-ui,-apple-system,sans-serif';

// dir: 주소 앞부분('' 이면 맨 위). 첫 번째 언어가 기본 언어(x-default)예요.
const LANGS = [
  { code: "ko", dir: "", locale: "ko_KR", tag: "KO", font: KO_FONT, fontLink: "" },
  {
    code: "en", dir: "en", locale: "en_US", tag: "EN",
    font: '"Inter","Pretendard","Noto Sans KR",system-ui,-apple-system,"Segoe UI",sans-serif',
    fontLink: '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">',
  },
];
const PAGES = [
  { name: "index", path: "" },
  { name: "apply", path: "apply" },
];

const root = __dirname;
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const get = (obj, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const pageUrl = (lang, page) => (lang.dir ? "/" + lang.dir : "") + (page.path ? "/" + page.path : "") || "/";

function flatten(o, prefix = "", out = []) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix + k;
    if (v && typeof v === "object") flatten(v, key + ".", out);
    else out.push(key);
  }
  return out;
}

const dict = {};
for (const l of LANGS) dict[l.code] = JSON.parse(fs.readFileSync(path.join(root, "i18n", l.code + ".json"), "utf8"));

// 언어마다 빠진 문구가 없는지 확인
const base = new Set(flatten(dict[LANGS[0].code]));
for (const l of LANGS.slice(1)) {
  const mine = new Set(flatten(dict[l.code]));
  const missing = [...base].filter((k) => !mine.has(k));
  const extra = [...mine].filter((k) => !base.has(k));
  if (missing.length || extra.length) {
    console.error(`i18n/${l.code}.json 이 ${LANGS[0].code}.json 과 달라요. 빠짐: ${missing.join(", ") || "없음"} / 더 있음: ${extra.join(", ") || "없음"}`);
    process.exit(1);
  }
}

function seo(lang, page) {
  const t = dict[lang.code].meta[page.name];
  const self = SITE + pageUrl(lang, page);
  const alts = LANGS.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${SITE + pageUrl(l, page)}">`);
  alts.push(`<link rel="alternate" hreflang="x-default" href="${SITE + pageUrl(LANGS[0], page)}">`);
  const others = LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${l.locale}">`);
  return [
    `<title>${attr(t.title)}</title>`,
    `<meta name="description" content="${attr(t.description)}">`,
    `<link rel="canonical" href="${self}">`,
    ...alts,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${attr(dict[lang.code].brand)}">`,
    `<meta property="og:title" content="${attr(t.title)}">`,
    `<meta property="og:description" content="${attr(t.description)}">`,
    `<meta property="og:url" content="${self}">`,
    `<meta property="og:locale" content="${lang.locale}">`,
    ...others,
  ].join("\n");
}

function render(tpl, lang, page) {
  const d = dict[lang.code];
  const vars = {
    lang: lang.code,
    font: lang.font,
    fontLink: lang.fontLink,
    seo: seo(lang, page),
    home: pageUrl(lang, PAGES[0]),
    apply: SITE + pageUrl(lang, PAGES[1]),
    url_ko: pageUrl(LANGS[0], page),
    url_en: pageUrl(LANGS[1], page),
    cur_ko: lang.code === "ko" ? 'aria-current="true"' : "",
    cur_en: lang.code === "en" ? 'aria-current="true"' : "",
  };
  return tpl.replace(/\{\{\s*([\w.$]+)\s*(?:\|\s*(attr|json))?\s*\}\}/g, (m, key, filter) => {
    const v = key.startsWith("$") ? vars[key.slice(1)] : get(d, key);
    if (v === undefined) throw new Error(`${page.name} 틀에 쓴 {{${key}}} 문구를 ${lang.code}.json에서 못 찾았어요`);
    if (filter === "attr") return attr(v);
    if (filter === "json") return JSON.stringify(v).replace(/</g, "\\u003c");
    return String(v);
  });
}

for (const lang of LANGS) {
  for (const page of PAGES) {
    const tpl = fs.readFileSync(path.join(root, "src", page.name + ".template.html"), "utf8");
    const outDir = path.join(root, lang.dir);
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, page.name + ".html");
    fs.writeFileSync(out, render(tpl, lang, page));
    console.log("만들었어요:", path.relative(root, out));
  }
}
