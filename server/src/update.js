import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const REPO = 'wujor01/wujo-agent';
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const PACKAGE_URL = `https://github.com/${REPO}/releases/latest/download/wujoagent.tgz`;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(here, '..');
export const currentVersion = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8')).version;

/** So hai số phiên bản dạng "1.2.3": âm nếu a cũ hơn b, 0 nếu bằng, dương nếu a mới hơn. Phần không phải số coi như 0. */
export function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Bản phát hành mới nhất trên GitHub, hoặc null nếu không hỏi được (mất mạng, bị giới hạn lượt).
 * Kết quả được nhớ lại trong thư mục dữ liệu 6 giờ: GitHub chỉ cho 60 lượt hỏi mỗi giờ khi không đăng nhập.
 * Yêu cầu này không mang theo thông tin gì của người dùng. Tắt hẳn bằng biến môi trường WA_NO_UPDATE_CHECK=1.
 */
export async function latestVersion(dataDir, { fetchImpl = globalThis.fetch, force = false, now = Date.now() } = {}) {
  if (process.env.WA_NO_UPDATE_CHECK === '1' && !force) return null;
  const file = dataDir ? path.join(dataDir, 'update-check.json') : null;
  if (file && !force) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.version && now - saved.at < CHECK_EVERY) return saved.version;
    } catch { /* chưa có hoặc hỏng: hỏi lại */ }
  }
  try {
    const res = await fetchImpl(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wujoagent' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const version = String((await res.json()).tag_name || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
    if (file) { try { fs.writeFileSync(file, JSON.stringify({ version, at: now })); } catch { /* không ghi được cũng không sao */ } }
    return version;
  } catch {
    return null;
  }
}

/** { current, latest, newer }. `latest` là null khi không hỏi được. */
export async function checkForUpdate(dataDir, opts) {
  const latest = await latestVersion(dataDir, opts);
  return { current: currentVersion, latest, newer: Boolean(latest) && compareVersions(latest, currentVersion) > 0 };
}

/** Server đang chạy từ mã nguồn (git clone + npm link) hay từ gói cài toàn cục của npm? */
export function installKind() {
  if (fs.existsSync(path.resolve(serverRoot, '..', '.git'))) return 'source';
  return 'package';
}

/**
 * Cài bản mới nhất. Chỉ áp dụng cho bản cài bằng npm; bản chạy từ mã nguồn thì người dùng tự `git pull`
 * (script này không đụng vào thư mục làm việc của họ). Trả về mã thoát của npm.
 */
export function installLatest() {
  return new Promise((resolve) => {
    // npm là file .cmd trên Windows nên phải qua shell; tham số là hằng số, không có gì từ bên ngoài.
    const child = spawn('npm', ['install', '-g', PACKAGE_URL], { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
