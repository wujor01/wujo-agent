// Test tái hiện các lỗi tìm ra ở lượt review độc lập.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.js';
import { Manager } from '../src/manager.js';
import { createServer } from '../src/http.js';
import { gitInfo, gitDiff } from '../src/git.js';
import { readLimits } from '../src/runner.js';
import { addLink, reachableAddresses } from '../src/qr.js';

const TOKEN = 'reviewtoken1';
let tmp, work, server, port, manager, sdkAbort;

// "two": xin hai quyền song song · "cancel": xin quyền rồi chính SDK huỷ yêu cầu
let lastModel;
async function runner({ text, model, onEvent, askPermission }) {
  lastModel = model;
  onEvent({ type: 'init', claudeSessionId: 'c-1' });
  if (text === 'two') {
    const [a, b] = await Promise.all([
      askPermission({ toolName: 'Bash', input: { command: 'một' } }),
      askPermission({ toolName: 'Bash', input: { command: 'hai' } }),
    ]);
    onEvent({ type: 'assistant', text: `${a.decision}/${b.decision}` });
  } else if (text === 'cancel') {
    sdkAbort = new AbortController();
    const a = await askPermission({ toolName: 'Write', input: {} }, sdkAbort.signal);
    onEvent({ type: 'assistant', text: `huỷ:${a.decision}:${Boolean(a.cancelled)}` });
  } else {
    onEvent({ type: 'assistant', text: 'ok' });
    if (text === 'usage') {
      onEvent({ type: 'limits', limits: { five_hour: { percent: 19, resetsAt: 1794750000000, status: 'allowed' } } });
      onEvent({ type: 'result', ok: true, text: '', costUsd: 0.0125 });
      onEvent({ type: 'context', context: { percentage: 4, totalTokens: 37509, maxTokens: 1000000, model: 'm' } });
      return;
    }
  }
  onEvent({ type: 'result', ok: true, text: '' });
}

const history = {
  transcript: [{ type: 'user', text: 'a' }],
  updatedAt: 1000,
  async list() { return []; },
  async info(id) {
    if (!/^[0-9a-f]{8}-/.test(id)) return null;
    await new Promise((r) => setTimeout(r, 30)); return { claudeSessionId: ID, title: 'Có sẵn', updatedAt: this.updatedAt };
  },
  async events() { return this.transcript; },
};
const ID = '33333333-3333-4333-8333-333333333333';

