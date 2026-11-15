export type SortKey = 'activity' | 'modified' | 'name';
export type Server = { id: string; name: string; host: string; port: number; token: string; root?: string; sort?: SortKey };

export type Mode = 'default' | 'acceptEdits' | 'plan';
export type Status = 'idle' | 'running' | 'waiting';

export type Session = {
  id: string; title: string; cwd: string; mode: Mode; status: Status; model?: string | null;
  costUsd?: number; context?: { percentage: number; totalTokens: number; maxTokens: number; model: string };
  claudeSessionId: string | null; createdAt: number; updatedAt: number;
};

export type WorkspaceSession = {
  id: string | null; claudeSessionId: string | null; title: string; updatedAt: number;
  status: Status; mode: Mode; gitBranch: string | null;
};

export type Workspace = {
  name: string; path: string; isRoot: boolean; isRepo: boolean;
  sessions: number; active: number; updatedAt: number; modifiedAt: number;
};

export type ChatEvent = {
  seq: number; ts: number;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'permission_request' | 'permission_resolved'
    | 'result' | 'error' | 'stopped';
  text?: string; name?: string; input?: any; toolId?: string; isError?: boolean; ok?: boolean;
  requestId?: string; decision?: string; toolName?: string; title?: string; costUsd?: number | null;
};

export type Pending = {
  requestId: string; toolName: string; input: any; title: string; description: string;
  reason: string; canAlways: boolean;
};

export type PollResult = {
  session: Session; events: ChatEvent[]; partial: string; pending: Pending | null;
  v: number; epoch: number; reset: boolean; limits?: Limits;
};

export type Limits = Record<string, { percent: number; resetsAt: number | null; status: string; at: number }>;

export type ModelInfo = { value: string; name: string; description: string };
export type SlashCommand = { name: string; description: string; argumentHint: string };
export type McpServer = { name: string; status: string; error: string; scope: string; tools: string[] };
export type Capabilities = {
  models: ModelInfo[]; commands: SlashCommand[]; mcp: McpServer[]; account?: { plan: string; organization: string };
};

/** Lệnh khớp với chữ đang gõ sau dấu "/": khớp đầu tên xếp trước, rồi tới khớp giữa tên. */
export function matchCommands(commands: SlashCommand[], typed: string, limit = 8): SlashCommand[] {
  if (!typed.startsWith('/') || /\s/.test(typed)) return [];
  const q = typed.slice(1).toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const inside = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
  return [...starts, ...inside].slice(0, limit);
}

export type GitInfo = {
  repo: boolean; reason?: string; error?: string; root?: string; branch?: string | null; detached?: boolean;
  upstream?: string | null; ahead?: number; behind?: number; remote?: string | null;
  files?: { status: string; path: string; added?: number | null; removed?: number | null }[];
  commits?: { hash: string; author: string; when: string; subject: string }[];
};

export type DiffResult = { file: string; diff: string; untracked: boolean; binary: boolean; deleted: boolean; truncated: boolean };

export type DirList = { path: string; parent: string | null; isRepo?: boolean; dirs: { name: string; path: string; modifiedAt?: number }[] };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Người dùng có thể dán "http://100.1.2.3:7433/" hoặc chỉ "100.1.2.3". */
export function parseAddress(input: string, fallbackPort = 7433): { host: string; port: number } | null {
  let s = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!s) return null;
  let port = fallbackPort;
  const m = s.match(/^(.*):(\d{1,5})$/);
  if (m && !m[1].includes(':')) { s = m[1]; port = Number(m[2]); }
  if (!/^[a-zA-Z0-9.\-]+$/.test(s) || port < 1 || port > 65535) return null;
  return { host: s, port };
}

export type ServerLink = { hosts: string[]; port: number; token: string };

/**
 * Đọc link thêm máy chủ lấy từ mã QR hoặc deep link:
 *   http://host:port/add#t=TOKEN&p=PORT&h=host1,host2
 *   wujoagent://add#t=...   ·   exp://host:8081/--/add#t=...
 * Trả null nếu không phải link của claude-sessions.
 */
