// `wa code`: dựng VS Code bản web (lệnh `code serve-web` có sẵn trong VS Code) trên máy này, kèm extension
// Claude Code, để mở đúng các session Claude như trên VS Code desktop từ trình duyệt của thiết bị khác.
//
// - Server VS Code chỉ nghe trên 127.0.0.1. Thiết bị khác vào qua `tailscale serve` (HTTPS, chỉ trong tailnet):
//   bảng Claude là một webview, trình duyệt chỉ cho webview chạy trên HTTPS hoặc localhost.
// - Không tự chấp nhận điều khoản giấy phép của VS Code Server và không tự đổi cấu hình Tailscale: cả hai chỉ
//   làm khi người dùng truyền cờ tương ứng.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { generateToken } from './config.js';
import { t } from './lang.js';

export const DEFAULT_CODE_PORT = 8765;
export const DEFAULT_HTTPS_PORT = 8443;
const EXTENSION = 'anthropic.claude-code';
const win = process.platform === 'win32';

/** Token kết nối của VS Code web, lưu trong thư mục dữ liệu; tạo ở lần chạy đầu. */
export function codeTokenFile(dir) {
  const file = path.join(dir, 'vscode-token');
  let token = '';
  try { token = fs.readFileSync(file, 'utf8').trim(); } catch { /* chưa có */ }
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) {
    token = generateToken(24);
    fs.writeFileSync(file, token, { mode: 0o600 });
  }
  return { file, token };
}

/** Tham số cho `code serve-web`. */
export function serveWebArgs({ port, tokenFile, folder, acceptLicense }) {
  const args = ['serve-web', '--host', '127.0.0.1', '--port', String(port), '--connection-token-file', tokenFile];
  if (folder) args.push('--default-folder', folder);
  if (acceptLicense) args.push('--accept-server-license-terms');
  return args;
}

/** Đường dẫn thư mục theo dạng VS Code web dùng trong URL: E:\work\repos → /e:/work/repos. */
export function folderParam(folder) {
  const p = String(folder).replace(/\\/g, '/');
  const drive = /^([A-Za-z]):(.*)$/.exec(p);
  return drive ? `/${drive[1].toLowerCase()}:${drive[2]}` : p;
}

export function codeUrl(origin, token, folder) {
  return `${origin}/?tkn=${encodeURIComponent(token)}${folder ? `&folder=${encodeURI(folderParam(folder))}` : ''}`;
}

/** Thư mục extension của VS Code Server (bản web giữ extension riêng, không dùng chung với VS Code desktop). */
export function serverExtensionsDir(home = os.homedir()) {
  return path.join(home, '.vscode-server', 'extensions');
}

export function hasClaudeExtension(extDir = serverExtensionsDir()) {
  try { return fs.readdirSync(extDir).some((n) => n.toLowerCase().startsWith(`${EXTENSION}-`)); } catch { return false; }
}

/** File chạy của VS Code Server mà `code serve-web` đã tải về (bản mới nhất), hoặc null nếu chưa có. */
export function serverBinary(home = os.homedir(), cliDir = process.env.VSCODE_CLI_DATA_DIR) {
  const root = path.join(cliDir || path.join(home, '.vscode', 'cli'), 'serve-web');
  let best = null;
  try {
    for (const name of fs.readdirSync(root)) {
      const bin = path.join(root, name, 'bin', win ? 'code-server.cmd' : 'code-server');
      let stat;
      try { stat = fs.statSync(bin); } catch { continue; }
      if (!best || stat.mtimeMs > best.at) best = { bin, at: stat.mtimeMs };
    }
  } catch { /* chưa tải lần nào */ }
  return best?.bin || null;
}

/** Tên HTTPS của máy này trong tailnet (vd. may.tailnet.ts.net), hoặc null nếu không có Tailscale / chưa bật HTTPS. */
export function tailscaleName(json) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const certs = data?.CertDomains;
    if (Array.isArray(certs) && certs[0]) return String(certs[0]);
  } catch { /* không đọc được */ }
  return null;
}

// Trên Windows `code`, `code-server` là file .cmd nên phải chạy qua shell; khi đó tham số có dấu cách phải tự bọc nháy.
function quote(arg) {
  return win && /[\s&()^]/.test(arg) ? `"${arg}"` : arg;
}

function capture(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, win ? args.map(quote) : args, { shell: win, timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') });
    });
  });
}

/** Đã có gì đang nghe ở cổng này trên máy chưa? */
export function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.setTimeout(1500);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}

