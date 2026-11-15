#!/usr/bin/env node
// CLI của WujoAgent (lệnh `wujoagent`, viết tắt `cs`). Dùng tại chỗ hoặc qua SSH: ssh may-chu cs list
import readline from 'node:readline/promises';
import { loadConfig } from '../src/config.js';

const [cmd, ...args] = process.argv.slice(2);

const HELP = `wujoagent (viết tắt: cs) — điều khiển Claude Code từ điện thoại

  cs serve [--port N] [--host IP] [--no-qr]   chạy server (mặc định 0.0.0.0:7433)
  cs token                          in token để nhập vào app
  cs qr [tailscale|lan|IP]          in mã QR để thêm máy chủ vào app bằng cách quét
  cs list                           liệt kê session
  cs new <thư-mục> [tiêu đề]        tạo session
  cs send <id> <tin nhắn...>        gửi tin và xem câu trả lời
  cs show <id>                      xem lịch sử
  cs git <id> [fetch|pull|push]     xem repo hoặc chạy thao tác git
  cs rm <id>                        xoá session

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
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Không nối được server ở cổng ${cfg.port}. Chạy "cs serve" trước.`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function resolveId(prefix) {
  if (!prefix) throw new Error('Thiếu id session. Xem: cs list');
  const { sessions } = await api('GET', '/sessions');
  const hits = sessions.filter((s) => s.id.startsWith(prefix));
  if (hits.length === 1) return hits[0].id;
  throw new Error(hits.length ? `"${prefix}" khớp ${hits.length} session, gõ thêm ký tự.` : `Không có session "${prefix}".`);
}

function printEvent(e) {
  if (e.type === 'user') console.log(`\n> ${e.text}`);
  else if (e.type === 'assistant') console.log(`\n${e.text}`);
  else if (e.type === 'tool_use') console.log(`  [tool] ${e.name} ${JSON.stringify(e.input).slice(0, 160)}`);
  else if (e.type === 'tool_result' && e.isError) console.log(`  [lỗi tool] ${e.text.slice(0, 300)}`);
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
      console.log(`\n? Claude xin quyền: ${p.title || p.toolName}`);
      console.log(`  ${JSON.stringify(p.input).slice(0, 400)}`);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const a = (await rl.question('  [y] cho phép  [a] luôn cho phép  [n] từ chối: ')).trim().toLowerCase();
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
    case 'token':
      console.log(loadConfig().token);
      return;
    case 'qr': {
      const cfg = loadConfig();
      const { printQr } = await import('../src/qr.js');
      await printQr({ host: cfg.host, port: cfg.port, token: cfg.token, only: args[0] });
      return;
    }
    case 'list': {
      const { sessions } = await api('GET', '/sessions');
      if (!sessions.length) return console.log('Chưa có session nào. Tạo: cs new <thư-mục>');
      for (const s of sessions) {
        console.log(`${s.id}  ${s.status.padEnd(8)} ${s.mode.padEnd(12)} ${(s.title || '(chưa đặt tên)').padEnd(42)} ${s.cwd}`);
      }
      return;
    }
    case 'new': {
      if (!args[0]) throw new Error('Dùng: cs new <thư-mục> [tiêu đề]');
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
      if (!g.repo) return console.log(g.reason || 'Thư mục này không phải git repo.');
      console.log(`${g.root}\nnhánh ${g.branch || '(detached)'}${g.upstream ? ` → ${g.upstream} (↑${g.ahead} ↓${g.behind})` : ' (chưa có upstream)'}`);
      for (const f of g.files) console.log(`  ${f.status.padEnd(2)} ${f.path}`);
      if (!g.files.length) console.log('  (sạch)');
      return;
    }
    case 'rm': {
      const id = await resolveId(args[0]);
      await api('DELETE', `/sessions/${id}`);
      console.log(`Đã xoá ${id}`);
      return;
    }
    default:
      console.log(HELP);
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
