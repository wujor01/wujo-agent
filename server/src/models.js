import os from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';

const TTL = 60 * 1000;
const cache = new Map(); // cwd -> { at, value }
const inflight = new Map(); // cwd -> Promise

/**
 * Hỏi Claude Code xem trong thư mục `cwd` có những gì dùng được:
 * model, lệnh gạch chéo (kể cả skill và lệnh riêng của dự án) và các MCP server.
 * Chỉ qua bước bắt tay của SDK, không gửi tin nhắn nào nên không tốn token.
 */
export async function capabilities(cwd = os.tmpdir(), { fresh = false } = {}) {
  const hit = cache.get(cwd);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value;
  if (!inflight.has(cwd)) {
    inflight.set(cwd, probe(cwd)
      .then((value) => { cache.set(cwd, { at: Date.now(), value }); return value; })
      .finally(() => inflight.delete(cwd)));
  }
  try {
    return await inflight.get(cwd);
  } catch (err) {
    if (hit) return hit.value; // bản cũ còn hơn không có gì
    throw err;
  }
}

async function probe(cwd) {
  const abortController = new AbortController();
  // Input không bao giờ phát tin nhắn: chỉ cần tiến trình Claude khởi động và trả lời bắt tay.
  async function* input() {
    await new Promise((resolve) => abortController.signal.addEventListener('abort', resolve, { once: true }));
  }
  const options = { cwd, abortController };
  if (process.env.CS_CLAUDE_PATH) options.pathToClaudeCodeExecutable = process.env.CS_CLAUDE_PATH;
  const q = query({ prompt: input(), options });
  const timer = setTimeout(() => abortController.abort(), 25000);
  try {
    const [models, commands, account] = await Promise.all([
      q.supportedModels(), q.supportedCommands(), q.accountInfo().catch(() => ({})),
    ]);
    // MCP server kết nối sau bước bắt tay; chờ tối đa 6 giây cho hết trạng thái "pending".
    let mcp = await q.mcpServerStatus();
    const t0 = Date.now();
    while (mcp.some((s) => s.status === 'pending') && Date.now() - t0 < 6000) {
      await new Promise((r) => setTimeout(r, 400));
      mcp = await q.mcpServerStatus();
    }
    return {
      // Không trả email: app chỉ cần biết gói đang dùng.
      account: { plan: account.subscriptionType || '', organization: account.organization || '' },
      models: models.map((m) => ({ value: m.value, name: m.displayName || m.value, description: m.description || '' })),
      commands: commands
        .map((c) => ({ name: c.name, description: c.description || '', argumentHint: c.argumentHint || '' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      // Không trả `config` của MCP server: trong đó có thể có token, biến môi trường.
      mcp: mcp.map((s) => ({
        name: s.name,
        status: s.status,
        error: s.error || '',
        scope: s.scope || '',
        tools: (s.tools || []).map((t) => t.name),
      })),
    };
  } finally {
    clearTimeout(timer);
    abortController.abort();
  }
}
