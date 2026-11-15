// In ra phần ghi chú của một phiên bản, lấy từ CHANGELOG.en.md rồi CHANGELOG.md, để làm nội dung GitHub Release:
//   node scripts/release-notes.mjs 1.0.0
// Thoát với mã 1 nếu changelog chưa có mục cho phiên bản đó (để không phát hành thiếu ghi chú).
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('Dùng: node scripts/release-notes.mjs <phiên bản>');
  process.exit(1);
}

export function section(markdown, v) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## \\[?${v.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

const en = section(readFileSync(new URL('../CHANGELOG.en.md', import.meta.url), 'utf8'), version);
const vi = section(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version);
if (!en || !vi) {
  console.error(`CHANGELOG.md hoặc CHANGELOG.en.md chưa có mục cho phiên bản ${version}.`);
  process.exit(1);
}

console.log(`Install or update:

\`\`\`
npm install -g https://github.com/wujor01/wujo-agent/releases/download/v${version}/wujoagent.tgz
\`\`\`

${en}

---

## Tiếng Việt

${vi}`);
