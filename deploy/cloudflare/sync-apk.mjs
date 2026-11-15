// Chép file APK Android (ANDROID_APK_URL trong wrangler.landing.jsonc, file của EAS bị xoá sau 14 ngày)
// sang bucket R2 mà worker phục vụ /download/android. Chạy trước mỗi lần deploy:
//   node sync-apk.mjs
// Link đã chép lần trước được ghi cạnh file APK (android/source.txt), nên deploy lại với cùng link thì
// không tải gì. Nếu EAS không còn giữ file, script cảnh báo và giữ nguyên APK đang có trong bucket.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BUCKET = 'wujoagent-downloads';
const APK = 'android/wujoagent.apk';
const SOURCE = 'android/source.txt';

const config = readFileSync(new URL('./wrangler.landing.jsonc', import.meta.url), 'utf8');
const url = /^\s*"ANDROID_APK_URL":\s*"([^"]*)"/m.exec(config)?.[1];
if (!url) {
  console.log('ANDROID_APK_URL đang trống, không có gì để chép.');
  process.exit(0);
}
// Chỉ nhận link file của EAS: script này tải file về rồi đưa lên cho mọi người cài.
if (!/^https:\/\/expo\.dev\/artifacts\/eas\/[\w.-]+\.apk$/.test(url)) {
  console.error(`ANDROID_APK_URL không phải link APK của EAS: ${url}`);
  process.exit(1);
}

const wrangler = (args, stdio = 'inherit') =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio, shell: process.platform === 'win32' });

let copied = '';
try {
  copied = wrangler(['r2', 'object', 'get', `${BUCKET}/${SOURCE}`, '--remote', '--pipe'], ['ignore', 'pipe', 'ignore']).trim();
} catch {
  // Chưa chép lần nào.
}
if (copied === url) {
  console.log(`APK trong R2 đã là ${url}.`);
  process.exit(0);
}

const response = await fetch(url);
if (!response.ok) {
  console.warn(`CẢNH BÁO: không tải được ${url} (HTTP ${response.status}); EAS chỉ giữ bản beta 14 ngày.`);
  console.warn(copied ? `/download/android vẫn phục vụ ${copied}.` : '/download/android chưa có APK.');
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), 'apk-'));
const apk = join(dir, 'wujoagent.apk');
writeFileSync(apk, Buffer.from(await response.arrayBuffer()));
wrangler([
  'r2', 'object', 'put', `${BUCKET}/${APK}`, '--remote', '--file', apk,
  '--content-type', 'application/vnd.android.package-archive',
  '--content-disposition', 'attachment; filename="WujoAgent.apk"',
]);
const source = join(dir, 'source.txt');
writeFileSync(source, url);
wrangler(['r2', 'object', 'put', `${BUCKET}/${SOURCE}`, '--remote', '--file', source, '--content-type', 'text/plain']);
console.log(`Đã chép ${url} sang ${BUCKET}/${APK}.`);
