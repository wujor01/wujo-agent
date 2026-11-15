// Dựng trang nhật ký thay đổi của landing từ CHANGELOG.md (tiếng Việt) và CHANGELOG.en.md (tiếng Anh):
//   landing/changelog.html   và   landing/en/changelog.html
// Chạy:  node build-changelog.mjs   (deploy.mjs và `npm run dev` tự gọi). Hai file HTML không commit vào git.
//
// Chỉ hiểu phần Markdown mà changelog dùng: tiêu đề ##/###, danh sách "- ", đoạn văn, `mã`, **đậm**
// và [chữ](link). Mọi thứ khác được in nguyên văn (đã escape), không có HTML thô nào lọt qua.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const SITE = 'https://agent.wujo.dev';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Markdown của changelog → HTML. Bỏ tiêu đề cấp 1 (trang đã có tiêu đề riêng). */
export function render(markdown) {
  const out = [];
  let list = false;
  let para = [];
  let started = false;
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list) { out.push('</ul>'); list = false; }
  };
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    // Phần mở đầu trước mục phiên bản đầu tiên là ghi chú cho người bảo trì, không đưa lên trang.
    if (!started && !line.startsWith('## ')) continue;
    started = true;
    if (!line.trim()) { flush(); continue; }
    if (line.startsWith('## ')) {
      flush();
      // "## [1.0.0] - 2026-11-15" → số phiên bản và ngày
      const m = /^## \[?([^\]\s]+)\]?(?:\s+-\s+(.+))?$/.exec(line);
      const version = m ? m[1] : line.slice(3);
      const date = m && m[2] ? ` <span class="date">${escape(m[2])}</span>` : '';
      out.push(`<h2 id="v${escape(version)}">${escape(version)}${date}</h2>`);
    } else if (line.startsWith('### ')) {
      flush();
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
    } else if (/^[-*] /.test(line)) {
      if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (list && /^\s+\S/.test(raw)) {
      // dòng nối tiếp của một mục danh sách
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out.join('\n');
}

const TEXT = {
  vi: {
    lang: 'vi', title: 'Nhật ký thay đổi', home: 'Trang chủ', homeHref: '/', other: 'English', otherHref: '/en/changelog?lang=en',
    otherLang: 'en', path: '/changelog', desc: 'Các thay đổi của WujoAgent qua từng phiên bản.', nav: 'Điều hướng',
    source: 'Mã nguồn và các bản phát hành nằm trên',
  },
  en: {
    lang: 'en', title: 'Changelog', home: 'Home', homeHref: '/en/', other: 'Tiếng Việt', otherHref: '/changelog?lang=vi',
    otherLang: 'vi', path: '/en/changelog', desc: 'What changed in each WujoAgent release.', nav: 'Navigation',
    source: 'Source code and releases are on',
  },
};

function page(t, body) {
  return `<!doctype html>
<html lang="${t.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t.title} — WujoAgent</title>
  <meta name="description" content="${t.desc}">
  <link rel="canonical" href="${SITE}${t.path}">
  <link rel="alternate" hreflang="vi" href="${SITE}/changelog">
  <link rel="alternate" hreflang="en" href="${SITE}/en/changelog">
  <meta name="theme-color" content="#1b1a18">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="brand" href="${t.homeHref}"><img src="/icon.png" alt="" width="32" height="32">WujoAgent</a>
    <nav aria-label="${t.nav}"><a href="${t.homeHref}">${t.home}</a><a href="${t.otherHref}" lang="${t.otherLang}">${t.other}</a></nav>
  </header>
  <main class="doc changelog">
    <h1>${t.title}</h1>
${body}
    <p class="source">${t.source} <a href="https://github.com/wujor01/wujo-agent/releases">GitHub</a>.</p>
  </main>
  <footer><div class="links"><a href="${t.homeHref}">${t.home}</a><a href="mailto:contact@wujo.dev">contact@wujo.dev</a></div></footer>
</div>
</body>
</html>
`;
}

export function build() {
  const jobs = [
    ['CHANGELOG.md', 'landing/changelog.html', TEXT.vi],
    ['CHANGELOG.en.md', 'landing/en/changelog.html', TEXT.en],
  ];
  for (const [source, target, t] of jobs) {
    const html = page(t, render(readFileSync(new URL(source, root), 'utf8')));
    writeFileSync(new URL(target, root), html);
    console.log(`${source} → ${target}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) build();
