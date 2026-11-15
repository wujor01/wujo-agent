// Deploy trang agent.wujo.dev. Chạy:  npm run deploy   (trong thư mục này, sau khi `wrangler login`
// hoặc khi có CLOUDFLARE_API_TOKEN và CLOUDFLARE_ACCOUNT_ID). Viết bằng Node để chạy giống nhau trên
// Windows, macOS và CI.
//   1. dựng trang nhật ký thay đổi từ CHANGELOG.md và CHANGELOG.en.md
//   2. tạo bucket R2 chứa file APK nếu chưa có
//   3. chép APK từ EAS sang R2 (nếu ANDROID_APK_URL đã điền)
//   4. wrangler deploy
import { build } from './build-changelog.mjs';
import { wrangler } from './wrangler-run.mjs';

const BUCKET = 'wujoagent-downloads';

build();

let hasBucket = true;
try {
  wrangler(['r2', 'bucket', 'info', BUCKET], ['ignore', 'ignore', 'ignore']);
} catch {
  hasBucket = false;
}
if (!hasBucket) wrangler(['r2', 'bucket', 'create', BUCKET, '--location', 'apac', '--no-update-config']);

await import('./sync-apk.mjs');
wrangler(['deploy', '-c', 'wrangler.landing.jsonc']);
