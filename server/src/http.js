import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './manager.js';
import { gitInfo, gitRun, gitDiff } from './git.js';
import { t, withLang, langOf } from './lang.js';

const MAX_BODY = 1024 * 1024; // 1 MB
const MAX_FAILS = 10; // số lần sai token mỗi phút, mỗi IP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.map': 'application/json',
};

export function createServer({ manager, token, webDir, capabilities, push, name = os.hostname(), version = '1.0.0' }) {
  const fails = new Map(); // ip -> { count, resetAt }

  function checkAuth(req) {
    const ip = req.socket.remoteAddress || '';
    const now = Date.now();
    const header = req.headers.authorization || '';
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(token).digest();
    // Token đúng luôn được vào: một thiết bị khác cùng IP đoán sai không khoá được người dùng thật.
    if (given && crypto.timingSafeEqual(a, b)) return;
    if (fails.size > 1000) for (const [k, x] of fails) if (x.resetAt < now) fails.delete(k);
    let f = fails.get(ip);
    if (f && f.resetAt < now) { fails.delete(ip); f = undefined; }
    if (f && f.count >= MAX_FAILS) throw new HttpError(429, t('Sai token quá nhiều lần. Thử lại sau một phút.', 'Too many wrong tokens. Try again in a minute.'));
    if (!f) { f = { count: 0, resetAt: now + 60000 }; fails.set(ip, f); }
    f.count++;
    throw new HttpError(401, t('Token không đúng.', 'Wrong token.'));
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, t('Nội dung gửi lên quá lớn (tối đa 1 MB).', 'The request is too large (1 MB at most).'));
      chunks.push(chunk);
    }
    if (!size) return {};
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not object');
      return body;
    } catch {
      throw new HttpError(400, t('JSON không hợp lệ.', 'Invalid JSON.'));
    }
  }

  function send(res, status, body) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      ...cors(),
    });
    res.end(data);
  }

  // App native và bản web chạy từ dev server ở origin khác; quyền truy cập do token quyết định.
  function cors() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    };
  }

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // bỏ "api"
    const method = req.method;

    if (parts[0] === 'health' && method === 'GET') {
      return send(res, 200, { ok: true, app: 'claude-sessions', version }); // không lộ tên máy khi chưa có token
    }
    checkAuth(req);

    // Điện thoại bật / tắt thông báo đẩy cho máy chủ này.
    if (parts[0] === 'push' && method === 'POST' && (parts[1] === 'register' || parts[1] === 'unregister')) {
      if (!push) throw new HttpError(501, t('Máy chủ này không hỗ trợ.', 'This server does not support it.'));
      const body = await readJson(req);
      return send(res, 200, parts[1] === 'register' ? push.register(body) : push.unregister(body.token));
    }

    if (parts[0] === 'info' && method === 'GET') {
      return send(res, 200, { name, version, home: os.homedir(), platform: process.platform });
    }

    if (parts[0] === 'dirs' && method === 'GET') {
      return send(res, 200, listDirs(url.searchParams.get('path') || ''));
    }

    // git theo thư mục workspace (không cần có session)
    // thay đổi của một file trong repo chứa thư mục `path`
    if (parts[0] === 'git' && parts[1] === 'diff' && method === 'GET') {
      return send(res, 200, await gitDiff(existingDir(url.searchParams.get('path')), url.searchParams.get('file')));
    }

    if (parts[0] === 'git' && !parts[1]) {
      if (method === 'GET') return send(res, 200, await gitInfo(existingDir(url.searchParams.get('path'))));
      if (method === 'POST') {
        const body = await readJson(req);
        const dir = existingDir(body.path);
        const result = await gitRun(dir, body.op);
        return send(res, 200, { ...result, info: await gitInfo(dir) });
      }
    }

    if (parts[0] === 'workspaces' && method === 'GET') {
      return send(res, 200, await manager.workspaces(url.searchParams.get('root') || ''));
    }

    if (parts[0] === 'workspace-sessions' && method === 'GET') {
      return send(res, 200, await manager.workspaceSessions(url.searchParams.get('path') || ''));
    }

    if (parts[0] === 'sessions') {
      const id = parts[1];
      const sub = parts[2];
      if (!id) {
        if (method === 'GET') return send(res, 200, { sessions: manager.list() });
        if (method === 'POST') return send(res, 201, { session: await manager.open(await readJson(req)) });
      } else if (!sub) {
        if (method === 'GET') return send(res, 200, { session: manager.get(id) });
        if (method === 'PATCH') return send(res, 200, { session: manager.patch(id, await readJson(req)) });
        if (method === 'DELETE') { manager.remove(id); return send(res, 200, { ok: true }); }
      } else if (sub === 'events' && method === 'GET') {
        const num = (k, d) => {
          const n = Number(url.searchParams.get(k));
          return Number.isFinite(n) && url.searchParams.has(k) ? n : d;
        };
        const waitMs = Math.max(0, Math.min(num('wait', 25), 55)) * 1000;
        // Kết nối đóng trước khi trả lời xong nghĩa là app đã rời đi.
        const gone = new AbortController();
        res.on('close', () => { if (!res.writableFinished) gone.abort(); });
        const out = await manager.poll(id, {
          after: num('after', 0), v: num('v', -1), epoch: num('epoch', undefined), waitMs, signal: gone.signal,
        });
        if (res.destroyed) return;
        return send(res, 200, out);
      } else if (sub === 'messages' && method === 'POST') {
        const body = await readJson(req);
        return send(res, 202, { session: manager.send(id, body.text) });
      } else if (sub === 'permission' && method === 'POST') {
        return send(res, 200, { session: manager.permission(id, await readJson(req)) });
      } else if (sub === 'queue' && method === 'DELETE') {
        return send(res, 200, { session: manager.clearQueue(id) });
      } else if (sub === 'interrupt' && method === 'POST') {
        return send(res, 200, { session: manager.interrupt(id) });
      } else if (sub === 'capabilities' && method === 'GET') {
        // model, lệnh gạch chéo và MCP server dùng được trong thư mục của session
        if (!capabilities) throw new HttpError(501, t('Máy chủ này không hỗ trợ.', 'This server does not support it.'));
        const session = manager.get(id);
        try {
          return send(res, 200, await capabilities(session.cwd, { fresh: url.searchParams.get('fresh') === '1' }));
        } catch (err) {
          throw new HttpError(502, t(`Không hỏi được Claude Code: ${err?.message || err}`, `Could not reach Claude Code: ${err?.message || err}`));
        }
      } else if (sub === 'git') {
        const session = manager.get(id);
        if (method === 'GET') return send(res, 200, await gitInfo(session.cwd));
        if (method === 'POST') {
          const body = await readJson(req);
          const result = await gitRun(session.cwd, body.op);
          return send(res, 200, { ...result, info: await gitInfo(session.cwd) });
        }
      }
    }
    throw new HttpError(404, t('Không có đường dẫn này.', 'No such path.'));
  }

  function serveStatic(req, res, url) {
    if (!webDir || !fs.existsSync(webDir)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('WujoAgent đang chạy. Bản web chưa được build (xem README: npm run build:web).');
    }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, t('Đường dẫn không hợp lệ.', 'Invalid path.')); }
    if (rel.endsWith('/')) rel += 'index.html';
    const root = path.resolve(webDir);
    let file = path.join(root, rel);
    // Chặn thoát khỏi thư mục web bằng ".." (kể cả sang thư mục anh em có tên bắt đầu giống).
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    let stat;
    try { stat = fs.statSync(file); } catch { /* không có: trả index.html */ }
    if (!stat || !stat.isFile()) file = path.join(root, 'index.html');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const stream = fs.createReadStream(file);
    stream.on('open', () => { res.writeHead(200, { 'Content-Type': type }); stream.pipe(res); });
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end();
    });
  }

  return http.createServer((req, res) => withLang(langOf(req.headers['accept-language']), async () => {
    try {
      let url;
      try { url = new URL(req.url, 'http://x'); } catch { throw new HttpError(400, t('Đường dẫn không hợp lệ.', 'Invalid path.')); }
      if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET') throw new HttpError(404, t('Không có đường dẫn này.', 'No such path.'));
      return serveStatic(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: t(`Lỗi server: ${err?.message || err}`, `Server error: ${err?.message || err}`) });
    }
  }));
}

