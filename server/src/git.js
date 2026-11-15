import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './manager.js';

// Chỉ những thao tác này được gọi từ xa. Không qua shell, tham số cố định.
export const GIT_OPS = {
  fetch: ['fetch', '--all', '--prune'],
  pull: ['pull', '--ff-only'],
  push: ['push'],
};

function git(cwd, args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        // Không cho git dừng lại hỏi mật khẩu: không ai ngồi trước máy để gõ.
        env: {
          ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C',
          // Remote SSH: không hỏi passphrase hay xác nhận host key, thất bại ngay thay vì treo.
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -oBatchMode=yes',
        },
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          timedOut: Boolean(err && err.killed),
          missing: Boolean(err && err.code === 'ENOENT'),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

/** Thông tin repo của một thư mục; { repo: false } nếu không phải git repo. */
export async function gitInfo(cwd) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.missing) return { repo: false, reason: 'Máy chủ chưa cài git.' };
  if (!top.ok) return { repo: false };

  const [status, log, remote] = await Promise.all([
    git(cwd, ['status', '--porcelain=v2', '--branch', '-z']),
    git(cwd, ['-c', 'core.quotepath=false', 'log', '-10', '--pretty=format:%h%x09%an%x09%ar%x09%s']),
    git(cwd, ['remote', 'get-url', 'origin']),
  ]);

  const info = {
    repo: true,
    root: top.stdout.trim(),
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    remote: remote.ok ? stripCredentials(remote.stdout.trim()) : null,
    files: [],
    commits: [],
  };

  if (!status.ok) {
    // Không đọc được trạng thái thì nói rõ, đừng để app hiểu nhầm là repo sạch.
    info.error = status.timedOut ? 'git status chạy quá lâu.' : (status.stderr.trim() || 'Không đọc được trạng thái repo.');
  }

  // Với -z mỗi mục kết thúc bằng NUL và tên file giữ nguyên văn (không bị bọc ngoặc kép).
  const entries = status.ok ? status.stdout.split('\0') : [];
  for (let n = 0; n < entries.length; n++) {
    const line = entries[n];
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      if (head === '(detached)') info.detached = true;
      else info.branch = head;
    } else if (line.startsWith('# branch.upstream ')) {
      info.upstream = line.slice('# branch.upstream '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { info.ahead = Number(m[1]); info.behind = Number(m[2]); }
    } else if (line.startsWith('1 ')) {
      // "1 XY sub mH mI mW hH hI path"
      const parts = line.split(' ');
      info.files.push({ status: parts[1].replace(/\./g, ' ').trim() || 'M', path: parts.slice(8).join(' ') });
    } else if (line.startsWith('2 ')) {
      // "2 XY sub mH mI mW hH hI Xscore path", mục kế tiếp là đường dẫn cũ
      const parts = line.split(' ');
      info.files.push({ status: parts[1].replace(/\./g, ' ').trim() || 'R', path: parts.slice(9).join(' ') });
      n++;
    } else if (line.startsWith('u ')) {
      info.files.push({ status: 'U', path: line.split(' ').slice(10).join(' ') });
    } else if (line.startsWith('? ')) {
      info.files.push({ status: '?', path: line.slice(2) });
    }
  }

  // Số dòng thêm/bớt của từng file so với commit gần nhất (file chưa theo dõi không có số).
  const numstat = await git(cwd, ['-c', 'core.quotepath=false', 'diff', 'HEAD', '--numstat', '--no-renames']);
  if (numstat.ok) {
    const counts = new Map();
    for (const line of numstat.stdout.split('\n')) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (m) counts.set(m[3], { added: m[1] === '-' ? null : Number(m[1]), removed: m[2] === '-' ? null : Number(m[2]) });
    }
    for (const f of info.files) Object.assign(f, counts.get(f.path) || {});
  }

  if (log.ok) {
    for (const line of log.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [hash, author, when, ...subject] = line.split('\t');
      info.commits.push({ hash, author, when, subject: subject.join('\t') });
    }
  }
  return info;
}

/**
 * Đường dẫn thật của `p`. File có thể không còn (đã bị xoá khỏi repo): lấy đường dẫn thật của
 * thư mục cha gần nhất còn tồn tại rồi nối phần còn lại vào.
 */
