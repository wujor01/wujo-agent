// Đóng gói server (kèm bản web của app) thành landing/download/wujoagent.tgz, file mà trang chủ hướng dẫn cài:
//   npm install -g https://agent.wujo.dev/download/wujoagent.tgz
// Chạy trước mỗi lần deploy:  node pack-server.mjs
// Cần bản web đã build (app: npm run build:web). File .tgz không commit vào git.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const server = join(root, 'server');
const outDir = join(root, 'landing', 'download');
const out = join(outDir, 'wujoagent.tgz');

if (!existsSync(join(server, 'web', 'index.html'))) {
  console.error('Chưa có bản web của app (server/web). Chạy trong thư mục app:  npm run build:web');
  process.exit(1);
}

for (const f of readdirSync(server)) if (/^wujoagent-.*\.tgz$/.test(f)) rmSync(join(server, f));
execFileSync('npm', ['pack', '--silent'], { cwd: server, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
const packed = readdirSync(server).find((f) => /^wujoagent-.*\.tgz$/.test(f));
if (!packed) {
  console.error('npm pack không tạo ra file .tgz.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
renameSync(join(server, packed), out);
console.log(`${packed} → landing/download/wujoagent.tgz (${Math.round(statSync(out).size / 1024)} KB)`);
