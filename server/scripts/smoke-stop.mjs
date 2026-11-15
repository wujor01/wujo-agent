// Chạy thật với Claude: bấm Dừng giữa lượt và khi đang chờ duyệt quyền, rồi chat tiếp.
// Dùng: node scripts/smoke-stop.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Manager } from '../src/manager.js';
import { claudeRunner } from '../src/runner.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-stop-'));
const work = path.join(tmp, 'work');
fs.mkdirSync(work);
const manager = new Manager({ store: new Store(path.join(tmp, 'data')), runner: claudeRunner });
const s = manager.create({ cwd: work });

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
};

// Giữ con trỏ `after` giữa các lần hỏi: hỏi lại từ 0 sẽ luôn trả ngay và làm nghẽn vòng lặp sự kiện.
let after = 0, v = -1;
const events = [];
async function until(pred, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const out = await manager.poll(s.id, { after, v, waitMs: 5000 });
    for (const e of out.events) { events.push(e); after = e.seq; }
    v = out.v;
    if (pred(out)) return { ...out, events };
  }
  throw new Error('quá thời gian chờ');
}

try {
  // 1. Dừng khi Claude đang viết
  manager.send(s.id, 'Viết một bài luận 800 từ về lịch sử máy tính.');
  await until((o) => o.partial.length > 20);
  const t0 = Date.now();
  manager.interrupt(s.id);
  const a = await until((o) => o.session.status === 'idle', 30000);
  check('dừng giữa lúc đang viết → về idle', true, `${Date.now() - t0} ms`);
  check('có dòng "Đã dừng"', a.events.at(-1).type === 'stopped', a.events.at(-1).type);

  // 2. Dừng khi đang chờ duyệt quyền
  manager.send(s.id, 'Dùng tool Write tạo file a.txt nội dung "x".');
  await until((o) => o.pending !== null);
  manager.interrupt(s.id);
  const b = await until((o) => o.session.status === 'idle', 30000);
  check('dừng khi đang chờ quyền → về idle, hết yêu cầu chờ', b.pending === null);
  check('file không được tạo', !fs.existsSync(path.join(work, 'a.txt')));

  // 3. Sau khi dừng vẫn chat tiếp được trong cùng session
  manager.send(s.id, 'Trả lời đúng một từ: đỏ');
  const c = await until((o) => o.session.status === 'idle');
  const last = c.events.filter((e) => e.type === 'assistant').at(-1)?.text || '';
  check('chat tiếp sau khi dừng', /đỏ/i.test(last) && c.events.at(-1).type === 'result' && c.events.at(-1).ok, JSON.stringify(last.slice(0, 60)));
} catch (err) {
  check('không ném lỗi', false, err.stack);
} finally {
  // Tiến trình Claude cần một nhịp để thoát hẳn và nhả thư mục làm việc (Windows khoá thư mục đang là cwd).
  const t0 = Date.now();
  for (;;) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch (err) {
      if (Date.now() - t0 > 15000) { check('tiến trình Claude nhả thư mục trong 15 giây', false, err.code); break; }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  console.log(`      dọn thư mục tạm sau ${Date.now() - t0} ms`);
}
process.exit(failed ? 1 : 0);
