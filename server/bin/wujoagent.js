#!/usr/bin/env node
// CLI của WujoAgent (lệnh `wujoagent`, viết tắt `wa`). Dùng tại chỗ hoặc qua SSH: ssh may-chu wa list
import readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { initLang, loadConfig, resetToken, setLang } from '../src/config.js';
import { t } from '../src/lang.js';

const [cmd, ...args] = process.argv.slice(2);

// Ngôn ngữ của CLI: WA_LANG, rồi `lang` trong config.json (đặt lúc cài hoặc bằng `wa lang`), rồi tiếng Anh.
initLang();

const HELP_EN = `wujoagent (short: wa) — control Claude Code from your phone

  wa serve [--port N] [--host IP] [--no-qr]   run the server (default 0.0.0.0:7433)
  wa restart [serve|code]           stop what is running (even if stuck) and start it again in the background
  wa version                        print the installed version and the latest one
  wa update                         install the latest version (then run "wa serve" again)
  wa lang [vi|en]                   print or set the language of this command and the server
  wa token                          print the token to enter in the app
  wa token --reset                  issue a new token; every device must add the server again
  wa qr [tailscale|lan|IP]          print a QR code to add the server to the app by scanning
  wa code [folder] [--tailscale]    run VS Code for the web with Claude Code (see README)
  wa startup [on|off] [--code [folder]]   start the server (and VS Code for the web) when you sign in
  wa list                           list sessions
  wa new <folder> [title]           create a session
  wa send <id> <message...>         send a message and watch the reply
  wa show <id>                      show the history
  wa git <id> [fetch|pull|push]     show the repo or run a git operation
  wa rm <id>                        remove a session

<id> can be shortened to its first few characters.`;

const HELP_VI = `wujoagent (viết tắt: wa) — điều khiển Claude Code từ điện thoại

  wa serve [--port N] [--host IP] [--no-qr]   chạy server (mặc định 0.0.0.0:7433)
  wa restart [serve|code]           dừng thứ đang chạy (kể cả bị treo) rồi chạy lại ở nền
  wa version                        in phiên bản đang cài và bản mới nhất
  wa update                         cài bản mới nhất (sau đó chạy lại "wa serve")
  wa lang [vi|en]                   xem hoặc đổi ngôn ngữ của lệnh này và của server
  wa token                          in token để nhập vào app
  wa token --reset                  đổi token mới; mọi thiết bị phải thêm lại máy chủ
  wa qr [tailscale|lan|IP]          in mã QR để thêm máy chủ vào app bằng cách quét
  wa code [thư-mục] [--tailscale]   chạy VS Code bản web kèm Claude Code (xem README)
  wa startup [on|off] [--code [thư-mục]]   tự chạy server (và VS Code web) khi bạn đăng nhập vào máy
  wa list                           liệt kê session
  wa new <thư-mục> [tiêu đề]        tạo session
  wa send <id> <tin nhắn...>        gửi tin và xem câu trả lời
  wa show <id>                      xem lịch sử
  wa git <id> [fetch|pull|push]     xem repo hoặc chạy thao tác git
  wa rm <id>                        xoá session

<id> có thể viết tắt bằng vài ký tự đầu.`;

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function api(method, pathname, body) {
  const cfg = loadConfig();
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${cfg.port}/api${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', 'Accept-Language': cfg.lang },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error(t(`Không nối được server ở cổng ${cfg.port}. Chạy "wa serve" trước.`,
      `Could not reach the server on port ${cfg.port}. Run "wa serve" first.`)), { offline: true });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function resolveId(prefix) {
  if (!prefix) throw new Error(t('Thiếu id session. Xem: wa list', 'Missing session id. See: wa list'));
  const { sessions } = await api('GET', '/sessions');
  const hits = sessions.filter((s) => s.id.startsWith(prefix));
  if (hits.length === 1) return hits[0].id;
  throw new Error(hits.length
    ? t(`"${prefix}" khớp ${hits.length} session, gõ thêm ký tự.`, `"${prefix}" matches ${hits.length} sessions; type more characters.`)
    : t(`Không có session "${prefix}".`, `No session "${prefix}".`));
}

