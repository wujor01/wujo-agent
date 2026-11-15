// Đóng gói server (kèm bản web của app) thành dist/wujoagent.tgz, file đính kèm mỗi bản phát hành trên GitHub:
//   npm install -g https://github.com/wujor01/wujo-agent/releases/latest/download/wujoagent.tgz
// Chạy:  node scripts/pack-server.mjs   (workflow release.yml gọi khi có tag v*).
// Cần bản web đã build trước (trong app:  npm run build:web).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = join(root, 'server');
const outDir = join(root, 'dist');
const out = join(outDir, 'wujoagent.tgz');

if (!existsSync(join(server, 'web', 'index.html'))) {
  console.error('Chưa có bản web của app (server/web). Chạy trong thư mục app:  npm run build:web');
  process.exit(1);
}

for (const f of readdirSync(server)) if (/^wujoagent-.*\.tgz$/.test(f)) rmSync(join(server, f));
// npm là file .cmd trên Windows nên phải qua shell; lệnh này không có tham số nào cần trích dẫn.
execFileSync('npm', ['pack', '--silent'], { cwd: server, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
const packed = readdirSync(server).find((f) => /^wujoagent-.*\.tgz$/.test(f));
if (!packed) {
  console.error('npm pack không tạo ra file .tgz.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
renameSync(join(server, packed), out);
console.log(`${packed} → dist/wujoagent.tgz (${Math.round(statSync(out).size / 1024)} KB)`);
