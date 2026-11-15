import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Manager } from '../src/manager.js';
import { transcriptToEvents, normPath } from '../src/history.js';

let tmp, root, wsA, wsB, manager, fake;
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

async function runner({ text, resume, onEvent }) {
  onEvent({ type: 'init', claudeSessionId: resume || 'new-claude-id' });
  onEvent({ type: 'assistant', text: `trả lời: ${text}` });
  onEvent({ type: 'result', ok: true, text: '' });
}

async function idle(id) {
  for (let i = 0; i < 100; i++) {
    if (manager.get(id).status === 'idle') return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('không về idle');
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ws-'));
  root = path.join(tmp, 'repos');
  wsA = path.join(root, 'alpha');
  wsB = path.join(root, 'beta');
  for (const d of [wsA, wsB, path.join(root, 'node_modules'), path.join(root, '.hidden'), path.join(wsA, '.git')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  // Giả lập ~/.claude/projects: hai session có sẵn ở alpha (ví dụ tạo từ VS Code).
  fake = {
    sessions: [
      { claudeSessionId: ID1, title: 'Sửa lỗi đăng nhập', updatedAt: 1000, cwd: wsA, gitBranch: 'main' },
      { claudeSessionId: ID2, title: 'Thêm trang báo cáo', updatedAt: 2000, cwd: wsA.toUpperCase(), gitBranch: 'dev' },
    ],
    transcript: {
      [ID1]: [{ type: 'user', text: 'lỗi ở đâu?' }, { type: 'assistant', text: 'Ở file auth.' }],
      [ID2]: [{ type: 'user', text: 'thêm trang' }],
    },
    async list(dir) {
      return this.sessions.filter((s) => !dir || normPath(s.cwd) === normPath(dir));
    },
    async info(id) { return this.sessions.find((s) => s.claudeSessionId === id) || null; },
    async events(id) { return this.transcript[id] || []; },
  };
  manager = new Manager({ store: new Store(path.join(tmp, 'data')), runner, history: fake });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('workspaces: liệt kê thư mục con kèm số session, bỏ thư mục ẩn và node_modules', async () => {
  const { workspaces, parent } = await manager.workspaces(root);
  assert.deepEqual(workspaces.map((w) => w.name), ['repos', 'alpha', 'beta']);
  // thư mục cha cho dòng ".."; ở gốc ổ đĩa thì không còn cha
  assert.equal(parent, tmp);
  assert.equal((await manager.workspaces(path.parse(root).root)).parent, null);
  const alpha = workspaces.find((w) => w.name === 'alpha');
  // Windows không phân biệt hoa thường nên hai cách viết đường dẫn là một workspace.
  assert.equal(alpha.sessions, process.platform === 'win32' ? 2 : 1);
  assert.equal(alpha.isRepo, true);
  assert.equal(workspaces.find((w) => w.name === 'beta').sessions, 0);
  // ngày sửa thư mục có mặt để app sắp xếp
  for (const w of workspaces) assert.ok(w.modifiedAt > 1e12 && w.modifiedAt <= Date.now() + 1000, `${w.name}: ${w.modifiedAt}`);
  await assert.rejects(manager.workspaces(path.join(tmp, 'khong-co')), /Could not read the folder/);
  await assert.rejects(manager.workspaces(''), /Missing root folder/);
});

test('workspaceSessions: session Claude có sẵn hiện ra dù chưa từng mở qua hệ thống này', async () => {
  const { sessions } = await manager.workspaceSessions(wsA);
  const first = sessions.find((s) => s.claudeSessionId === ID1);
  assert.equal(first.id, null);
  assert.equal(first.title, 'Sửa lỗi đăng nhập');
  assert.equal(first.gitBranch, 'main');
  assert.deepEqual((await manager.workspaceSessions(wsB)).sessions, []);
});

test('mở session có sẵn: nạp lịch sử, chat tiếp dùng đúng id để resume, mở lần hai không tạo bản sao', async () => {
  const s = await manager.open({ cwd: wsA, claudeSessionId: ID1 });
  assert.equal(s.title, 'Sửa lỗi đăng nhập');
  assert.equal(s.claudeSessionId, ID1);
  const hist = await manager.poll(s.id, { after: 0, waitMs: 0 });
  assert.deepEqual(hist.events.map((e) => [e.seq, e.type, e.text]), [[1, 'user', 'lỗi ở đâu?'], [2, 'assistant', 'Ở file auth.']]);

  const again = await manager.open({ cwd: wsA, claudeSessionId: ID1 });
  assert.equal(again.id, s.id);

  manager.send(s.id, 'sửa giúp');
  await idle(s.id);
  const out = await manager.poll(s.id, { after: 2, waitMs: 0 });
  assert.deepEqual(out.events.map((e) => e.type), ['user', 'assistant', 'result']);
  assert.equal(manager.get(s.id).claudeSessionId, ID1);

  // danh sách workspace giờ gộp: một dòng, có id của mình
  const { sessions } = await manager.workspaceSessions(wsA);
  assert.equal(sessions.filter((x) => x.claudeSessionId === ID1).length, 1);
  assert.equal(sessions.find((x) => x.claudeSessionId === ID1).id, s.id);
});

test('session mới tạo qua hệ thống hiện trong workspace trước cả khi có id của Claude', async () => {
  const s = manager.create({ cwd: wsB, title: 'Việc mới' });
  const { sessions } = await manager.workspaceSessions(wsB);
  assert.deepEqual(sessions.map((x) => [x.id, x.title]), [[s.id, 'Việc mới']]);
  assert.equal((await manager.workspaces(root)).workspaces.find((w) => w.name === 'beta').sessions, 1);
});

test('session được chat tiếp ở nơi khác (VS Code): mở lại thì nạp bản mới, client cũ nhận reset', async () => {
  const s = await manager.open({ cwd: wsA, claudeSessionId: ID2 });
  const first = await manager.poll(s.id, { after: 0, waitMs: 0 });
  assert.equal(first.events.length, 1);

  fake.transcript[ID2] = [
    { type: 'user', text: 'thêm trang' },
    { type: 'assistant', text: 'Đã thêm (làm trên VS Code).' },
    { type: 'user', text: 'cảm ơn' },
  ];
  fake.sessions[1].updatedAt = Date.now() + 60000;

  const reopened = await manager.poll(s.id, { after: 0, waitMs: 0 });
  assert.equal(reopened.events.length, 3);
  assert.equal(reopened.epoch, first.epoch + 1);

  // một client khác còn giữ con trỏ cũ: phải được báo reset và nhận lại toàn bộ
  const stale = await manager.poll(s.id, { after: 1, v: first.v, epoch: first.epoch, waitMs: 0 });
  assert.equal(stale.reset, true);
  assert.equal(stale.events.length, 3);
});

test('mở session: id sai định dạng → 400, không tồn tại → 404', async () => {
  await assert.rejects(manager.open({ cwd: wsA, claudeSessionId: '../../etc' }), (e) => e.status === 400);
  await assert.rejects(manager.open({ cwd: wsA, claudeSessionId: '99999999-9999-4999-8999-999999999999' }), (e) => e.status === 404);
});

test('transcriptToEvents: bỏ chữ hệ thống chèn và lượt subagent, giữ tool', () => {
  const events = transcriptToEvents([
    { type: 'user', parent_tool_use_id: null, message: { content: '<system-reminder>ẩn</system-reminder>' } },
    { type: 'user', parent_tool_use_id: null, message: { content: 'Chào bạn' } },
    { type: 'assistant', parent_tool_use_id: null, message: { content: [
      { type: 'text', text: 'Để tôi xem.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } },
    ] } },
    { type: 'user', parent_tool_use_id: null, message: { content: [
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'nội dung' }] },
    ] } },
    { type: 'assistant', parent_tool_use_id: 't9', message: { content: [{ type: 'text', text: 'subagent nói' }] } },
    { type: 'system', parent_tool_use_id: null, message: {} },
  ]);
  assert.deepEqual(events.map((e) => e.type), ['user', 'assistant', 'tool_use', 'tool_result']);
  // khối suy nghĩ có nội dung thì thành một dòng; khối rỗng (chỉ có chữ ký) thì bỏ
  const withThinking = transcriptToEvents([
    { type: 'assistant', parent_tool_use_id: null, message: { content: [
      { type: 'thinking', thinking: '', signature: 'x' },
      { type: 'thinking', thinking: 'Cân nhắc hai cách.', signature: 'y' },
      { type: 'text', text: 'Chọn cách một.' },
    ] } },
  ]);
  assert.deepEqual(withThinking.map((e) => [e.type, e.text]), [['thinking', 'Cân nhắc hai cách.'], ['assistant', 'Chọn cách một.']]);
  assert.equal(events[0].text, 'Chào bạn');
  assert.equal(events[3].text, 'nội dung');
});

test('đang mở session trên điện thoại mà chat tiếp trên máy tính: điện thoại nhận bản mới, không phải ra vào lại', async () => {
  const ID3 = '33333333-3333-4333-8333-333333333333';
  fake.sessions.push({ claudeSessionId: ID3, title: 'Làm trên hai máy', updatedAt: 1000, cwd: wsA, gitBranch: 'main' });
  fake.transcript[ID3] = [{ type: 'user', text: 'câu đầu' }];
  let written = 1000;
  fake.mtime = async (id) => (id === ID3 ? written : null);
  manager.watchMs = 40;

  const s = await manager.open({ cwd: wsA, claudeSessionId: ID3 });
  const first = await manager.poll(s.id, { after: 0, waitMs: 0 });
  assert.equal(first.events.length, 1);

  // điện thoại treo long-poll ở cuối lịch sử
  const t0 = Date.now();
  const waiting = manager.poll(s.id, { after: 1, v: first.v, epoch: first.epoch, waitMs: 5000 });
  await new Promise((r) => setTimeout(r, 150));

  // người dùng gõ câu mới trên máy tính (VS Code): transcript được ghi thêm
  fake.transcript[ID3] = [
    { type: 'user', text: 'câu đầu' },
    { type: 'user', text: 'hỏi từ máy tính' },
    { type: 'assistant', text: 'trả lời trên máy tính' },
  ];
  written = Date.now() + 60000;
  fake.sessions.find((x) => x.claudeSessionId === ID3).updatedAt = written;

  const out = await waiting;
  assert.ok(Date.now() - t0 < 2000, `điện thoại phải thấy trong vòng 2 giây, mất ${Date.now() - t0} ms`);
  assert.equal(out.reset, true);
  assert.deepEqual(out.events.map((e) => e.text), ['câu đầu', 'hỏi từ máy tính', 'trả lời trên máy tính']);

  // không có gì đổi thì long-poll không bị đánh thức vô cớ, và không đọc lại transcript
  written = 1000; // transcript không được ghi thêm kể từ lần nạp vừa rồi
  let reads = 0;
  const realEvents = fake.events;
  fake.events = async (...a) => { reads++; return realEvents.apply(fake, a); };
  const quiet = await manager.poll(s.id, { after: 3, v: out.v, epoch: out.epoch, waitMs: 300 });
  assert.equal(quiet.events.length, 0);
  assert.equal(quiet.reset, false);
  assert.equal(reads, 0);
  fake.events = realEvents;
  delete fake.mtime;
  manager.watchMs = 2000;
});