export function parseServerLink(text: string): ServerLink | null {
  const raw = (text || '').trim();
  const hashAt = raw.indexOf('#');
  if (hashAt < 0 || !/(^|\/)add\/?(\?[^#]*)?$/.test(raw.slice(0, hashAt))) return null;
  const params: Record<string, string> = {};
  for (const pair of raw.slice(hashAt + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try { params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1)); } catch { return null; }
  }
  const token = (params.t || '').trim();
  if (!token) return null;
  const hosts: string[] = [];
  const push = (h: string) => {
    const host = h.trim();
    if (host && /^[a-zA-Z0-9.\-]+$/.test(host) && !hosts.includes(host)) hosts.push(host);
  };
  let port = Number(params.p) || 0;
  // Link http: địa chỉ trong chính link là địa chỉ người dùng vừa quét, thử nó trước.
  const m = raw.match(/^https?:\/\/([^\/:#]+)(?::(\d+))?\//i);
  if (m) { push(m[1]); if (!port && m[2]) port = Number(m[2]); }
  for (const h of (params.h || '').split(',')) { try { push(decodeURIComponent(h)); } catch { /* bỏ qua */ } }
  if (!port) port = 7433;
  if (!hosts.length || port < 1 || port > 65535) return null;
  return { hosts, port, token };
}

/** Thử lần lượt các địa chỉ trong link, trả về máy chủ đầu tiên nối được và nhận token. */
export async function connectLink(link: ServerLink): Promise<Server> {
  let lastError: unknown = null;
  for (const host of link.hosts) {
    try {
      const api = new Api({ host, port: link.port, token: link.token });
      const health = await api.health();
      if (health.app !== 'claude-sessions') throw new ApiError(0, 'Địa chỉ này không phải máy chủ WujoAgent.');
      const info = await api.info(); // kiểm tra token
      return { id: `${Date.now()}`, name: info.name || host, host, port: link.port, token: link.token };
    } catch (e: any) {
      lastError = e;
      if (e?.status === 401 || e?.status === 429) break; // sai token thì địa chỉ khác cũng vậy
    }
  }
  throw lastError instanceof Error ? lastError : new ApiError(0, 'Không nối được máy chủ.');
}

export class Api {
  base: string;
  token: string;
  constructor(server: Pick<Server, 'host' | 'port' | 'token'>) {
    this.base = `http://${server.host}:${server.port}/api`;
    this.token = server.token;
  }

  async req<T>(method: string, path: string, body?: unknown, timeoutMs = 15000, outer?: AbortSignal): Promise<T> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const onOuter = () => ac.abort();
    outer?.addEventListener('abort', onOuter);
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      });
    } catch {
      if (outer?.aborted) throw new ApiError(-1, 'Đã huỷ.');
      throw new ApiError(0, 'Không nối được máy chủ. Kiểm tra IP, cổng, và máy tính đã chạy "wujoagent serve" chưa.');
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    }
    let data: any = null;
    try { data = await res.json(); } catch { /* không phải JSON */ }
    if (!res.ok) throw new ApiError(res.status, data?.error || `Máy chủ trả lỗi ${res.status}.`);
    return data as T;
  }

  health() { return this.req<{ ok: boolean; app: string }>('GET', '/health', undefined, 6000); }
  info() { return this.req<{ name: string; home: string; platform: string }>('GET', '/info', undefined, 6000); }
  dirs(path: string) { return this.req<DirList>('GET', `/dirs?path=${encodeURIComponent(path)}`); }
  workspaces(root: string) {
    return this.req<{ root: string; workspaces: Workspace[] }>('GET', `/workspaces?root=${encodeURIComponent(root)}`, undefined, 30000);
  }
  workspaceSessions(path: string) {
    return this.req<{ path: string; sessions: WorkspaceSession[] }>('GET', `/workspace-sessions?path=${encodeURIComponent(path)}`, undefined, 30000);
  }
  open(cwd: string, claudeSessionId?: string | null) {
    return this.req<{ session: Session }>('POST', '/sessions', { cwd, claudeSessionId: claudeSessionId || undefined }, 30000);
  }
  patch(id: string, body: { title?: string; mode?: Mode; model?: string | null }) {
    return this.req<{ session: Session }>('PATCH', `/sessions/${id}`, body);
  }
  capabilities(id: string, fresh = false) {
    return this.req<Capabilities>('GET', `/sessions/${id}/capabilities${fresh ? '?fresh=1' : ''}`, undefined, 40000);
  }
  remove(id: string) { return this.req<{ ok: boolean }>('DELETE', `/sessions/${id}`); }
  send(id: string, text: string) { return this.req<{ session: Session }>('POST', `/sessions/${id}/messages`, { text }); }
  interrupt(id: string) { return this.req<{ session: Session }>('POST', `/sessions/${id}/interrupt`); }
  permission(id: string, body: { requestId: string; decision: 'allow' | 'allow_always' | 'deny'; message?: string; answers?: Record<string, string> }) {
    return this.req<{ session: Session }>('POST', `/sessions/${id}/permission`, body);
  }
  poll(id: string, after: number, v: number, epoch: number | null, signal: AbortSignal) {
    const e = epoch === null ? '' : `&epoch=${epoch}`;
    return this.req<PollResult>('GET', `/sessions/${id}/events?after=${after}&v=${v}${e}&wait=25`, undefined, 40000, signal);
  }
  git(id: string) { return this.req<GitInfo>('GET', `/sessions/${id}/git`); }
  gitRun(id: string, op: 'fetch' | 'pull' | 'push') {
    return this.req<{ ok: boolean; op: string; output: string; info: GitInfo }>('POST', `/sessions/${id}/git`, { op }, 130000);
  }
  gitDiff(path: string, file: string) {
    return this.req<DiffResult>('GET', `/git/diff?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}`, undefined, 30000);
  }
  gitAt(path: string) { return this.req<GitInfo>('GET', `/git?path=${encodeURIComponent(path)}`); }
  gitRunAt(path: string, op: 'fetch' | 'pull' | 'push') {
    return this.req<{ ok: boolean; op: string; output: string; info: GitInfo }>('POST', '/git', { path, op }, 130000);
  }
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Sắp xếp thư mục: theo tên, hoặc mới sửa trước (không rõ ngày sửa thì xuống cuối). */
export function sortDirs<T extends { name: string; modifiedAt?: number }>(dirs: T[], key: 'modified' | 'name'): T[] {
  const out = [...dirs];
  if (key === 'modified') out.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0) || byName(a, b));
  else out.sort(byName);
  return out;
}

