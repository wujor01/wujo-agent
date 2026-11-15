import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Manager } from '../src/manager.js';
import { createServer } from '../src/http.js';
import { Push } from '../src/push.js';

const TOKEN = 'pushtoken123';
const DEVICE = 'ExponentPushToken[abcDEF123456_-xyz]';
let tmp, work, server, port, manager, push, sent, expoReply, gate;

// Runner giả: "ask" xin một quyền; "boom" ném lỗi; "wait" chờ cổng mở; còn lại trả lời ngay.
async function runner({ text, signal, onEvent, askPermission }) {
  onEvent({ type: 'init', claudeSessionId: 'c-1' });
  if (text === 'boom') throw new Error('nổ');
  if (text === 'hang') await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  if (text === 'wait') await gate;
  if (text === 'ask') await askPermission({ toolName: 'Bash', input: { command: 'ls' } });
  onEvent({ type: 'assistant', text: 'NỘI DUNG BÍ MẬT của cuộc trò chuyện' });
  onEvent({ type: 'result', ok: true, text: '' });
}

const call = async (method, p, body, token = TOKEN) => {
  const res = await fetch(`http://127.0.0.1:${port}/api${p}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const idle = async (id) => { for (let i = 0; i < 200 && manager.get(id).status !== 'idle'; i++) await new Promise((r) => setTimeout(r, 10)); };
const settle = () => new Promise((r) => setTimeout(r, 30));

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-push-'));
  work = path.join(tmp, 'du-an-mau');
  fs.mkdirSync(work);
  fs.mkdirSync(path.join(tmp, 'data'));
  sent = [];
  expoReply = (messages) => ({ data: messages.map(() => ({ status: 'ok', id: 'x' })) });
  const fetchImpl = async (url, init) => {
    const messages = JSON.parse(init.body);
    sent.push({ url, messages });
    return { ok: true, status: 200, json: async () => expoReply(messages) };
  };
  push = new Push(path.join(tmp, 'data'), { fetchImpl });
  manager = new Manager({ store: new Store(path.join(tmp, 'data')), runner, notify: (kind, info) => push.send(kind, info) });
  server = createServer({ manager, token: TOKEN, push });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('đăng ký thiết bị: cần token của máy chủ, mã thiết bị phải đúng dạng, đăng ký lại không nhân đôi', async () => {
  assert.equal((await call('POST', '/push/register', { token: DEVICE }, 'sai')).status, 401);
  assert.equal((await call('POST', '/push/register', { token: 'https://evil.example/hook' })).status, 400);
  assert.equal((await call('POST', '/push/register', {})).status, 400);
  const ok = await call('POST', '/push/register', { token: DEVICE, tag: 'srv-1', lang: 'vi', platform: 'ios' });
  assert.deepEqual(ok.body, { ok: true, devices: 1 });
  assert.equal((await call('POST', '/push/register', { token: DEVICE, tag: 'srv-1', lang: 'vi', platform: 'ios' })).body.devices, 1);
  // lưu xuống đĩa để còn sau khi khởi động lại
  assert.equal(new Push(path.join(tmp, 'data')).devices[0].token, DEVICE);
});

test('lượt xong mà không có app nào đang xem → một thông báo, không kèm chữ của cuộc trò chuyện', async () => {
  const s = manager.create({ cwd: work });
  sent.length = 0;
  manager.send(s.id, 'chào');
  await idle(s.id); await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://exp.host/--/api/v2/push/send');
  const [m] = sent[0].messages;
  assert.equal(m.to, DEVICE);
  assert.equal(m.title, 'du-an-mau');
  assert.equal(m.body, 'Claude đã chạy xong.');
  assert.deepEqual(m.data, { kind: 'done', sessionId: s.id, tag: 'srv-1' });
  assert.doesNotMatch(JSON.stringify(sent), /BÍ MẬT|chào/);
});

test('Claude xin quyền → thông báo "chờ duyệt"; lượt lỗi → thông báo lỗi; tự bấm Dừng → không báo', async () => {
  const s = manager.create({ cwd: work });
  sent.length = 0;
  manager.send(s.id, 'ask');
  for (let i = 0; i < 100 && !sent.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent[0].messages[0].data.kind, 'ask');
  assert.equal(sent[0].messages[0].body, 'Claude đang chờ bạn duyệt.');
  const pending = (await manager.poll(s.id, { after: 0, waitMs: 0 })).pending;
  manager.permission(s.id, { requestId: pending.requestId, decision: 'allow' });
  await idle(s.id); await settle();

  sent.length = 0;
  await new Promise((r) => setTimeout(r, 3100)); // hết khoảng "vừa xem xong" do lần poll ở trên
  manager.send(s.id, 'boom');
  await idle(s.id); await settle();
  assert.deepEqual(sent.map((x) => x.messages[0].data.kind), ['error']);

  sent.length = 0;
  manager.send(s.id, 'hang');
  manager.interrupt(s.id);
  await idle(s.id); await settle();
  assert.equal(sent.length, 0);
});

test('đang có app mở session (long-poll) → không báo; app đóng kết nối → lượt sau báo', async () => {
  const s = manager.create({ cwd: work });
  const first = await manager.poll(s.id, { after: 0, waitMs: 0 });
  sent.length = 0;
  let open; gate = new Promise((r) => { open = r; });
  // app đang xem: một long-poll treo qua HTTP
  const ac = new AbortController();
  const watching = fetch(`http://127.0.0.1:${port}/api/sessions/${s.id}/events?after=999&v=${first.v + 2}&wait=20`, {
    headers: { Authorization: `Bearer ${TOKEN}` }, signal: ac.signal,
  }).catch(() => null);
  manager.send(s.id, 'wait');
  await new Promise((r) => setTimeout(r, 150));
  open();
  await idle(s.id); await settle();
  assert.equal(sent.length, 0, 'không được báo khi app đang xem');
  await watching;

  // app bị đưa xuống nền: nó huỷ long-poll; server phải thấy là không còn ai xem
  gate = new Promise((r) => { open = r; });
  const ac2 = new AbortController();
  const v = (await manager.poll(s.id, { after: 0, waitMs: 0 })).v;
  const bg = fetch(`http://127.0.0.1:${port}/api/sessions/${s.id}/events?after=999&v=${v + 1}&wait=20`, {
    headers: { Authorization: `Bearer ${TOKEN}` }, signal: ac2.signal,
  }).catch(() => null);
  manager.send(s.id, 'wait');
  await new Promise((r) => setTimeout(r, 150));
  ac2.abort(); await bg;
  await new Promise((r) => setTimeout(r, 3200));
  open();
  await idle(s.id); await settle();
  assert.deepEqual(sent.map((x) => x.messages[0].data.kind), ['done']);
});

