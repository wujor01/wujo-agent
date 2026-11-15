import { query } from '@anthropic-ai/claude-agent-sdk';
import { flatten, clip } from './history.js';

/**
 * Chạy một lượt chat bằng Claude Agent SDK và đổi các message của SDK
 * thành sự kiện gọn cho app. Quyền chạy tool được hỏi qua `askPermission`,
 * giống cách extension VS Code hỏi.
 */
export async function claudeRunner({ text, cwd, resume, mode, model, signal, onEvent, askPermission }) {
  const abortController = new AbortController();
  if (signal.aborted) abortController.abort();
  signal.addEventListener('abort', () => abortController.abort(), { once: true });

  // canUseTool cần input dạng stream; giữ stream mở tới khi lượt kết thúc.
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  async function* input() {
    yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    await finished;
  }

  const options = {
    cwd,
    permissionMode: mode,
    includePartialMessages: true,
    abortController,
    canUseTool: async (toolName, toolInput, ctx) => {
      const answer = await askPermission({
        toolName,
        input: toolInput,
        title: ctx?.title || '',
        description: ctx?.description || '',
        reason: ctx?.decisionReason || '',
        canAlways: Array.isArray(ctx?.suggestions) && ctx.suggestions.length > 0,
      }, ctx?.signal);
      if (answer.decision === 'deny') {
        return {
          behavior: 'deny',
          message: answer.message || 'Người dùng từ chối thao tác này.',
          interrupt: Boolean(answer.cancelled),
        };
      }
      const result = { behavior: 'allow', updatedInput: toolInput };
      if (toolName === 'AskUserQuestion' && answer.answers && typeof answer.answers === 'object') {
        result.updatedInput = { ...toolInput, answers: answer.answers };
      }
      if (answer.decision === 'allow_always' && ctx?.suggestions?.length) {
        result.updatedPermissions = ctx.suggestions;
        const setMode = ctx.suggestions.find((s) => s.type === 'setMode');
        if (setMode) onEvent({ type: 'mode', mode: setMode.mode });
      }
      // Duyệt kế hoạch xong thì rời chế độ plan, như trên VS Code.
      if (toolName === 'ExitPlanMode') onEvent({ type: 'mode', mode: 'default' });
      return result;
    },
  };
  if (resume) options.resume = resume;
  if (model) options.model = model;
  if (process.env.CS_CLAUDE_PATH) options.pathToClaudeCodeExecutable = process.env.CS_CLAUDE_PATH;

  let partial = '';
  let sawResult = false;
  try {
    const q = query({ prompt: input(), options });
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        onEvent({ type: 'init', claudeSessionId: msg.session_id, model: msg.model });
      } else if (msg.type === 'stream_event') {
        if (msg.parent_tool_use_id) continue; // bỏ qua chữ đang gõ của subagent
        const ev = msg.event;
        if (ev.type === 'message_start') partial = '';
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          partial += ev.delta.text;
          onEvent({ type: 'partial', text: partial });
        }
      } else if (msg.type === 'assistant') {
        partial = '';
        const sub = Boolean(msg.parent_tool_use_id);
        for (const block of msg.message?.content || []) {
          if (block.type === 'text' && block.text.trim() && !sub) {
            onEvent({ type: 'assistant', text: block.text });
          } else if (block.type === 'tool_use') {
            onEvent({ type: 'tool_use', toolId: block.id, name: block.name, input: block.input, sub });
          }
        }
      } else if (msg.type === 'user') {
        const content = msg.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          onEvent({
            type: 'tool_result',
            toolId: block.tool_use_id,
            isError: Boolean(block.is_error),
            text: clip(flatten(block.content)),
          });
        }
      } else if (msg.type === 'rate_limit_event') {
        onEvent({ type: 'limits', limits: readLimits(msg.rate_limit_info) });
      } else if (msg.type === 'result') {
        sawResult = true;
        const ok = msg.subtype === 'success' && !msg.is_error;
        onEvent({
          type: 'result',
          ok,
          text: ok ? '' : String(msg.result || (msg.errors || []).join('\n') || msg.subtype),
          costUsd: msg.total_cost_usd ?? null,
          durationMs: msg.duration_ms ?? null,
          turns: msg.num_turns ?? null,
        });
        // Hỏi mức dùng ngữ cảnh khi tiến trình còn sống; không có cũng không sao.
        try {
          const ctx = await Promise.race([
            q.getContextUsage(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
          ]);
          onEvent({
            type: 'context',
            context: { percentage: ctx.percentage, totalTokens: ctx.totalTokens, maxTokens: ctx.maxTokens, model: ctx.model },
          });
        } catch { /* bỏ qua */ }
        break;
      }
    }
  } finally {
    finish();
  }
  if (!sawResult && !signal.aborted) throw new Error('Claude kết thúc mà không trả kết quả.');
  if (signal.aborted && !sawResult) throw new Error('aborted');
}

/** Rút gọn thông tin giới hạn sử dụng của tài khoản: mỗi cửa sổ (5 giờ, 7 ngày…) một mục. */
export function readLimits(info) {
  const out = {};
  const put = (type, w) => {
    if (!type || !w || typeof w.utilization !== 'number') return;
    out[type] = {
      percent: Math.round(w.utilization * 100),
      resetsAt: w.resetsAt ? w.resetsAt * 1000 : null,
      status: w.status || 'allowed',
    };
  };
  for (const [type, w] of Object.entries(info?.unifiedWindows || {})) put(type, w);
  if (!out[info?.rateLimitType]) put(info?.rateLimitType, info);
  return out;
}