export function realPath(p) {
  let current = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

const MAX_DIFF = 300 * 1024;

/**
 * Thay đổi của một file so với commit gần nhất, dạng unified diff.
 * `file` là đường dẫn tuyệt đối hoặc tương đối so với `cwd`; phải nằm trong repo.
 */
export async function gitDiff(cwd, file) {
  if (typeof file !== 'string' || !file.trim()) throw new HttpError(400, 'Thiếu tên file.');
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok) throw new HttpError(400, 'Thư mục này không phải git repo.');
  // So sánh trên đường dẫn thật: cùng một thư mục có thể được viết theo nhiều cách (tên ngắn 8.3 của
  // Windows như RUNNER~1, symlink như /tmp → /private/tmp trên macOS), còn git luôn trả về dạng đầy đủ.
  const root = realPath(top.stdout.trim());
  const abs = realPath(path.resolve(cwd, file.trim()));
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new HttpError(400, 'File nằm ngoài repo này.');
  const shown = rel.split(path.sep).join('/');
  const out = { file: shown, diff: '', untracked: false, binary: false, deleted: false, truncated: false };

  const st = await git(root, ['status', '--porcelain=v2', '-z', '--', rel]);
  const entry = st.ok ? st.stdout.split('\0')[0] : '';
  if (entry.startsWith('? ')) {
    // File mới chưa được git theo dõi: hiện toàn bộ nội dung như phần thêm vào.
    out.untracked = true;
    let buf;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) { out.diff = '(thư mục mới chưa được git theo dõi)'; return out; }
      const fd = fs.openSync(abs, 'r');
      buf = Buffer.alloc(Math.min(stat.size, MAX_DIFF));
      fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      out.truncated = stat.size > MAX_DIFF;
    } catch {
      throw new HttpError(404, `Không đọc được file: ${shown}`);
    }
    if (buf.includes(0)) { out.binary = true; return out; }
    const lines = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    out.diff = `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n');
    return out;
  }

  // Repo chưa có commit nào thì không có HEAD: so với index.
  const hasHead = (await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])).ok;
  const args = hasHead ? ['diff', 'HEAD'] : ['diff', '--cached'];
  const res = await git(root, ['-c', 'core.quotepath=false', ...args, '--no-color', '--no-ext-diff', '--', rel]);
  if (!res.ok) throw new HttpError(502, stripCredentials(res.stderr.trim()) || 'git diff thất bại.');
  let text = res.stdout.replace(/\r\n/g, '\n');
  if (/^Binary files .* differ$/m.test(text)) { out.binary = true; return out; }
  out.deleted = /^deleted file mode/m.test(text);
  // Bỏ phần đầu (diff --git, index, ---, +++): app đã hiện tên file.
  const at = text.indexOf('\n@@');
  if (at >= 0) text = text.slice(at + 1);
  else if (text.startsWith('diff --git')) text = '';
  if (text.length > MAX_DIFF) { text = text.slice(0, MAX_DIFF); out.truncated = true; }
  out.diff = text.replace(/\n$/, '');
  return out;
}

/** Chạy fetch / pull / push. Trả output nguyên văn để người dùng tự đọc lỗi. */
export async function gitRun(cwd, op) {
  const args = GIT_OPS[op];
  if (!args) throw new HttpError(400, `Thao tác git không hỗ trợ: ${op}. Dùng: ${Object.keys(GIT_OPS).join(', ')}.`);
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok) throw new HttpError(400, 'Thư mục này không phải git repo.');
  const res = await git(cwd, args, { timeout: 120000 });
  let output = stripCredentials((res.stdout + res.stderr).trim());
  if (res.timedOut) output += '\n(Quá 120 giây, đã dừng. Có thể git đang chờ đăng nhập trên máy chủ.)';
  return { ok: res.ok, op, output: output || (res.ok ? 'Xong.' : 'Thất bại, không có thông báo.') };
}

// Remote dạng https://user:token@host/... không được lộ ra app.
function stripCredentials(text) {
  return text.replace(/(https?:\/\/)[^/@\s]+@/g, '$1');
}
