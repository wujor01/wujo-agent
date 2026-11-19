// `wa restart`: dừng server WujoAgent / VS Code web đang chạy (kể cả bản bị treo còn giữ cổng) rồi chạy lại ở nền.
//
// Chỉ dừng tiến trình khi nhận ra nó là của mình: server WujoAgent phải trả lời /api/health đúng tên, hoặc tiến
// trình giữ cổng phải là node / VS Code. Tiến trình lạ đang giữ cổng thì báo lỗi, không đụng tới.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { t } from './lang.js';
import { DEFAULT_CODE_PORT, portBusy, serverBinary } from './code.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(here, '../bin/wujoagent.js');
const win = process.platform === 'win32';

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
  });
}

/** PID đang nghe ở cổng TCP `port`, từ kết quả `netstat -ano` (Windows). */
export function parseNetstat(out, port) {
  const pids = new Set();
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (m && Number(m[1]) === Number(port) && Number(m[2]) > 0) pids.add(Number(m[2]));
  }
  return [...pids];
}

/** Các PID đang nghe ở cổng `port` trên máy này. */
export async function listeners(port) {
  if (win) return parseNetstat((await run('netstat', ['-ano', '-p', 'TCP'])).out, port);
  const out = (await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])).out;
  return [...new Set(out.split(/\s+/).map(Number).filter((n) => n > 0))];
}

async function processName(pid) {
  if (win) {
    const out = (await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])).out;
    return (/^"([^"]+)"/.exec(out.trim()) || [])[1] || '';
  }
  return (await run('ps', ['-p', String(pid), '-o', 'comm='])).out.trim();
}

/** Tên tiến trình có phải thứ WujoAgent khởi chạy không (node cho server; code / code-tunnel / node cho VS Code web). */
export function isOurs(name) {
  return /^(node|code|code-tunnel|code-server|code-insiders)(\.exe|\.cmd)?$/i.test(path.basename(String(name).trim()));
}

async function kill(pid) {
  // Dừng cả các tiến trình con: VS Code web sinh ra extension host, terminal, tiến trình Claude.
  if (win) await run('taskkill', ['/PID', String(pid), '/T', '/F']);
  else { try { process.kill(pid, 'SIGTERM'); } catch { /* đã thoát */ } }
}

async function waitFor(check, tries = 40, gap = 500) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, gap));
  }
  return false;
}

async function isWujoServer(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
    return (await res.json()).app === 'claude-sessions';
  } catch {
    return false;
  }
}

/** Dừng thứ đang giữ cổng. Trả về 'free' (không có gì), 'stopped', hoặc ném lỗi nếu là tiến trình lạ / không dừng được. */
export async function stopPort(port, { wujo = false } = {}) {
  const pids = await listeners(port);
  if (!pids.length) {
    if (!(await portBusy(port))) return 'free';
    throw new Error(t(`Cổng ${port} đang bị dùng nhưng không tìm ra tiến trình nào (có thể của người dùng khác). Dừng nó bằng tay.`,
      `Port ${port} is in use but no process could be found for it (it may belong to another user). Stop it by hand.`));
  }
  const known = wujo && await isWujoServer(port);
  for (const pid of pids) {
    const name = await processName(pid);
    if (!known && !isOurs(name)) {
      throw new Error(t(`Cổng ${port} đang do "${name || pid}" giữ, không phải WujoAgent. Không dừng tiến trình lạ; đổi cổng hoặc tự dừng nó.`,
        `Port ${port} is held by "${name || pid}", which is not WujoAgent. Not stopping a foreign process; change the port or stop it yourself.`));
    }
    await kill(pid);
  }
  if (!(await waitFor(async () => !(await portBusy(port))))) {
    throw new Error(t(`Không dừng được tiến trình ở cổng ${port}.`, `Could not stop the process on port ${port}.`));
  }
  return 'stopped';
}

/** Chạy `wa <args>` ở nền, tách khỏi terminal này; kết quả in ra ghi vào file nhật ký trong thư mục dữ liệu. */
export function startDetached(args, logFile) {
  const out = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, [BIN, ...args], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  fs.closeSync(out);
  return child.pid;
}

/** Tuỳ chọn của lần `wa code` gần nhất (cổng, thư mục), để `wa restart` chạy lại đúng như cũ. */
export function readCodeOptions(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'code.json'), 'utf8')) || {}; } catch { return {}; }
}

export function codeArgs(opts = {}) {
  const args = ['code'];
  if (opts.folder) args.push(opts.folder);
  if (opts.port && opts.port !== DEFAULT_CODE_PORT) args.push('--port', String(opts.port));
  if (opts.httpsPort) args.push('--https-port', String(opts.httpsPort));
  // Không truyền --tailscale: cấu hình `tailscale serve --bg` tự giữ nguyên, và nếu người dùng đã tắt thì không bật lại.
  args.push('--no-qr', '--accept-license');
  return args;
}

/**
 * Khởi động lại. `what`: 'serve' | 'code' | undefined (cả hai thứ đang chạy; không có gì chạy thì chạy server).
 * Trả về danh sách dòng mô tả việc đã làm.
 */
export async function restart({ cfg, what, log = console.log }) {
  const code = readCodeOptions(cfg.dir);
  const codePort = code.port || DEFAULT_CODE_PORT;
  const serveBusy = await portBusy(cfg.port);
  const codeBusy = await portBusy(codePort);
  const doServe = what === 'serve' || (!what && (serveBusy || !codeBusy));
  const doCode = what === 'code' || (!what && codeBusy);

  if (doServe) {
    const was = await stopPort(cfg.port, { wujo: true });
    if (was === 'stopped') log(t('Đã dừng server WujoAgent (lượt chat đang chạy dở bị ngắt).', 'Stopped the WujoAgent server (any chat turn in progress was interrupted).'));
    startDetached(['serve', '--no-qr'], path.join(cfg.dir, 'startup-serve.log'));
    const up = await waitFor(() => isWujoServer(cfg.port));
    log(up
      ? t(`Server WujoAgent đang chạy ở cổng ${cfg.port}.`, `The WujoAgent server is running on port ${cfg.port}.`)
      : t(`Server chưa lên. Xem ${path.join(cfg.dir, 'startup-serve.log')}`, `The server did not come up. See ${path.join(cfg.dir, 'startup-serve.log')}`));
    if (!up) process.exitCode = 1;
  }
  if (doCode) {
    if (!serverBinary()) {
      throw new Error(t('Chưa chạy "wa code" lần nào trên máy này. Chạy "wa code" trước (lần đầu VS Code hỏi điều khoản giấy phép).',
        '"wa code" has never been run on this machine. Run "wa code" first (on its first run VS Code asks about its license terms).'));
    }
    const was = await stopPort(codePort);
    if (was === 'stopped') log(t('Đã dừng VS Code web (terminal và lượt Claude đang chạy trong đó bị ngắt).', 'Stopped VS Code for the web (terminals and Claude turns running in it were interrupted).'));
    const logFile = path.join(cfg.dir, 'startup-code.log');
    startDetached(codeArgs(code), logFile);
    const up = await waitFor(() => portBusy(codePort), 120);
    if (up) {
      // Chờ `wa code` in xong địa chỉ rồi đưa lại cho người dùng.
      await waitFor(() => /Ctrl\+C/.test(fs.readFileSync(logFile, 'utf8')), 60);
      log(fs.readFileSync(logFile, 'utf8').trim());
    } else {
      log(t(`VS Code web chưa lên. Xem ${logFile}`, `VS Code for the web did not come up. See ${logFile}`));
      process.exitCode = 1;
    }
  }
}
