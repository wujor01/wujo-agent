// Deploy trang agent.wujo.dev. Chạy:  npm run deploy   (trong thư mục này, sau khi `wrangler login`
// hoặc khi có CLOUDFLARE_API_TOKEN). Viết bằng Node để chạy giống nhau trên Windows, macOS và CI.
//   1. đóng gói server thành landing/download/wujoagent.tgz
//   2. tạo bucket R2 chứa file APK nếu chưa có
//   3. chép APK từ EAS sang R2 (nếu ANDROID_APK_URL đã điền)
//   4. wrangler deploy
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const BUCKET = 'wujoagent-downloads';
const run = (cmd, args, stdio = 'inherit') =>
  execFileSync(cmd, args, { cwd: here, stdio, encoding: 'utf8', shell: process.platform === 'win32' });

run('node', ['pack-server.mjs']);

let hasBucket = true;
try {
  run('npx', ['wrangler', 'r2', 'bucket', 'info', BUCKET], ['ignore', 'ignore', 'ignore']);
} catch {
  hasBucket = false;
}
if (!hasBucket) run('npx', ['wrangler', 'r2', 'bucket', 'create', BUCKET, '--location', 'apac', '--no-update-config']);

run('node', ['sync-apk.mjs']);
run('npx', ['wrangler', 'deploy', '-c', 'wrangler.landing.jsonc']);