function printEvent(e) {
  if (e.type === 'user') console.log(`\n> ${e.text}`);
  else if (e.type === 'assistant') console.log(`\n${e.text}`);
  else if (e.type === 'tool_use') console.log(`  [tool] ${e.name} ${JSON.stringify(e.input).slice(0, 160)}`);
  else if (e.type === 'tool_result' && e.isError) console.log(`  [${t('lỗi tool', 'tool error')}] ${e.text.slice(0, 300)}`);
  else if (e.type === 'error' || e.type === 'stopped') console.log(`\n! ${e.text}`);
  else if (e.type === 'result' && !e.ok) console.log(`\n! ${e.text}`);
}

async function follow(id, after) {
  let v = -1;
  for (;;) {
    const out = await api('GET', `/sessions/${id}/events?after=${after}&v=${v}&wait=25`);
    for (const e of out.events) { printEvent(e); after = e.seq; }
    v = out.v;
    if (out.pending) {
      const p = out.pending;
      console.log(`\n? ${t('Claude xin quyền', 'Claude asks permission')}: ${p.title || p.toolName}`);
      console.log(`  ${JSON.stringify(p.input).slice(0, 400)}`);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const a = (await rl.question(t('  [y] cho phép  [a] luôn cho phép  [n] từ chối: ', '  [y] allow  [a] always allow  [n] deny: '))).trim().toLowerCase();
      rl.close();
      const decision = a === 'y' ? 'allow' : a === 'a' ? 'allow_always' : 'deny';
      await api('POST', `/sessions/${id}/permission`, { requestId: p.requestId, decision });
      continue;
    }
    if (out.session.status === 'idle') return;
  }
}