test('thiết bị tiếng Anh nhận câu tiếng Anh; Expo báo thiết bị đã gỡ app → bỏ khỏi danh sách', async () => {
  const other = 'ExpoPushToken[zzzzzzzzzzzzzzzzzzzz]';
  await call('POST', '/push/register', { token: other, tag: 'srv-9', lang: 'en', platform: 'android' });
  expoReply = (messages) => ({ data: messages.map((m) => (m.to === DEVICE ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) });
  const delivered = await push.send('done', { sessionId: 'abc', cwd: work });
  assert.equal(delivered, 1);
  const last = sent.at(-1).messages;
  assert.equal(last.find((m) => m.to === other).body, 'Claude has finished.');
  assert.deepEqual(push.devices.map((d) => d.token), [other]);
  assert.equal((await call('POST', '/push/unregister', { token: other })).body.devices, 0);
});

test('mất mạng hoặc Expo lỗi không làm hỏng lượt chat', async () => {
  const broken = new Push(path.join(tmp, 'data'), { fetchImpl: async () => { throw new Error('mất mạng'); } });
  broken.register({ token: DEVICE, lang: 'vi' });
  assert.equal(await broken.send('done', { sessionId: 'x', cwd: work }), 0);
  assert.equal(await broken.send('kiểu-lạ', { sessionId: 'x', cwd: work }), 0);
});
