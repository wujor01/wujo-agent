// Chạy thật với Claude (tốn một ít token): gửi tin trong lúc Claude đang làm việc và xem nó có tới nơi ngay
// trong lượt đang chạy không.   node scripts/smoke-inject.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Manager } from '../src/manager.js';
import { claudeRunner } from '../src/runner.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-smoke-inject-'));
const work = path.join(tmp, 'work');
fs.mkdirSync(work);
const manager = new Manager({ store: new Store(path.join(tmp, 'data')), runner: claudeRunner });
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(7);

function show(e) {
  const body = e.type === 'tool_use' ? JSON.stringify(e.input).slice(0, 70)
    : e.type === 'result' ? `ok=${e.ok}` : String(e.text || '').replace(/\s+/g, ' ').slice(0, 90);
  if (e.type !== 'thinking') console.log(stamp(), e.type.padEnd(12), body);
}

/** Theo dõi session tới khi rảnh; gọi `onEvent` cho từng sự kiện mới. */
async function follow(id, onEvent) {
  let after = 0, v = -1;
  const all = [];
  for (;;) {
    const out = await manager.poll(id, { after, v, waitMs: 20000 });
    for (const e of out.events) { after = e.seq; all.push(e); show(e); await onEvent?.(e, out); }
    v = out.v;
    if (out.session.status === 'idle') return all;
  }
}

let failed = false;
const check = (ok, what) => { console.log(ok ? '  ✓' : '  ✗', what); if (!ok) failed = true; };

try {
  console.log('--- 1. Chèn tin trong lúc tool đang chạy');
  const a = manager.create({ cwd: work, mode: 'auto' });
  manager.send(a.id, 'Run these three shell commands one at a time, each as a separate Bash call: `sleep 4; echo one`, then `sleep 4; echo two`, then `sleep 4; echo three`. Then reply DONE.');
  let sent = false;
  const ev1 = await follow(a.id, (e) => {
    if (sent || e.type !== 'tool_use') return;
    sent = true;
    setTimeout(() => {
      manager.send(a.id, 'Change of plan: skip the third command, and end your reply with the word BANANA.');
      console.log(stamp(), '>> đã gửi tin giữa lượt');
    }, 1500);
  });
  const tools = ev1.filter((e) => e.type === 'tool_use').length;
  const last = ev1.filter((e) => e.type === 'assistant').pop()?.text || '';
  check(ev1.filter((e) => e.type === 'user').length === 2, 'tin giữa lượt thành một dòng trong lịch sử');
  check(tools === 2, `Claude bỏ lệnh thứ ba (số lần gọi tool: ${tools})`);
  check(/BANANA/.test(last), 'câu trả lời cuối làm theo tin giữa lượt');
  check(ev1.filter((e) => e.type === 'result').length === 1, 'chỉ một lượt, không mở lượt mới');
  check(ev1.findIndex((e) => e.type === 'user' && /Change of plan/.test(e.text)) < ev1.findIndex((e) => e.type === 'assistant' && /BANANA/.test(e.text)), 'tin nằm trước câu trả lời trong lịch sử');

  console.log('--- 2. Gửi tin sát lúc lượt kết thúc');
  const b = manager.create({ cwd: work, mode: 'auto' });
  manager.send(b.id, 'Reply with just the word APPLE.');
  let sent2 = false;
  const ev2 = await follow(b.id, (e) => {
    if (sent2 || e.type !== 'assistant') return;
    sent2 = true;
    manager.send(b.id, 'Now reply with just the word KIWI.');
    console.log(stamp(), '>> đã gửi tin sát cuối lượt');
  });
  const answers = ev2.filter((e) => e.type === 'assistant').map((e) => e.text.trim());
  check(answers.length === 2 && /APPLE/.test(answers[0]) && /KIWI/.test(answers[1]), `cả hai tin đều được trả lời: ${JSON.stringify(answers)}`);
  check(ev2.filter((e) => e.type === 'user').length === 2, 'tin thứ hai không bị mất và không lặp');
  check((await manager.poll(b.id, { waitMs: 0 })).queued.length === 0, 'hàng chờ trống');
  console.log(`  chi phí ghi nhận: $${manager.get(a.id).costUsd} và $${manager.get(b.id).costUsd}`);
} finally {
  // Tiến trình Claude vừa tắt có thể còn giữ thư mục một lúc (Windows).
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* để hệ điều hành dọn */ }
}
console.log(failed ? '\nCÓ LỖI' : '\nỔN');
process.exit(failed ? 1 : 0);
