import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.js';
import { Manager } from '../src/manager.js';
import { createServer, listDirs } from '../src/http.js';

const TOKEN = 'testtoken123';
let tmp, work, server, base, manager, store;

// Runner giả: điều khiển bằng nội dung tin nhắn.
//   "perm"  -> xin quyền Bash rồi báo lại quyết định
//   "hang"  -> chờ tới khi bị dừng
//   "boom"  -> ném lỗi
//   khác    -> stream từng phần rồi trả lời "echo: <text>"
async function fakeRunner({ text, resume, mode, signal, onEvent, askPermission }) {
  onEvent({ type: 'init', claudeSessionId: resume || 'claude-abc' });
  if (text === 'boom') throw new Error('nổ rồi');
  if (text === 'hang') {
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  }
  if (text === 'perm') {
    const a = await askPermission({ toolName: 'Bash', input: { command: 'ls' }, title: 'Chạy ls', canAlways: true });
    onEvent({ type: 'assistant', text: `quyết định: ${a.decision}` });
  } else {
    onEvent({ type: 'partial', text: 'ec' });
    await new Promise((r) => setTimeout(r, 20));
    onEvent({ type: 'assistant', text: `echo: ${text} [resume=${resume || 'none'} mode=${mode}]` });
  }
  onEvent({ type: 'result', ok: true, text: '' });
}

