import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { normPath } from './history.js';
import { t } from './lang.js';

// 'auto': một bộ phân loại duyệt hoặc từ chối từng thao tác, chỉ hỏi người dùng khi nó không tự quyết được.
// Không có 'bypassPermissions': điều khiển từ xa mà bỏ hẳn kiểm tra quyền thì quá rủi ro.
export const MODES = ['default', 'acceptEdits', 'plan', 'auto'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Quản lý trạng thái các session: lượt chat đang chạy, yêu cầu quyền đang chờ,
 * và các client đang long-poll.
 *
 * `runner` là hàm chạy một lượt:
 *   runner({ text, cwd, resume, mode, signal, onEvent, askPermission }) -> Promise<void>
 */
export class Manager {
  constructor({ store, runner, history }) {
    this.store = store;
    this.runner = runner;
    // Nguồn đọc session Claude Code có sẵn trên máy; không có thì chỉ thấy session của hệ thống này.
    this.history = history || { list: async () => [], info: async () => null, events: async () => [] };
    this.sessions = new Map(); // id -> meta (lưu đĩa)
    this.limits = {}; // giới hạn sử dụng của tài khoản, cập nhật sau mỗi lượt chat
    this.live = new Map(); // id -> trạng thái trong bộ nhớ
    for (const meta of store.loadSessions()) {
      this.sessions.set(meta.id, meta);
      // Server tắt giữa lượt: lượt đó đã mất, báo rõ thay vì treo ở "running".
      if (meta.status !== 'idle') {
        meta.status = 'idle';
        const live = this.#live(meta.id);
        this.#append(meta.id, live, {
          type: 'error',
          text: 'Server đã khởi động lại giữa lượt chat; lượt đó bị huỷ. Hãy gửi lại tin nhắn.',
        });
      }
    }
    this.#save();
  }

  // ---------- truy vấn ----------

  list() {
    return [...this.sessions.values()]
      .map((m) => this.#view(m))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id) {
    return this.#view(this.#meta(id));
  }

  // ---------- thay đổi ----------

  /**
   * Tạo session mới, hoặc mở một session Claude Code có sẵn (claudeSessionId)
   * để chat tiếp: lịch sử được nạp từ transcript của Claude.
   */
  async open({ cwd, title, mode, model, claudeSessionId }) {
    if (!claudeSessionId) return this.create({ cwd, title, mode, model });
    if (typeof claudeSessionId !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(claudeSessionId)) {
      throw new HttpError(400, t('claudeSessionId không hợp lệ.', 'Invalid claudeSessionId.'));
    }
    for (const m of this.sessions.values()) {
      if (m.claudeSessionId === claudeSessionId) return this.#view(m);
    }
    const info = await this.history.info(claudeSessionId, cwd);
    if (!info) throw new HttpError(404, t('Không tìm thấy session Claude này trong thư mục đã chọn.', 'This Claude session was not found in the chosen folder.'));
    // Bấm đúp: yêu cầu thứ hai có thể đã tạo xong trong lúc mình chờ đọc lịch sử.
    for (const m of this.sessions.values()) {
      if (m.claudeSessionId === claudeSessionId) return this.#view(m);
    }
    const created = this.create({ cwd, title: title || info.title, mode, model });
    const meta = this.sessions.get(created.id);
    meta.claudeSessionId = claudeSessionId;
    await this.#resync(meta, true);
    meta.updatedAt = info.updatedAt || meta.updatedAt;
    this.#save();
    return this.#view(meta);
  }

  /** Các thư mục con của `root` (và chính nó) kèm số session trong từng workspace. */
  async workspaces(root) {
    if (typeof root !== 'string' || !root.trim()) throw new HttpError(400, t('Thiếu thư mục gốc (root).', 'Missing root folder (root).'));
    root = path.resolve(root.trim());
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      throw new HttpError(400, t(`Không đọc được thư mục: ${root}`, `Could not read the folder: ${root}`));
    }
    const dirs = [{ name: path.basename(root) || root, path: root, isRoot: true }];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('$') || e.name === 'node_modules') continue;
      dirs.push({ name: e.name, path: path.join(root, e.name), isRoot: false });
    }
    const stats = new Map(); // normPath -> { ids:Set, updatedAt, active }
    const stat = (cwd) => {
      const k = normPath(cwd);
      if (!stats.has(k)) stats.set(k, { ids: new Set(), updatedAt: 0, active: 0 });
      return stats.get(k);
    };
    for (const s of await this.history.list()) {
      if (!s.cwd) continue;
      const st = stat(s.cwd);
      st.ids.add(s.claudeSessionId);
      st.updatedAt = Math.max(st.updatedAt, s.updatedAt || 0);
    }
    for (const m of this.sessions.values()) {
      const st = stat(m.cwd);
      st.ids.add(m.claudeSessionId || `local:${m.id}`);
      st.updatedAt = Math.max(st.updatedAt, m.updatedAt || 0);
      if (m.status !== 'idle') st.active++;
    }
    const workspaces = dirs.map((d) => {
      const st = stats.get(normPath(d.path));
      let modifiedAt = 0;
      try { modifiedAt = Math.round(fs.statSync(d.path).mtimeMs); } catch { /* không đọc được: để 0 */ }
      return {
        ...d,
        modifiedAt,
        isRepo: fs.existsSync(path.join(d.path, '.git')),
        sessions: st ? st.ids.size : 0,
        active: st ? st.active : 0,
        updatedAt: st ? st.updatedAt : 0,
      };
    });
    workspaces.sort((a, b) => (b.isRoot - a.isRoot) || (b.updatedAt - a.updatedAt)
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    // Thư mục cha, để app có dòng ".." đi ra ngoài; null khi đã ở gốc ổ đĩa.
    const up = path.dirname(root);
    return { root, parent: up === root ? null : up, workspaces };
  }

  /** Session của một workspace: session Claude có sẵn gộp với session của hệ thống này. */
  async workspaceSessions(dir) {
    if (typeof dir !== 'string' || !dir.trim()) throw new HttpError(400, t('Thiếu thư mục (path).', 'Missing folder (path).'));
    dir = path.resolve(dir.trim());
    const key = normPath(dir);
    const mine = [...this.sessions.values()].filter((m) => normPath(m.cwd) === key);
    const byClaude = new Map(mine.filter((m) => m.claudeSessionId).map((m) => [m.claudeSessionId, m]));
    const merged = new Set();
    const out = [];
    for (const s of await this.history.list(dir)) {
      if (s.cwd && normPath(s.cwd) !== key) continue;
      const m = byClaude.get(s.claudeSessionId);
      if (m) merged.add(m.id);
      out.push({
        id: m ? m.id : null,
        claudeSessionId: s.claudeSessionId,
        title: (m && m.title) || s.title,
        updatedAt: Math.max(s.updatedAt || 0, m ? m.updatedAt : 0),
        status: m ? m.status : 'idle',
        mode: m ? m.mode : 'default',
        gitBranch: s.gitBranch,
      });
    }
    for (const m of mine) {
      if (merged.has(m.id)) continue;
      out.push({
        id: m.id, claudeSessionId: m.claudeSessionId, title: m.title, updatedAt: m.updatedAt,
        status: m.status, mode: m.mode, gitBranch: null,
      });
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return { path: dir, sessions: out };
  }

  /** null = model mặc định của Claude Code. */
  #model(model) {
    if (model === undefined || model === null || model === '' || model === 'default') return null;
    if (typeof model !== 'string' || !/^[\w.:\-\[\]]{1,100}$/.test(model)) throw new HttpError(400, t('Tên model không hợp lệ.', 'Invalid model name.'));
    return model;
  }

  create({ cwd, title, mode, model }) {
    if (typeof cwd !== 'string' || !cwd.trim()) throw new HttpError(400, t('Thiếu thư mục làm việc (cwd).', 'Missing working folder (cwd).'));
    cwd = cwd.trim();
    let stat;
    try { stat = fs.statSync(cwd); } catch { /* xử lý bên dưới */ }
    if (!stat || !stat.isDirectory()) throw new HttpError(400, t(`Thư mục không tồn tại: ${cwd}`, `Folder does not exist: ${cwd}`));
    mode = mode || 'default';
    model = this.#model(model);
    if (!MODES.includes(mode)) throw new HttpError(400, t(`Chế độ không hợp lệ: ${mode}`, `Invalid mode: ${mode}`));
    const now = Date.now();
    const meta = {
      id: crypto.randomBytes(4).toString('hex'),
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : '',
      cwd,
      mode,
      model,
      status: 'idle',
      claudeSessionId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(meta.id, meta);
    this.#save();
    return this.#view(meta);
  }

  patch(id, { title, mode, model }) {
    const meta = this.#meta(id);
    if (title !== undefined) {
      if (typeof title !== 'string') throw new HttpError(400, t('title phải là chuỗi.', 'title must be a string.'));
      meta.title = title.trim().slice(0, 80);
    }
    if (model !== undefined) meta.model = this.#model(model);
    if (mode !== undefined) {
      if (!MODES.includes(mode)) throw new HttpError(400, t(`Chế độ không hợp lệ: ${mode}`, `Invalid mode: ${mode}`));
      meta.mode = mode;
    }
    this.#save();
    this.#bump(id);
    return this.#view(meta);
  }

  remove(id) {
    const meta = this.#meta(id);
    const live = this.live.get(id);
    if (live) {
      live.abort?.abort();
      this.#denyPending(live, 'Session đã bị xoá.');
      live.removed = true;
      this.#wake(live);
    }
    this.sessions.delete(meta.id);
    this.live.delete(id);
    this.store.removeEvents(id);
    this.#save();
  }

  send(id, text) {
    const meta = this.#meta(id);
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, t('Tin nhắn rỗng.', 'The message is empty.'));
    if (meta.status !== 'idle') throw new HttpError(409, t('Session đang chạy một lượt khác. Chờ xong hoặc bấm Dừng.', 'This session is busy with another turn. Wait for it or tap Stop.'));
    const live = this.#live(id);
    if (!meta.title) meta.title = text.trim().replace(/\s+/g, ' ').slice(0, 40);
    meta.status = 'running';
    this.#append(id, live, { type: 'user', text });
    live.partial = '';
    live.abort = new AbortController();
    const signal = live.abort.signal;

    const run = this.runner({
      text,
      cwd: meta.cwd,
      resume: meta.claudeSessionId,
      mode: meta.mode,
      model: meta.model || null,
      signal,
      onEvent: (ev) => this.#onRunnerEvent(id, ev),
      askPermission: (req, sig) => this.#askPermission(id, req, sig),
    });

    Promise.resolve(run)
      .catch((err) => {
        if (!this.sessions.has(id)) return;
        const text = signal.aborted ? t('Đã dừng.', 'Stopped.') : t(`Lỗi: ${err?.message || err}`, `Error: ${err?.message || err}`);
        this.#append(id, live, { type: signal.aborted ? 'stopped' : 'error', text });
      })
      .finally(() => {
        if (!this.sessions.has(id)) return;
        this.#denyPending(live, 'Lượt chat đã kết thúc.');
        live.partial = '';
        live.abort = null;
        meta.status = 'idle';
        meta.updatedAt = Date.now();
        meta.syncedAt = Date.now();
        this.#save();
        this.#bump(id);
      });

    return this.#view(meta);
  }

  interrupt(id) {
    const meta = this.#meta(id);
    const live = this.live.get(id);
    if (meta.status === 'idle' || !live?.abort) return this.#view(meta);
    this.#denyPending(live, 'Người dùng đã dừng lượt chat.');
    live.abort.abort();
    return this.#view(meta);
  }

  /** Trả lời một yêu cầu quyền đang chờ. decision: allow | allow_always | deny */
  permission(id, { requestId, decision, message, answers }) {
    const meta = this.#meta(id);
    const live = this.live.get(id);
    const index = live ? live.queue.findIndex((p) => p.request.requestId === requestId) : -1;
    if (index < 0) throw new HttpError(409, t('Yêu cầu quyền này không còn chờ nữa.', 'This permission request is no longer pending.'));
    if (!['allow', 'allow_always', 'deny'].includes(decision)) {
      throw new HttpError(400, t(`Quyết định không hợp lệ: ${decision}`, `Invalid decision: ${decision}`));
    }
    const [pending] = live.queue.splice(index, 1);
    if (!live.queue.length) meta.status = 'running';
    this.#append(id, live, { type: 'permission_resolved', requestId, decision });
    pending.resolve({ decision, message: typeof message === 'string' ? message : '', answers });
    return this.#view(meta);
  }

  /**
   * Long-poll: trả ngay nếu có gì mới so với (after, v), nếu không thì chờ tối đa waitMs.
   */
  async poll(id, { after = 0, v = -1, epoch, waitMs = 25000 } = {}) {
    const meta = this.#meta(id);
    const live = this.#live(id);
    // Mở màn chat (after=0): nếu session đã được chat tiếp ở nơi khác (VS Code, terminal) thì nạp lại.
    if (after === 0 && meta.status === 'idle') await this.#resync(meta, false);
    // Lịch sử đã được nạp lại kể từ lần client hỏi trước: con trỏ cũ vô nghĩa, gửi lại từ đầu.
    let reset = false;
    const checkEpoch = () => {
      if (epoch !== undefined && epoch !== live.epoch) { after = 0; v = -1; reset = true; epoch = live.epoch; }
    };
    checkEpoch();
    const fresh = () => live.version !== v || live.events.some((e) => e.seq > after);
    if (!fresh() && waitMs > 0) {
      await new Promise((resolve) => {
        const timer = setTimeout(done, waitMs);
        function done() {
          clearTimeout(timer);
          live.waiters.delete(done);
          resolve();
        }
        live.waiters.add(done);
      });
    }
    if (live.removed || !this.sessions.has(id)) throw new HttpError(404, t('Session đã bị xoá.', 'This session was removed.'));
    // Trong lúc chờ, lịch sử có thể đã được nạp lại bởi một client khác.
    checkEpoch();
    return {
      session: this.get(id),
      events: live.events.filter((e) => e.seq > after),
      partial: live.partial,
      pending: live.queue.length ? live.queue[0].request : null,
      v: live.version,
      epoch: live.epoch,
      reset,
      limits: this.limits,
    };
  }

  // ---------- nội bộ ----------

  #meta(id) {
    const meta = this.sessions.get(id);
    if (!meta) throw new HttpError(404, t(`Không có session ${id}.`, `No session ${id}.`));
    return meta;
  }

  #view(meta) {
    return { ...meta };
  }

  #live(id) {
    let live = this.live.get(id);
    if (!live) {
      const events = this.store.loadEvents(id);
      live = {
        events,
        seq: events.length ? events[events.length - 1].seq : 0,
        partial: '',
        queue: [], // các yêu cầu quyền đang chờ; app hiện cái đầu tiên
        version: 0,
        epoch: 0,
        waiters: new Set(),
        abort: null,
        removed: false,
      };
      this.live.set(id, live);
    }
    return live;
  }

  /** Dựng lại sự kiện từ transcript của Claude nếu nó mới hơn bản mình đang giữ. */
  async #resync(meta, force) {
    if (!meta.claudeSessionId) return;
    try {
      const info = await this.history.info(meta.claudeSessionId, meta.cwd);
      if (!info) return;
      // Trừ hao 2 giây: Claude có thể ghi transcript ngay sau khi lượt của mình kết thúc.
      if (!force && (info.updatedAt || 0) <= (meta.syncedAt || 0) + 2000) return;
      const raw = await this.history.events(meta.claudeSessionId, meta.cwd);
      if (!this.sessions.has(meta.id) || meta.status !== 'idle') return;
      if (!raw.length && !force) return;
      const live = this.#live(meta.id);
      const base = info.updatedAt || Date.now();
      live.events = raw.map((e, i) => ({ seq: i + 1, ts: base, ...e }));
      live.seq = live.events.length;
      live.epoch++;
      live.version++;
      this.store.replaceEvents(meta.id, live.events);
      meta.syncedAt = Date.now();
      this.#save();
      this.#wake(live);
    } catch (err) {
      // Không đọc được lịch sử thì vẫn dùng bản đang có, không chặn người dùng.
      console.error(`Không đồng bộ được lịch sử session ${meta.id}: ${err?.message || err}`);
    }
  }

  #save() {
    this.store.saveSessions([...this.sessions.values()]);
  }

  #wake(live) {
    for (const w of [...live.waiters]) w();
  }

  #bump(id) {
    const live = this.live.get(id);
    if (!live) return;
    live.version++;
    this.#wake(live);
  }

  #append(id, live, event) {
    const full = { seq: ++live.seq, ts: Date.now(), ...event };
    live.events.push(full);
    this.store.appendEvent(id, full);
    const meta = this.sessions.get(id);
    if (meta) meta.updatedAt = full.ts;
    live.version++;
    this.#wake(live);
    return full;
  }

  #denyPending(live, message) {
    for (const p of live.queue.splice(0)) p.resolve({ decision: 'deny', message, cancelled: true });
  }

  #onRunnerEvent(id, ev) {
    const meta = this.sessions.get(id);
    if (!meta) return;
    const live = this.#live(id);
    if (ev.type === 'partial') {
      live.partial = ev.text;
      this.#bump(id);
      return;
    }
    if (ev.type === 'init') {
      if (ev.claudeSessionId && ev.claudeSessionId !== meta.claudeSessionId) {
        meta.claudeSessionId = ev.claudeSessionId;
        this.#save();
      }
      return;
    }
    if (ev.type === 'limits') {
      const at = Date.now();
      for (const [type, w] of Object.entries(ev.limits || {})) this.limits[type] = { ...w, at };
      this.#bump(id);
      return;
    }
    if (ev.type === 'context') {
      meta.context = ev.context;
      this.#save();
      this.#bump(id);
      return;
    }
    if (ev.type === 'result' && typeof ev.costUsd === 'number') {
      meta.costUsd = Math.round(((meta.costUsd || 0) + ev.costUsd) * 1e6) / 1e6;
    }
    if (ev.type === 'mode') {
      if (MODES.includes(ev.mode)) { meta.mode = ev.mode; this.#save(); this.#bump(id); }
      return;
    }
    if (ev.type === 'assistant') live.partial = '';
    this.#append(id, live, ev);
  }

  /** `signal` do SDK cấp: báo khi chính Claude huỷ yêu cầu (không cần người dùng trả lời nữa). */
  #askPermission(id, req, signal) {
    const meta = this.sessions.get(id);
    if (!meta) return Promise.resolve({ decision: 'deny', message: 'Session không còn.' });
    if (signal?.aborted) return Promise.resolve({ decision: 'deny', message: 'Yêu cầu đã bị huỷ.', cancelled: true });
    const live = this.#live(id);
    const request = { requestId: crypto.randomBytes(6).toString('hex'), ...req };
    return new Promise((resolve) => {
      const entry = { request, resolve };
      live.queue.push(entry);
      meta.status = 'waiting';
      this.#append(id, live, { type: 'permission_request', ...request });
      signal?.addEventListener('abort', () => {
        const i = live.queue.indexOf(entry);
        if (i < 0) return; // đã được trả lời
        live.queue.splice(i, 1);
        if (!live.queue.length && meta.status === 'waiting') meta.status = 'running';
        if (this.sessions.has(id)) {
          this.#append(id, live, { type: 'permission_resolved', requestId: request.requestId, decision: 'cancelled' });
        }
        resolve({ decision: 'deny', message: 'Yêu cầu đã bị huỷ.', cancelled: true });
      }, { once: true });
    });
  }
}