async function call(method, p, body, token = TOKEN) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function pollUntil(id, pred) {
  let v = -1;
  for (let i = 0; i < 50; i++) {
    const out = await manager.poll(id, { after: 0, v, waitMs: 200 });
    v = out.v;
    if (pred(out)) return out;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('không đạt điều kiện');
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-review-'));
  work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  fs.mkdirSync(path.join(tmp, 'web'));
  fs.mkdirSync(path.join(tmp, 'web-old'));
  fs.writeFileSync(path.join(tmp, 'web', 'index.html'), 'TRANG-CHINH');
  fs.writeFileSync(path.join(tmp, 'web-old', 'bi-mat.txt'), 'KHONG-DUOC-LO');
  manager = new Manager({ store: new Store(path.join(tmp, 'data')), runner, history });
  server = createServer({
    manager, token: TOKEN, webDir: path.join(tmp, 'web'),
    capabilities: async (cwd, { fresh }) => {
      if (cwd.endsWith('hong')) throw new Error('claude không chạy');
      return { models: [{ value: 'default', name: 'Mặc định', description: '' }], commands: [{ name: 'mcp', description: '', argumentHint: '' }], mcp: [], cwd, fresh };
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('request có đường dẫn hỏng ("//") trả 400, server vẫn sống', async () => {
  const reply = await new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write('GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
    let data = '';
    sock.on('data', (d) => { data += d; });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
  assert.match(reply, /^HTTP\/1\.1 400/);
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('hai yêu cầu quyền song song: cả hai đều được trả lời, không cái nào bị bỏ rơi', async () => {
  const s = manager.create({ cwd: work });
  manager.send(s.id, 'two');
  const first = await pollUntil(s.id, (o) => o.events.filter((e) => e.type === 'permission_request').length === 2);
  assert.equal(first.pending.input.command, 'một');
  manager.permission(s.id, { requestId: first.pending.requestId, decision: 'allow' });
  const second = await manager.poll(s.id, { after: 0, waitMs: 0 });
  assert.equal(second.session.status, 'waiting');
  assert.equal(second.pending.input.command, 'hai');
  manager.permission(s.id, { requestId: second.pending.requestId, decision: 'deny' });
  const done = await pollUntil(s.id, (o) => o.session.status === 'idle');
  assert.ok(done.events.some((e) => e.type === 'assistant' && e.text === 'allow/deny'));
});

test('SDK tự huỷ yêu cầu quyền: thẻ biến mất, session chạy tiếp, trả lời muộn bị 409', async () => {
  const s = manager.create({ cwd: work });
  manager.send(s.id, 'cancel');
  const waiting = await pollUntil(s.id, (o) => o.pending !== null);
  const requestId = waiting.pending.requestId;
  sdkAbort.abort();
  const done = await pollUntil(s.id, (o) => o.session.status === 'idle');
  assert.equal(done.pending, null);
  assert.ok(done.events.some((e) => e.type === 'permission_resolved' && e.decision === 'cancelled'));
  assert.ok(done.events.some((e) => e.type === 'assistant' && e.text === 'huỷ:deny:true'));
  assert.throws(() => manager.permission(s.id, { requestId, decision: 'allow' }), (e) => e.status === 409);
});

test('client đang long-poll được báo reset khi lịch sử bị nạp lại trong lúc chờ', async () => {
  const s = await manager.open({ cwd: work, claudeSessionId: ID });
  const a = await manager.poll(s.id, { after: 0, waitMs: 0 });
  assert.equal(a.events.length, 1);
  // Client A treo long-poll với con trỏ cũ
  const waiting = manager.poll(s.id, { after: 1, v: a.v, epoch: a.epoch, waitMs: 3000 });
  // Session được chat tiếp ở nơi khác, rồi client B mở lại → nạp lại lịch sử
  history.transcript = [{ type: 'user', text: 'a' }, { type: 'assistant', text: 'b' }, { type: 'user', text: 'c' }];
  history.updatedAt = Date.now() + 60000;
  await manager.poll(s.id, { after: 0, waitMs: 0 });
  const woke = await waiting;
  assert.equal(woke.reset, true);
  assert.deepEqual(woke.events.map((e) => e.seq), [1, 2, 3]);
  assert.equal(woke.epoch, a.epoch + 1);
});

test('bấm đúp mở cùng một session có sẵn: không tạo hai bản', async () => {
  const other = '44444444-4444-4444-8444-444444444444';
  const [x, y] = await Promise.all([
    manager.open({ cwd: work, claudeSessionId: other }),
    manager.open({ cwd: work, claudeSessionId: other }),
  ]);
  assert.equal(x.id, y.id);
  assert.equal(manager.list().filter((m) => m.claudeSessionId === other).length, 1);
});

test('file tĩnh: không đọc được thư mục anh em có tên bắt đầu giống (web-old)', async () => {
  for (const p of ['/..%5cweb-old/bi-mat.txt', '/..%2fweb-old/bi-mat.txt', '/%2e%2e/web-old/bi-mat.txt']) {
    const res = await fetch(`http://127.0.0.1:${port}${p}`);
    assert.doesNotMatch(await res.text(), /KHONG-DUOC-LO/, p);
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/%E0%A4%A`)).status, 400);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /TRANG-CHINH/);
});

test('token đúng vẫn vào được sau khi cùng IP đoán sai quá giới hạn; health không lộ tên máy', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('GET', '/api/sessions', undefined, 'sai' + i);
  assert.equal(last.status, 429);
  assert.equal((await call('GET', '/api/sessions')).status, 200);
  assert.equal('name' in (await call('GET', '/api/health')).body, false);
});

test('git: tên file có dấu cách, ngoặc kép, tiếng Việt và file đổi tên được đọc đúng', async () => {
  const repo = path.join(tmp, 'repo');
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  fs.mkdirSync(repo);
  g('init', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 'T');
  fs.writeFileSync(path.join(repo, 'cũ.txt'), 'nội dung đủ dài để git nhận ra là đổi tên chứ không phải file mới\n');
  g('add', '.');
  g('commit', '-m', 'đầu');
  g('mv', 'cũ.txt', 'tên mới.txt');
  fs.writeFileSync(path.join(repo, 'có dấu cách.txt'), 'x');
  fs.writeFileSync(path.join(repo, "nháy'đơn.txt"), 'x');
  const info = await gitInfo(repo);
  assert.equal(info.error, undefined);
  assert.deepEqual(
    info.files.map((f) => `${f.status}|${f.path}`).sort(),
    ['?|có dấu cách.txt', "?|nháy'đơn.txt", 'R|tên mới.txt'].sort(),
  );
});

test('model: lưu theo session, truyền cho runner, "default" nghĩa là để Claude tự chọn, tên lạ bị từ chối', async () => {
  const made = await call('POST', '/api/sessions', { cwd: work, model: 'opus' });
  assert.equal(made.status, 201);
  const id = made.body.session.id;
  assert.equal(made.body.session.model, 'opus');
  await call('POST', `/api/sessions/${id}/messages`, { text: 'chào' });
  await pollUntil(id, (o) => o.session.status === 'idle');
  assert.equal(lastModel, 'opus');

  const changed = await call('PATCH', `/api/sessions/${id}`, { model: 'claude-sonnet-5-5' });
  assert.equal(changed.body.session.model, 'claude-sonnet-5-5');
  assert.equal((await call('PATCH', `/api/sessions/${id}`, { model: 'default' })).body.session.model, null);
  await call('POST', `/api/sessions/${id}/messages`, { text: 'lại' });
  await pollUntil(id, (o) => o.session.status === 'idle');
  assert.equal(lastModel, null);

  assert.equal((await call('PATCH', `/api/sessions/${id}`, { model: 'x; rm -rf /' })).status, 400);
  assert.equal((await call('PATCH', `/api/sessions/${id}`, { model: 42 })).status, 400);
  // đổi tiêu đề không làm mất model
  await call('PATCH', `/api/sessions/${id}`, { model: 'haiku' });
  assert.equal((await call('PATCH', `/api/sessions/${id}`, { title: 'Tên mới' })).body.session.model, 'haiku');
});

test('capabilities: trả model, lệnh, MCP theo thư mục của session; cần token; Claude lỗi → 502 rõ ràng', async () => {
  const s = manager.create({ cwd: work });
  const ok = await call('GET', `/api/sessions/${s.id}/capabilities`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.cwd, work);
  assert.equal(ok.body.fresh, false);
  assert.equal(ok.body.commands[0].name, 'mcp');
  assert.equal((await call('GET', `/api/sessions/${s.id}/capabilities?fresh=1`)).body.fresh, true);
  assert.ok([401, 429].includes((await call('GET', `/api/sessions/${s.id}/capabilities`, undefined, 'sai')).status));
  assert.equal((await call('GET', '/api/sessions/khong-co/capabilities')).status, 404);
  const bad = path.join(tmp, 'hong');
  fs.mkdirSync(bad);
  const b = manager.create({ cwd: bad });
  const failed = await call('GET', `/api/sessions/${b.id}/capabilities`);
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /claude không chạy/);
});

test('mức sử dụng: cộng dồn chi phí theo session, lưu % ngữ cảnh, giới hạn tài khoản có trong poll', async () => {
  const s = manager.create({ cwd: work });
  for (const n of [1, 2]) {
    manager.send(s.id, 'usage');
    await pollUntil(s.id, (o) => o.session.status === 'idle');
  }
  const out = await manager.poll(s.id, { after: 0, waitMs: 0 });
  assert.equal(out.session.costUsd, 0.025);
  assert.equal(out.session.context.percentage, 4);
  assert.equal(out.limits.five_hour.percent, 19);
  assert.ok(out.limits.five_hour.at > 0);
  // các sự kiện số liệu không lẫn vào lịch sử chat
  assert.deepEqual([...new Set(out.events.map((e) => e.type))].sort(), ['assistant', 'result', 'user']);
});

test('readLimits: đọc mọi cửa sổ giới hạn, đổi tỉ lệ sang phần trăm và giây sang mili giây', () => {
  const limits = readLimits({
    status: 'allowed', rateLimitType: 'five_hour', resetsAt: 1794750000,
    unifiedWindows: {
      five_hour: { utilization: 0.19, resetsAt: 1794750000, status: 'allowed' },
      seven_day: { utilization: 0.51, resetsAt: 1794762000, status: 'allowed_warning' },
    },
  });
  assert.deepEqual(limits, {
    five_hour: { percent: 19, resetsAt: 1794750000000, status: 'allowed' },
    seven_day: { percent: 51, resetsAt: 1794762000000, status: 'allowed_warning' },
  });
  // bản cũ không có unifiedWindows
  assert.deepEqual(readLimits({ status: 'rejected', rateLimitType: 'seven_day', utilization: 1, resetsAt: 10 }),
    { seven_day: { percent: 100, resetsAt: 10000, status: 'rejected' } });
  assert.deepEqual(readLimits({ status: 'allowed' }), {});
  assert.deepEqual(readLimits(undefined), {});
});

test('git diff theo file: file sửa, file mới, file xoá, file nhị phân; số dòng thêm/bớt; chặn file ngoài repo', async () => {
  const repo = path.join(tmp, 'repo-diff');
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  g('init', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 'T');
  g('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'một\nhai\nba\n');
  fs.writeFileSync(path.join(repo, 'xoa.txt'), 'sẽ bị xoá\n');
  g('add', '.');
  g('commit', '-m', 'đầu');
  fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'một\nHAI đã sửa\nba\nbốn\n');
  fs.rmSync(path.join(repo, 'xoa.txt'));
  fs.writeFileSync(path.join(repo, 'tệp mới.txt'), 'dòng 1\ndòng 2\n');
  fs.writeFileSync(path.join(repo, 'anh.bin'), Buffer.from([1, 0, 2, 0, 3]));

  const info = await gitInfo(repo);
  const a = info.files.find((f) => f.path === 'src/a.txt');
  assert.deepEqual([a.added, a.removed], [2, 1]);

  const changed = await gitDiff(repo, 'src/a.txt');
  assert.equal(changed.file, 'src/a.txt');
  assert.ok(changed.diff.startsWith('@@'), changed.diff.slice(0, 40));
  assert.ok(changed.diff.includes('-hai') && changed.diff.includes('+HAI đã sửa') && changed.diff.includes('+bốn'));
  assert.equal(changed.untracked, false);
  // đường dẫn tuyệt đối và gọi từ thư mục con đều được
  assert.equal((await gitDiff(path.join(repo, 'src'), path.join(repo, 'src', 'a.txt'))).diff, changed.diff);

  const fresh = await gitDiff(repo, 'tệp mới.txt');
  assert.equal(fresh.untracked, true);
  assert.equal(fresh.diff, '@@ -0,0 +1,2 @@\n+dòng 1\n+dòng 2');

  const gone = await gitDiff(repo, 'xoa.txt');
  assert.equal(gone.deleted, true);
  assert.ok(gone.diff.includes('-sẽ bị xoá'));

  assert.equal((await gitDiff(repo, 'anh.bin')).binary, true);
  assert.equal((await gitDiff(repo, 'khong-doi.txt')).diff, '');

  await assert.rejects(gitDiff(repo, '../web-old/bi-mat.txt'), (e) => e.status === 400);
  await assert.rejects(gitDiff(repo, path.join(tmp, 'web-old', 'bi-mat.txt')), (e) => e.status === 400);
  await assert.rejects(gitDiff(repo, ''), (e) => e.status === 400);
  await assert.rejects(gitDiff(work, 'a.txt'), (e) => e.status === 400);

  const viaHttp = await call('GET', `/api/git/diff?path=${encodeURIComponent(repo)}&file=${encodeURIComponent('src/a.txt')}`);
  assert.equal(viaHttp.status, 200);
  assert.equal(viaHttp.body.diff, changed.diff);
  assert.equal((await call('GET', `/api/git/diff?path=${encodeURIComponent(repo)}&file=${encodeURIComponent('..\\web-old\\bi-mat.txt')}`)).status, 400);
});

test('link QR: token nằm sau dấu #, liệt kê mọi địa chỉ, địa chỉ của mã đứng đầu', async () => {
  const link = addLink({ host: '192.168.1.10', port: 7433, token: 'abc 123', hosts: ['100.64.0.10', '192.168.1.10'] });
  assert.equal(link, 'http://192.168.1.10:7433/add#t=abc%20123&p=7433&h=192.168.1.10,100.64.0.10');
  const url = new URL(link);
  assert.equal(url.search, ''); // không có gì nhạy cảm trong query string
  assert.equal(url.pathname, '/add');
  // đường dẫn /add trả về trang app (SPA), và server không thấy token
  const res = await fetch(`http://127.0.0.1:${port}/add`);
  assert.match(await res.text(), /TRANG-CHINH/);
  assert.deepEqual(reachableAddresses('127.0.0.1'), []);
  assert.deepEqual(reachableAddresses('100.64.0.10'), [{ kind: '', address: '100.64.0.10' }]);
});