function boot() {
  store = new Store(path.join(tmp, 'data'));
  manager = new Manager({ store, runner: fakeRunner });
  server = createServer({ manager, token: TOKEN, webDir: path.join(tmp, 'web') });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}/api`;
    resolve();
  }));
}

async function call(method, p, body, token = TOKEN) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function waitIdle(id, afterSeq = 0) {
  let v = -1, events = [];
  for (let i = 0; i < 50; i++) {
    const { body } = await call('GET', `/sessions/${id}/events?after=${afterSeq}&v=${v}&wait=2`);
    events = body.events; v = body.v;
    if (body.session.status === 'idle') return { ...body, events };
  }
  throw new Error('session không về idle');
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
  work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  fs.mkdirSync(path.join(tmp, 'web'));
  fs.writeFileSync(path.join(tmp, 'web', 'index.html'), '<h1>web</h1>');
  await boot();
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('health không cần token; mọi API khác cần', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).app, 'claude-sessions');
  assert.equal((await call('GET', '/sessions', undefined, null)).status, 401);
  assert.equal((await call('GET', '/sessions', undefined, 'sai')).status, 401);
  assert.equal((await call('GET', '/sessions')).status, 200);
});

test('tạo session: thư mục không tồn tại → 400 rõ ràng', async () => {
  const r = await call('POST', '/sessions', { cwd: path.join(tmp, 'khong-co') });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /does not exist/);
  assert.equal((await call('POST', '/sessions', {})).status, 400);
  assert.equal((await call('POST', '/sessions', { cwd: work, mode: 'bypassPermissions' })).status, 400);
});

test('JSON hỏng → 400, body quá lớn → 413', async () => {
  assert.equal((await call('POST', '/sessions', '{hỏng')).status, 400);
  assert.equal((await call('POST', '/sessions', '[1,2]')).status, 400);
  const big = JSON.stringify({ cwd: 'x'.repeat(1024 * 1024 + 10) });
  assert.equal((await call('POST', '/sessions', big)).status, 413);
});

test('một lượt chat: tiếng Việt nguyên vẹn, có stream, lưu claudeSessionId, resume ở lượt sau', async () => {
  const { body: { session } } = await call('POST', '/sessions', { cwd: work });
  const text = 'Xin chào, đây là tiếng Việt có dấu: ắ ề ữ đ 🚀';
  assert.equal((await call('POST', `/sessions/${session.id}/messages`, { text })).status, 202);

  // partial phải nhìn thấy được trong lúc chạy
  const mid = await call('GET', `/sessions/${session.id}/events?after=0&v=-1&wait=0`);
  assert.equal(mid.body.session.status, 'running');

  const done = await waitIdle(session.id);
  const types = done.events.map((e) => e.type);
  assert.deepEqual(types, ['user', 'assistant', 'result']);
  assert.equal(done.events[0].text, text);
  assert.ok(done.events[1].text.includes(text));
  assert.ok(done.events[1].text.includes('resume=none'));
  assert.equal(done.partial, '');
  assert.equal(done.session.claudeSessionId, 'claude-abc');
  assert.equal(done.session.title, text.slice(0, 40));

  await call('POST', `/sessions/${session.id}/messages`, { text: 'lượt 2' });
  const done2 = await waitIdle(session.id, 3);
  assert.ok(done2.events.find((e) => e.type === 'assistant').text.includes('resume=claude-abc'));
});

test('gửi tin khi lượt trước đang chạy → xếp hàng chờ; bỏ hàng chờ rồi Dừng thì về idle', async () => {
  const { body: { session } } = await call('POST', '/sessions', { cwd: work });
  await call('POST', `/sessions/${session.id}/messages`, { text: 'hang' });
  const again = await call('POST', `/sessions/${session.id}/messages`, { text: 'chen ngang' });
  assert.equal(again.status, 202);
  assert.equal(again.body.session.status, 'running');
  const mid = await call('GET', `/sessions/${session.id}/events?after=0&wait=0`);
  assert.deepEqual(mid.body.queued, ['chen ngang']);
  assert.deepEqual(mid.body.events.map((e) => e.type), ['user']); // tin đang chờ chưa vào lịch sử
  assert.equal((await call('DELETE', `/sessions/${session.id}/queue`)).status, 200);
  assert.deepEqual((await call('GET', `/sessions/${session.id}/events?after=0&wait=0`)).body.queued, []);
  await call('POST', `/sessions/${session.id}/interrupt`);
  const done = await waitIdle(session.id);
  assert.equal(done.events.at(-1).type, 'stopped');
  assert.equal((await call('POST', `/sessions/${session.id}/messages`, { text: '' })).status, 400);
});

test('runner lỗi → sự kiện error, session vẫn dùng tiếp được', async () => {
  const { body: { session } } = await call('POST', '/sessions', { cwd: work });
  await call('POST', `/sessions/${session.id}/messages`, { text: 'boom' });
  const done = await waitIdle(session.id);
  assert.equal(done.events.at(-1).type, 'error');
  assert.match(done.events.at(-1).text, /nổ rồi/);
  assert.equal((await call('POST', `/sessions/${session.id}/messages`, { text: 'ok' })).status, 202);
  await waitIdle(session.id);
});

test('hỏi quyền: chờ → cho phép; requestId sai → 409', async () => {
  const { body: { session } } = await call('POST', '/sessions', { cwd: work });
  await call('POST', `/sessions/${session.id}/messages`, { text: 'perm' });
  let out;
  for (let i = 0; i < 20 && !out?.body.pending; i++) {
    out = await call('GET', `/sessions/${session.id}/events?after=0&v=${out?.body.v ?? -1}&wait=2`);
  }
  assert.equal(out.body.session.status, 'waiting');
  assert.equal(out.body.pending.toolName, 'Bash');
  const bad = await call('POST', `/sessions/${session.id}/permission`, { requestId: 'sai', decision: 'allow' });
  assert.equal(bad.status, 409);
  const invalid = await call('POST', `/sessions/${session.id}/permission`, { requestId: out.body.pending.requestId, decision: 'yes' });
  assert.equal(invalid.status, 400);
  const ok = await call('POST', `/sessions/${session.id}/permission`, { requestId: out.body.pending.requestId, decision: 'allow_always' });
  assert.equal(ok.status, 200);
  const done = await waitIdle(session.id);
  assert.ok(done.events.some((e) => e.type === 'assistant' && e.text === 'quyết định: allow_always'));
  assert.equal(done.pending, null);
});

test('mất kết nối giữa lượt: nối lại bằng con trỏ nhận đủ phần còn thiếu', async () => {
  const { body: { session } } = await call('POST', '/sessions', { cwd: work });
  await call('POST', `/sessions/${session.id}/messages`, { text: 'một' });
  await waitIdle(session.id);
  await call('POST', `/sessions/${session.id}/messages`, { text: 'hai' });
  await waitIdle(session.id);
  // client chỉ kịp thấy tới seq 2 rồi "ngủ"
  const resumed = await call('GET', `/sessions/${session.id}/events?after=2&wait=0`);
  assert.deepEqual(resumed.body.events.map((e) => e.seq), [3, 4, 5, 6]);
});

test('long-poll chờ rồi mới trả khi không có gì mới', async () => {
  const { body: { session } } = await call('POST', '/sessions', { cwd: work });
  const first = await call('GET', `/sessions/${session.id}/events?after=0&v=-1&wait=0`);
  const t0 = Date.now();
  const p = call('GET', `/sessions/${session.id}/events?after=0&v=${first.body.v}&wait=5`);
  setTimeout(() => call('POST', `/sessions/${session.id}/messages`, { text: 'đánh thức' }), 300);
  const out = await p;
  const waited = Date.now() - t0;
  assert.ok(waited >= 250 && waited < 4000, `chờ ${waited}ms`);
  assert.ok(out.body.events.length >= 1);
  await waitIdle(session.id);
});

test('đổi tiêu đề và chế độ; xoá session', async () => {
  const { body: { session } } = await call('POST', '/sessions', { cwd: work, title: 'Ban đầu' });
  const p = await call('PATCH', `/sessions/${session.id}`, { title: 'Đổi tên', mode: 'plan' });
  assert.equal(p.body.session.title, 'Đổi tên');
  assert.equal(p.body.session.mode, 'plan');
  assert.equal((await call('PATCH', `/sessions/${session.id}`, { mode: 'bypassPermissions' })).status, 400);
  assert.equal((await call('DELETE', `/sessions/${session.id}`)).status, 200);
  assert.equal((await call('GET', `/sessions/${session.id}`)).status, 404);
  assert.equal(fs.existsSync(store.eventsFile(session.id)), false);
});

test('khởi động lại: giữ lịch sử; session đang chờ quyền về idle kèm dòng báo', async () => {
  const { body: { session } } = await call('POST', '/sessions', { cwd: work });
  await call('POST', `/sessions/${session.id}/messages`, { text: 'perm' });
  for (let i = 0; i < 20; i++) {
    const o = await call('GET', `/sessions/${session.id}/events?after=0&wait=1`);
    if (o.body.pending) break;
  }
  // mô phỏng tắt server đột ngột: ghi trạng thái hiện tại rồi dựng Manager mới trên cùng thư mục
  store.saveSessions([...manager.sessions.values()]);
  const reborn = new Manager({ store: new Store(path.join(tmp, 'data')), runner: fakeRunner });
  const s = reborn.get(session.id);
  assert.equal(s.status, 'idle');
  const out = await reborn.poll(session.id, { after: 0, waitMs: 0 });
  assert.equal(out.events[0].type, 'user');
  assert.equal(out.events.at(-1).type, 'error');
  assert.match(out.events.at(-1).text, /khởi động lại/);
  assert.equal(out.pending, null);
  await call('POST', `/sessions/${session.id}/interrupt`);
  await waitIdle(session.id);
});

test('duyệt thư mục: gốc, thư mục con, thư mục hỏng', async () => {
  const root = await call('GET', '/dirs');
  assert.ok(root.body.dirs.length >= 1);
  fs.mkdirSync(path.join(work, 'con-ắ'));
  const sub = await call('GET', `/dirs?path=${encodeURIComponent(work)}`);
  assert.ok(sub.body.dirs.some((d) => d.name === 'con-ắ'));
  assert.ok(sub.body.dirs.every((d) => d.modifiedAt > 1e12));
  assert.equal(sub.body.parent, tmp);
  assert.equal((await call('GET', `/dirs?path=${encodeURIComponent(path.join(tmp, 'nope'))}`)).status, 400);
  assert.ok(listDirs('').dirs.length >= 1);
});

test('git: thư mục thường → repo:false; repo thật → nhánh, file, commit; fetch/pull/push với remote cục bộ', async () => {
  const { body: { session: plain } } = await call('POST', '/sessions', { cwd: work });
  assert.equal((await call('GET', `/sessions/${plain.id}/git`)).body.repo, false);
  assert.equal((await call('POST', `/sessions/${plain.id}/git`, { op: 'push' })).status, 400);

  const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
  const remote = path.join(tmp, 'remote.git');
  const repo = path.join(tmp, 'repo');
  g(tmp, 'init', '--bare', '-b', 'main', remote);
  g(tmp, 'init', '-b', 'main', repo);
  g(repo, 'config', 'user.email', 't@example.com');
  g(repo, 'config', 'user.name', 'Tester');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'một');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'Commit đầu tiên');
  g(repo, 'remote', 'add', 'origin', remote);
  g(repo, 'push', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hai');
  g(repo, 'commit', '-am', 'Commit thứ hai');
  fs.writeFileSync(path.join(repo, 'tệp mới.txt'), 'x');

  const { body: { session } } = await call('POST', '/sessions', { cwd: repo });
  const info = (await call('GET', `/sessions/${session.id}/git`)).body;
  assert.equal(info.repo, true);
  assert.equal(info.branch, 'main');
  assert.equal(info.upstream, 'origin/main');
  assert.equal(info.ahead, 1);
  assert.equal(info.behind, 0);
  assert.deepEqual(info.files, [{ status: '?', path: 'tệp mới.txt' }]);
  assert.equal(info.commits[0].subject, 'Commit thứ hai');
  assert.equal(info.commits.length, 2);

  assert.equal((await call('POST', `/sessions/${session.id}/git`, { op: 'reset --hard' })).status, 400);
  const push = (await call('POST', `/sessions/${session.id}/git`, { op: 'push' })).body;
  assert.equal(push.ok, true);
  assert.equal(push.info.ahead, 0);
  assert.equal((await call('POST', `/sessions/${session.id}/git`, { op: 'fetch' })).body.ok, true);
  assert.equal((await call('POST', `/sessions/${session.id}/git`, { op: 'pull' })).body.ok, true);

  // git theo đường dẫn workspace, không cần session
  const byPath = await call('GET', `/git?path=${encodeURIComponent(repo)}`);
  assert.equal(byPath.body.branch, 'main');
  assert.equal((await call('POST', '/git', { path: repo, op: 'fetch' })).body.ok, true);
  assert.equal((await call('GET', `/git?path=${encodeURIComponent(path.join(tmp, 'nope'))}`)).status, 400);
  assert.equal((await call('GET', '/git')).status, 400);
  assert.equal((await call('POST', '/git', { path: repo, op: 'clean -fdx' })).status, 400);

  // push thất bại phải trả ok:false kèm output, không ném 500
  g(repo, 'remote', 'set-url', 'origin', path.join(tmp, 'khong-ton-tai.git'));
  const failed = await call('POST', `/sessions/${session.id}/git`, { op: 'push' });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.ok, false);
  assert.ok(failed.body.output.length > 0);
});

test('file tĩnh: phục vụ index.html, không cho thoát thư mục', async () => {
  const origin = base.replace('/api', '');
  assert.match(await (await fetch(origin + '/')).text(), /web/);
  assert.match(await (await fetch(origin + '/bat-ky/duong-dan')).text(), /web/);
  const res = await fetch(origin + '/..%2f..%2fdata%2fsessions.json');
  assert.doesNotMatch(await res.text(), /claudeSessionId/);
});

test('sai token quá 10 lần → 429 cho các lần đoán tiếp theo', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('GET', '/sessions', undefined, 'sai-' + i);
  assert.equal(last.status, 429);
});
