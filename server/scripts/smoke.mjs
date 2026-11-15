// Chạy thật với Claude (tốn một ít token): một lượt trả lời + một lượt xin quyền ghi file.
// Dùng: node scripts/smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Manager } from '../src/manager.js';
import { claudeRunner } from '../src/runner.js';
import { claudeHistory } from '../src/history.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-smoke-'));
const work = path.join(tmp, 'work');
fs.mkdirSync(work);
const manager = new Manager({ store: new Store(path.join(tmp, 'data')), runner: claudeRunner, history: claudeHistory });
const s = manager.create({ cwd: work });

async function turn(text, onPending) {
  manager.send(s.id, text);
  let after = (await manager.poll(s.id, { after: 0, waitMs: 0 })).events.at(-1).seq - 1;
  let v = -1, sawPartial = false, asked = 0;
  const seen = [];
  for (;;) {
    const out = await manager.poll(s.id, { after, v, waitMs: 20000 });
    for (const e of out.events) { seen.push(e); after = e.seq; }
    v = out.v;
    if (out.partial) sawPartial = true;
    if (out.pending) { asked++; onPending(out.pending); continue; }
    if (out.session.status === 'idle') return { seen, sawPartial, asked };
  }
}

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
};

try {
  const t1 = await turn('Trả lời đúng một từ: xanh', () => {});
  const answer = t1.seen.find((e) => e.type === 'assistant')?.text || '';
  check('lượt 1 có câu trả lời', /xanh/i.test(answer), JSON.stringify(answer.slice(0, 80)));
  check('lượt 1 có stream từng phần', t1.sawPartial);
  check('lượt 1 kết thúc ok', t1.seen.at(-1)?.type === 'result' && t1.seen.at(-1).ok);
  check('đã lưu id session của Claude', Boolean(manager.get(s.id).claudeSessionId));

  const t2 = await turn('Dùng tool Write tạo file hello.txt trong thư mục hiện tại với nội dung "xin chào". Không giải thích.', (p) => {
    console.log(`      xin quyền: ${p.toolName} ${JSON.stringify(p.input).slice(0, 120)}`);
    manager.permission(s.id, { requestId: p.requestId, decision: 'allow' });
  });
  check('lượt 2 có xin quyền (chế độ default)', t2.asked >= 1, `${t2.asked} lần`);
  const file = path.join(work, 'hello.txt');
  check('file được tạo sau khi cho phép', fs.existsSync(file), fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '');
  check('lượt 2 nhớ ngữ cảnh (resume)', t2.seen.at(-1)?.type === 'result' && t2.seen.at(-1).ok);

  const t3 = await turn('Dùng tool Write tạo file cam.txt với nội dung "x". Nếu bị từ chối thì dừng, chỉ nói "đã bị từ chối".', (p) => {
    manager.permission(s.id, { requestId: p.requestId, decision: 'deny', message: 'Không được tạo file này.' });
  });
  check('từ chối thì file không được tạo', t3.asked >= 1 && !fs.existsSync(path.join(work, 'cam.txt')), `${t3.asked} lần hỏi`);

  const listed = await claudeHistory.list(work);
  check('session hiện trong lịch sử Claude của workspace', listed.some((x) => x.claudeSessionId === manager.get(s.id).claudeSessionId), `${listed.length} session`);
  const hist = await claudeHistory.events(manager.get(s.id).claudeSessionId, work);
  check('đọc lại được transcript', hist.filter((e) => e.type === 'user').length >= 3, `${hist.length} sự kiện`);
} catch (err) {
  check('không ném lỗi', false, err.stack);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