async function waitUntilUp(port, token, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/?tkn=${token}`, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return true;
    } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Chạy VS Code web và in địa chỉ. Trả về tiến trình con; hàm kết thúc khi server đã lên (hoặc không lên được). */
export async function startCode({ dir, port = DEFAULT_CODE_PORT, folder, acceptLicense = false, tailscale = false, httpsPort = DEFAULT_HTTPS_PORT, qr = true }) {
  const found = await capture('code', ['--version']);
  if (!found.ok) {
    throw new Error(t('Không tìm thấy lệnh "code". Cài VS Code và bật lệnh "code" trong PATH trước.',
      'The "code" command was not found. Install VS Code and put its "code" command on the PATH first.'));
  }
  if (folder && !fs.existsSync(folder)) {
    throw new Error(t(`Thư mục không tồn tại: ${folder}`, `Folder does not exist: ${folder}`));
  }
  if (await portBusy(port)) {
    throw new Error(t(`Cổng ${port} đang bị dùng. Có thể "wa code" đã chạy rồi; nếu không, đổi cổng: wa code --port <số>`,
      `Port ${port} is in use. "wa code" may already be running; otherwise pick another port: wa code --port <number>`));
  }
  const { file: tokenFile, token } = codeTokenFile(dir);

  if (!acceptLicense && !serverBinary()) {
    console.log(t('Lần chạy đầu, VS Code sẽ tải VS Code Server và hỏi bạn có chấp nhận điều khoản giấy phép không. Trả lời ngay trong cửa sổ này (hoặc chạy lại với --accept-license).',
      'On the first run VS Code downloads VS Code Server and asks you to accept its license terms. Answer in this window (or run again with --accept-license).'));
  }

  const args = serveWebArgs({ port, tokenFile, folder, acceptLicense });
  const child = spawn('code', win ? args.map(quote) : args, {
    // Chưa chấp nhận giấy phép bằng cờ thì VS Code hỏi trong terminal, nên phải để nó in ra; còn lại bỏ nhật ký của nó cho gọn.
    stdio: ['inherit', acceptLicense ? 'ignore' : 'inherit', 'inherit'], shell: win,
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });

  const up = await Promise.race([
    waitUntilUp(port, token),
    new Promise((r) => { const iv = setInterval(() => { if (exited) { clearInterval(iv); r(false); } }, 300); iv.unref?.(); }),
  ]);
  if (!up) {
    if (!exited) child.kill();
    throw new Error(t(`VS Code web không lên được ở cổng ${port}. Cổng có thể đang bị dùng: thử --port <số>.`,
      `VS Code for the web did not start on port ${port}. The port may be in use: try --port <number>.`));
  }

  if (!hasClaudeExtension()) {
    const bin = serverBinary();
    console.log(t('Đang cài extension Claude Code cho bản web…', 'Installing the Claude Code extension for the web build…'));
    const done = bin ? await capture(bin, ['--install-extension', EXTENSION], 180000) : { ok: false };
    console.log(done.ok && hasClaudeExtension()
      ? t('Đã cài. Nếu đang mở trang thì tải lại.', 'Installed. Reload the page if it is already open.')
      : t('Không tự cài được. Mở VS Code web, vào Extensions và cài "Claude Code" (Anthropic).',
        'Could not install it automatically. Open VS Code for the web, go to Extensions and install "Claude Code" (Anthropic).'));
  }

  const local = codeUrl(`http://127.0.0.1:${port}`, token, folder);
  console.log(t(`\nVS Code web đang chạy. Trên máy này:\n  ${local}`, `\nVS Code for the web is running. On this machine:\n  ${local}`));

  // Thiết bị khác: qua Tailscale với HTTPS.
  const status = await capture('tailscale', ['status', '--json']);
  const name = status.ok ? tailscaleName(status.out) : null;
  const serveCmd = `tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${port}`;
  if (!name) {
    console.log(t('\nThiết bị khác: cần Tailscale có bật HTTPS (MagicDNS + HTTPS Certificates). Không dùng được IP thường: bảng Claude chỉ chạy trên HTTPS hoặc localhost.',
      '\nOther devices: this needs Tailscale with HTTPS enabled (MagicDNS + HTTPS Certificates). A plain IP does not work: the Claude panel only runs on HTTPS or localhost.'));
  } else {
    let on = (await capture('tailscale', ['serve', 'status'])).out.includes(`127.0.0.1:${port}`);
    if (!on && tailscale) {
      const res = await capture('tailscale', ['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${port}`], 30000);
      on = res.ok;
      if (!on) console.log(t(`Không bật được tailscale serve: ${res.err.trim()}`, `Could not turn on tailscale serve: ${res.err.trim()}`));
    }
    const remote = codeUrl(`https://${name}${httpsPort === 443 ? '' : `:${httpsPort}`}`, token, folder);
    if (on) {
      console.log(t(`\nThiết bị khác trong tailnet (không ra internet):\n  ${remote}`, `\nOther devices in your tailnet (not on the internet):\n  ${remote}`));
      if (qr) {
        const { default: qrcode } = await import('qrcode-terminal');
        await new Promise((r) => qrcode.generate(remote, { small: true }, (code) => { console.log(code); r(); }));
      }
      console.log(t(`Tắt đường vào này: tailscale serve --https=${httpsPort} off`, `Turn this access off: tailscale serve --https=${httpsPort} off`));
    } else {
      console.log(t(`\nThiết bị khác trong tailnet: chạy lệnh sau (hoặc "wa code --tailscale"), rồi mở địa chỉ bên dưới.\n  ${serveCmd}\n  ${remote}`,
        `\nOther devices in your tailnet: run this (or "wa code --tailscale"), then open the address below.\n  ${serveCmd}\n  ${remote}`));
    }
  }

  console.log(t('\nLưu ý:\n- Ai có địa chỉ kèm token này thì có terminal và mọi file trên máy với quyền của bạn. Chỉ dùng trong tailnet, đừng dùng "tailscale funnel".\n- Thư mục mở lần đầu ở "Restricted Mode": bấm huy hiệu góc dưới trái → Trust thì Claude mới chạy.\n- Bấm biểu tượng Claude ở cột bên trái để thấy các session.\n- Dừng: Ctrl+C.',
    '\nNotes:\n- Anyone with this address and token gets a terminal and every file on this machine with your permissions. Keep it inside the tailnet; do not use "tailscale funnel".\n- A folder opened for the first time is in "Restricted Mode": click the badge at the bottom left → Trust, or Claude will not run.\n- Click the Claude icon in the left bar to see the sessions.\n- Stop: Ctrl+C.'));
  return child;
}