/**
 * Sắp xếp workspace: thư mục gốc đứng đầu, rồi các thư mục đã có session,
 * cuối cùng là các thư mục chưa có session. Trong mỗi nhóm xếp theo `key`.
 */
export function sortWorkspaces(items: Workspace[], key: SortKey): Workspace[] {
  const out = [...items];
  out.sort((a, b) => {
    if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
    if (!a.isRoot && (a.sessions > 0) !== (b.sessions > 0)) return a.sessions > 0 ? -1 : 1;
    if (key === 'modified') return (b.modifiedAt || 0) - (a.modifiedAt || 0) || byName(a, b);
    if (key === 'activity') return (b.updatedAt || 0) - (a.updatedAt || 0) || byName(a, b);
    return byName(a, b);
  });
  return out;
}

/** "còn 2 giờ 15 phút" cho thời điểm giới hạn được đặt lại. */
export function timeUntil(ts: number | null): string {
  if (!ts) return '';
  const m = Math.round((ts - Date.now()) / 60000);
  if (m <= 0) return 'sắp đặt lại';
  if (m < 60) return `đặt lại sau ${m} phút`;
  if (m < 60 * 24) return `đặt lại sau ${Math.floor(m / 60)} giờ ${m % 60} phút`;
  return `đặt lại sau ${Math.floor(m / 1440)} ngày ${Math.floor((m % 1440) / 60)} giờ`;
}

export function timeAgo(ts: number): string {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(ts).toLocaleDateString('vi-VN');
}
