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

if (process.env.CI && !(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)) {
  console.error('Thiếu CLOUDFLARE_API_TOKEN hoặc CLOUDFLARE_ACCOUNT_ID. Thêm hai secret này cho repo (docs/release.md mục 4b).');
  process.exit(1);
}

build();

// Chỉ tạo bucket khi wrangler nói rõ là chưa có; lỗi khác (sai token, thiếu quyền R2) phải hiện ra nguyên văn.
try {
  wrangler(['r2', 'bucket', 'info', BUCKET], ['ignore', 'pipe', 'pipe']);
} catch (err) {
  const output = `${err.stdout || ''}${err.stderr || ''}`;
  if (!/not found|does not exist|10006/i.test(output)) {
    console.error(output.trim() || err.message);
    console.error('Không hỏi được bucket R2. Kiểm tra token có quyền "Workers R2 Storage: Edit" và đúng tài khoản.');
    process.exit(1);
  }
  wrangler(['r2', 'bucket', 'create', BUCKET, '--location', 'apac', '--no-update-config']);
}

await import('./sync-apk.mjs');
wrangler(['deploy', '-c', 'wrangler.landing.jsonc']);