async function main() {
  switch (cmd) {
    case 'serve': {
      const { startServer } = await import('../src/serve.js');
      startServer({ port: flag('port') ? Number(flag('port')) : undefined, host: flag('host'), qr: !args.includes('--no-qr') });
      return;
    }
    case 'version': {
      const { checkForUpdate } = await import('../src/update.js');
      const u = await checkForUpdate(loadConfig().dir, { force: true });
      console.log(`WujoAgent ${u.current}`);
      if (!u.latest) console.log(t('Không hỏi được bản mới nhất (mất mạng hoặc GitHub giới hạn lượt hỏi).', 'Could not check for the latest version (offline, or GitHub rate limit).'));
      else if (u.newer) console.log(t(`Có bản mới ${u.latest}. Cập nhật: wa update`, `Version ${u.latest} is available. Update: wa update`));
      else console.log(t('Đang là bản mới nhất.', 'This is the latest version.'));
      return;
    }
    case 'update': {
      const { checkForUpdate, installKind, installLatest } = await import('../src/update.js');
      const u = await checkForUpdate(loadConfig().dir, { force: true });
      if (installKind() === 'source') {
        console.log(t(`Bản này chạy từ mã nguồn (${u.current}${u.latest ? `, mới nhất ${u.latest}` : ''}).`,
          `This copy runs from source (${u.current}${u.latest ? `, latest ${u.latest}` : ''}).`));
        console.log(t('Cập nhật bằng git trong thư mục mã nguồn:  git pull', 'Update with git in the source folder:  git pull'));
        console.log(t('Rồi chạy lại "wa serve".', 'Then run "wa serve" again.'));
        return;
      }
      if (u.latest && !u.newer) return console.log(t(`Đang là bản mới nhất (${u.current}).`, `This is the latest version (${u.current}).`));
      console.log(u.latest
        ? t(`Đang cài ${u.latest} (hiện tại ${u.current})…`, `Installing ${u.latest} (current ${u.current})…`)
        : t('Không hỏi được số phiên bản; vẫn cài lại bản mới nhất…', 'Could not read the version number; reinstalling the latest version anyway…'));
      const code = await installLatest();
      if (code !== 0) throw new Error(`${t('Cài đặt thất bại. Thử chạy tay:', 'The install failed. Try it by hand:')}  npm install -g https://github.com/wujor01/wujo-agent/releases/latest/download/wujoagent.tgz`);
      console.log(t('\nĐã cài xong. Server đang chạy vẫn là bản cũ cho tới khi bạn dừng nó và chạy lại "wa serve".',
        '\nInstalled. A running server stays on the old version until you stop it and run "wa serve" again.'));
      return;
    }
    case 'token': {
      if (!args.includes('--reset')) return console.log(loadConfig().token);
      let token;
      try {
        // Server đang chạy: nhờ nó đổi, để nó bỏ luôn các điện thoại đã đăng ký nhận thông báo.
        ({ token } = await api('POST', '/token/reset', {}));
      } catch (err) {
        if (!err.offline) throw err;
        const cfg = loadConfig();
        token = resetToken(cfg.dir);
        fs.rmSync(path.join(cfg.dir, 'devices.json'), { force: true });
      }
      console.log(`${t('Token mới', 'New token')}: ${token}`);
      console.log(t('Token cũ hết hiệu lực ngay. Trên điện thoại, thêm lại máy chủ: chạy "wa qr" rồi quét mã.',
        'The old token stops working at once. On the phone, add the server again: run "wa qr" and scan the code.'));
      return;
    }
    case 'lang': {
      if (!args[0]) return console.log(loadConfig().lang);
      const lang = setLang(args[0]);
      if (process.env.WA_LANG && process.env.WA_LANG.toLowerCase() !== lang) {
        console.log(t(`Đã lưu "${lang}", nhưng biến môi trường WA_LANG=${process.env.WA_LANG} đang thắng.`,
          `Saved "${lang}", but the WA_LANG=${process.env.WA_LANG} environment variable takes precedence.`));
        return;
      }
      console.log(t('Ngôn ngữ: Tiếng Việt. Server đang chạy đổi theo từ lần chạy lại "wa serve".',
        'Language: English. A running server follows from the next "wa serve".'));
      return;
    }
    case 'code': {
      const { startCode, DEFAULT_CODE_PORT, DEFAULT_HTTPS_PORT } = await import('../src/code.js');
      const valued = new Set(['--port', '--https-port']);
      const folder = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
      await startCode({
        dir: loadConfig().dir,
        port: flag('port') ? Number(flag('port')) : DEFAULT_CODE_PORT,
        httpsPort: flag('https-port') ? Number(flag('https-port')) : DEFAULT_HTTPS_PORT,
        folder: folder ? path.resolve(folder) : undefined,
        acceptLicense: args.includes('--accept-license'),
        tailscale: args.includes('--tailscale'),
        qr: !args.includes('--no-qr'),
      });
      return;
    }
    case 'startup': {
      const { enableStartup, disableStartup, startupStatus } = await import('../src/startup.js');
      const base = { dir: loadConfig().dir };
      const show = () => {
        const s = startupStatus(base);
        console.log(!s.on
          ? t('Tự khởi động: tắt. Bật: wa startup on   (kèm VS Code web: wa startup on --code [thư-mục])',
            'Start at sign-in: off. Turn on: wa startup on   (with VS Code for the web: wa startup on --code [folder])')
          : s.code
            ? t('Tự khởi động: bật, gồm "wa serve" và "wa code". Tắt: wa startup off', 'Start at sign-in: on, running "wa serve" and "wa code". Turn off: wa startup off')
            : t('Tự khởi động: bật, chạy "wa serve". Tắt: wa startup off', 'Start at sign-in: on, running "wa serve". Turn off: wa startup off'));
        for (const f of s.files) console.log(`  ${f}`);
      };
      if (!args[0]) return show();
      if (args[0] === 'off') {
        disableStartup(base);
        console.log(t('Đã tắt tự khởi động. Các tiến trình đang chạy không bị dừng.', 'Start at sign-in is off. Anything already running is left running.'));
        return;
      }
      if (args[0] !== 'on') throw new Error(t('Dùng: wa startup [on|off] [--code [thư-mục]]', 'Usage: wa startup [on|off] [--code [folder]]'));
      const i = args.indexOf('--code');
      const code = i >= 0;
      const next = code ? args[i + 1] : undefined;
      const folder = next && !next.startsWith('--') ? path.resolve(next) : undefined;
      if (folder && !fs.existsSync(folder)) throw new Error(t(`Thư mục không tồn tại: ${folder}`, `Folder does not exist: ${folder}`));
      if (code) {
        const { serverBinary } = await import('../src/code.js');
        if (!serverBinary()) {
          throw new Error(t('Chạy "wa code" một lần trước: lần đầu VS Code hỏi điều khoản giấy phép, lúc tự khởi động không có ai trả lời.',
            'Run "wa code" once first: on its first run VS Code asks about its license terms, and nobody is there to answer at sign-in.'));
        }
      }
      enableStartup({ ...base, code, folder });
      console.log(t('Đã bật. Từ lần đăng nhập sau, máy tự chạy:', 'Turned on. From your next sign-in this machine starts:'));
      show();
      console.log(t(`Nhật ký nằm trong ${base.dir} (startup-*.log). Lệnh này không chạy gì ngay bây giờ.`,
        `Logs are in ${base.dir} (startup-*.log). This command starts nothing right now.`));
      return;
    }
    case 'restart': {
      if (args[0] && args[0] !== 'serve' && args[0] !== 'code') throw new Error(t('Dùng: wa restart [serve|code]', 'Usage: wa restart [serve|code]'));
      const { restart } = await import('../src/restart.js');
      await restart({ cfg: loadConfig(), what: args[0] });
      return;
    }
    case 'qr': {
      const cfg = loadConfig();
      const { printQr } = await import('../src/qr.js');
      await printQr({ host: cfg.host, port: cfg.port, token: cfg.token, only: args[0] });
      return;
    }
    case 'list': {
      const { sessions } = await api('GET', '/sessions');
      if (!sessions.length) return console.log(t('Chưa có session nào. Tạo: wa new <thư-mục>', 'No sessions yet. Create one: wa new <folder>'));
      for (const s of sessions) {
        console.log(`${s.id}  ${s.status.padEnd(8)} ${s.mode.padEnd(12)} ${(s.title || t('(chưa đặt tên)', '(untitled)')).padEnd(42)} ${s.cwd}`);
      }
      return;
    }
    case 'new': {
      if (!args[0]) throw new Error(t('Dùng: wa new <thư-mục> [tiêu đề]', 'Usage: wa new <folder> [title]'));
      const { session } = await api('POST', '/sessions', { cwd: args[0], title: args.slice(1).join(' ') });
      console.log(session.id);
      return;
    }
    case 'send': {
      const id = await resolveId(args[0]);
      const text = args.slice(1).join(' ');
      const before = await api('GET', `/sessions/${id}/events?after=0&wait=0`);
      const after = before.events.length ? before.events[before.events.length - 1].seq : 0;
      await api('POST', `/sessions/${id}/messages`, { text });
      await follow(id, after + 1);
      console.log('');
      return;
    }
    case 'show': {
      const id = await resolveId(args[0]);
      const out = await api('GET', `/sessions/${id}/events?after=0&wait=0`);
      out.events.forEach(printEvent);
      console.log('');
      return;
    }
    case 'git': {
      const id = await resolveId(args[0]);
      if (args[1]) {
        const out = await api('POST', `/sessions/${id}/git`, { op: args[1] });
        console.log(out.output);
        if (!out.ok) process.exitCode = 1;
        return;
      }
      const g = await api('GET', `/sessions/${id}/git`);
      if (!g.repo) return console.log(g.reason || t('Thư mục này không phải git repo.', 'This folder is not a git repo.'));
      console.log(`${g.root}\n${t('nhánh', 'branch')} ${g.branch || '(detached)'}${g.upstream ? ` → ${g.upstream} (↑${g.ahead} ↓${g.behind})` : t(' (chưa có upstream)', ' (no upstream)')}`);
      for (const f of g.files) console.log(`  ${f.status.padEnd(2)} ${f.path}`);
      if (!g.files.length) console.log(t('  (sạch)', '  (clean)'));
      return;
    }
    case 'rm': {
      const id = await resolveId(args[0]);
      await api('DELETE', `/sessions/${id}`);
      console.log(t(`Đã xoá ${id}`, `Removed ${id}`));
      return;
    }
    default:
      console.log(t(HELP_VI, HELP_EN));
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