function existingDir(input) {
  if (typeof input !== 'string' || !input.trim()) throw new HttpError(400, t('Thiếu thư mục (path).', 'Missing folder (path).'));
  const dir = path.resolve(input.trim());
  let stat;
  try { stat = fs.statSync(dir); } catch { /* báo lỗi bên dưới */ }
  if (!stat || !stat.isDirectory()) throw new HttpError(400, t(`Thư mục không tồn tại: ${dir}`, `Folder does not exist: ${dir}`));
  return dir;
}

/** Thời điểm thư mục được sửa lần cuối (ms); 0 nếu không đọc được. */
export function modifiedAt(dir) {
  try { return Math.round(fs.statSync(dir).mtimeMs); } catch { return 0; }
}

/** Liệt kê thư mục con để chọn thư mục làm việc từ điện thoại. */
export function listDirs(input) {
  if (!input) {
    const roots = [{ name: 'Home', path: os.homedir() }];
    if (process.platform === 'win32') {
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${letter}:\\`;
        if (fs.existsSync(root)) roots.push({ name: root, path: root });
      }
    } else {
      roots.push({ name: '/', path: '/' });
    }
    return { path: '', parent: null, dirs: roots };
  }
  const dir = path.resolve(input);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new HttpError(400, t(`Không đọc được thư mục: ${dir}`, `Could not read the folder: ${dir}`));
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && !e.name.startsWith('$'))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), modifiedAt: modifiedAt(path.join(dir, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? '' : parent,
    isRepo: fs.existsSync(path.join(dir, '.git')),
    dirs,
  };
}
