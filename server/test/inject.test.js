import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Manager } from '../src/manager.js';
import { createServer } from '../src/http.js';
import { Push } from '../src/push.js';
import { loadConfig, resetToken, tokenSource } from '../src/config.js';

let tmp, work;
const servers = [];

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-inject-'));
  work = path.join(tmp, 'work');
  fs.mkdirSync(work);
});

after(async () => {
  for (const s of servers) { s.closeAllConnections(); await new Promise((r) => s.close(r)); }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Runner giả nhận được tin giữa lượt, như runner thật: báo `ready`, nhận tin qua hàm đã trao cho onInject,
 * và chỉ báo `delivered` khi được "mở cổng" (tức Claude sang bước kế tiếp).
 */
function makeRunner() {
  const state = { calls: [], open: null };
  const runner = async ({ text, signal, onEvent, onInject }) => {
    state.calls.push(text);
    onEvent({ type: 'init', claudeSessionId: 'claude-inject' });
    const got = [];
    let accepting = true;
    onInject((more) => { if (!accepting) return false; got.push(more); return true; });
    onEvent({ type: 'ready' });
    await new Promise((resolve, reject) => {
      state.open = resolve;
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    if (got.length) {
      onEvent({ type: 'delivered', count: got.length });
      onEvent({ type: 'assistant', text: `đã nhận giữa lượt: ${got.join(' | ')}` });
    } else {
      onEvent({ type: 'assistant', text: `echo: ${text}` });
    }
    accepting = false;
    onEvent({ type: 'result', ok: true, text: '' });
  };
  return { runner, state };
}

function makeManager(name, runner) {
  return new Manager({ store: new Store(path.join(tmp, name)), runner });
}

async function untilIdle(manager, id) {
  for (let i = 0; i < 100; i++) {
    if (manager.get(id).status === 'idle') return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('session không về idle');
}

const texts = (out, type) => out.events.filter((e) => e.type === type).map((e) => e.text);

test('tin gửi giữa lượt: vào thẳng lượt đang chạy, nằm ở hàng chờ tới khi Claude nhận, rồi thành dòng trong lịch sử', async () => {
  const { runner, state } = makeRunner();
  const manager = makeManager('a', runner);
  const { id } = manager.create({ cwd: work });
  manager.send(id, 'việc đầu');
  manager.send(id, 'đổi ý: làm khác đi');

  const mid = await manager.poll(id, { waitMs: 0 });
  assert.deepEqual(mid.queued, ['đổi ý: làm khác đi']);
  assert.equal(mid.queuedSent, 1, 'tin đã nằm trong lượt đang chạy');
  assert.deepEqual(texts(mid, 'user'), ['việc đầu'], 'chưa thành dòng lịch sử khi Claude chưa nhận');

  // Đã đưa cho Claude thì không rút lại được.
  manager.clearQueue(id);
  assert.deepEqual((await manager.poll(id, { waitMs: 0 })).queued, ['đổi ý: làm khác đi']);

  state.open();
  await untilIdle(manager, id);
  const end = await manager.poll(id, { waitMs: 0 });
  assert.deepEqual(end.queued, []);
  assert.deepEqual(texts(end, 'user'), ['việc đầu', 'đổi ý: làm khác đi']);
  assert.deepEqual(texts(end, 'assistant'), ['đã nhận giữa lượt: đổi ý: làm khác đi']);
  assert.deepEqual(state.calls, ['việc đầu'], 'không mở lượt mới: tin đi trong cùng một lượt');
});

test('Dừng khi tin giữa lượt chưa tới tay Claude: tin đó được gửi thành lượt kế tiếp, không bị mất và không lặp', async () => {
  const { runner, state } = makeRunner();
  const manager = makeManager('b', runner);
  const { id } = manager.create({ cwd: work });
  manager.send(id, 'chạy lâu');
  manager.send(id, 'sửa lại thế này');
  manager.interrupt(id);
  // Lượt kế tiếp tự chạy với tin còn dở.
  for (let i = 0; i < 100 && state.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(state.calls, ['chạy lâu', 'sửa lại thế này']);
  state.open();
  await untilIdle(manager, id);
  const end = await manager.poll(id, { waitMs: 0 });
  assert.deepEqual(texts(end, 'user'), ['chạy lâu', 'sửa lại thế này']);
  assert.deepEqual(texts(end, 'assistant'), ['echo: sửa lại thế này']);
  assert.deepEqual(end.queued, []);
});

test('runner không nhận tin giữa lượt: tin chờ tới hết lượt như trước, và huỷ được', async () => {
  let open;
  const calls = [];
  const runner = async ({ text, onEvent }) => {
    calls.push(text);
    await new Promise((r) => { open = r; });
    onEvent({ type: 'assistant', text: `echo: ${text}` });
    onEvent({ type: 'result', ok: true, text: '' });
  };
  const manager = makeManager('c', runner);
  const { id } = manager.create({ cwd: work });
  manager.send(id, 'một');
  manager.send(id, 'bỏ đi');
  assert.equal((await manager.poll(id, { waitMs: 0 })).queuedSent, 0);
  manager.clearQueue(id);
  manager.send(id, 'hai');
  manager.send(id, 'ba');
  open();
  for (let i = 0; i < 100 && calls.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['một', 'hai\n\nba']);
  open();
  await untilIdle(manager, id);
});

test('đổi token: token cũ hết hiệu lực ngay, token mới dùng được, các điện thoại khác thôi nhận thông báo', async () => {
  const dir = path.join(tmp, 'cfg');
  const old = loadConfig(dir).token;
  const push = new Push(dir);
  push.register({ token: 'ExponentPushToken[aaaaaaaaaaaa]', tag: 'mine' });
  push.register({ token: 'ExponentPushToken[bbbbbbbbbbbb]', tag: 'other' });
  const { runner } = makeRunner();
  const server = createServer({
    manager: makeManager('d', runner), token: tokenSource(dir), resetToken: () => resetToken(dir), push,
  });
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, token, body) => {
    const res = await fetch(base + p, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  assert.equal((await call('POST', '/token/reset', 'sai-token')).status, 401, 'không có token thì không đổi được');
  const out = await call('POST', '/token/reset', old, { keepPush: 'ExponentPushToken[aaaaaaaaaaaa]' });
  assert.equal(out.status, 200);
  const fresh = out.body.token;
  assert.match(fresh, /^[a-z2-9]{12}$/);
  assert.notEqual(fresh, old);
  assert.equal((await call('GET', '/sessions', old)).status, 401);
  assert.equal((await call('GET', '/sessions', fresh)).status, 200);
  assert.equal(loadConfig(dir).token, fresh, 'token mới được ghi vào file cấu hình');
  assert.deepEqual(push.devices.map((d) => d.tag), ['mine']);

  // Đổi bằng lệnh `wa token --reset` khi server đang chạy: server đọc lại file, không phải khởi động lại.
  const again = resetToken(dir);
  assert.equal((await call('GET', '/sessions', fresh)).status, 401);
  assert.equal((await call('GET', '/sessions', again)).status, 200);
});

test('token đặt bằng biến môi trường CS_TOKEN thì không đổi được qua lệnh', () => {
  const dir = path.join(tmp, 'cfg-env');
  loadConfig(dir);
  process.env.CS_TOKEN = 'tu-bien-moi-truong';
  try {
    assert.throws(() => resetToken(dir), /CS_TOKEN/);
    assert.equal(tokenSource(dir)(), 'tu-bien-moi-truong');
  } finally {
    delete process.env.CS_TOKEN;
  }
});
