import { query } from '@anthropic-ai/claude-agent-sdk';
import { flatten, clip } from './history.js';
import { t } from './lang.js';

/**
 * Chạy một lượt chat bằng Claude Agent SDK và đổi các message của SDK
 * thành sự kiện gọn cho app. Quyền chạy tool được hỏi qua `askPermission`,
 * giống cách extension VS Code hỏi.
 *
 * Tin gửi giữa lượt: `onInject(fn)` trao cho bên gọi hàm `fn(text)`. Gọi nó trong lúc Claude đang làm việc thì
 * tin được đưa thẳng vào lượt đang chạy; Claude đọc nó ở bước kế tiếp (sau khi tool đang chạy xong), hoặc ngay
 * sau câu trả lời nếu lượt vừa hết. `fn` trả false khi không còn nhận được nữa. Khi Claude thật sự đã nhận tin,
 * runner phát sự kiện `delivered` (count = số tin, theo thứ tự đã gửi).
 */
export async function claudeRunner({ text, cwd, resume, mode, model, signal, onEvent, askPermission, onInject }) {
  const abortController = new AbortController();
  if (signal.aborted) abortController.abort();
  signal.addEventListener('abort', () => abortController.abort(), { once: true });

  // canUseTool cần input dạng stream; giữ stream mở tới khi lượt kết thúc. Cũng qua stream này mà tin gửi
  // giữa lượt tới được Claude.
  const outgoing = [text];
  let wake = null;
  let closed = false;
  const close = () => { closed = true; wake?.(); };
  async function* input() {
    while (true) {
      while (outgoing.length) {
        yield { type: 'user', message: { role: 'user', content: outgoing.shift() }, parent_tool_use_id: null };
      }
      if (closed) return;
      await new Promise((resolve) => { wake = resolve; });
      wake = null;
    }
  }
  // Chỉ nhận tin giữa lượt khi Claude Code có báo trạng thái (đang chạy / đã rảnh): thiếu tín hiệu đó thì không
  // biết lượt đã hết thật chưa, tin gửi sát lúc kết thúc có thể rơi mất.
  let stateSeen = false;
  const waiting = []; // tin đã đưa vào mà Claude chưa nhận; mỗi mục { boundary }
  onInject?.((more) => {
    if (closed || !stateSeen || signal.aborted || abortController.signal.aborted) return false;
    outgoing.push(more);
    waiting.push({ boundary: false });
    wake?.();
    return true;
  });
  // Claude nhận tin chèn ở ranh giới giữa hai bước (tool vừa xong, hoặc lượt mới bắt đầu); yêu cầu gửi lên model
  // ngay sau ranh giới đó mới chứa tin.
  const boundary = () => { for (const w of waiting) w.boundary = true; };

  const options = {
    cwd,
    permissionMode: mode,
    includePartialMessages: true,
    // Mặc định Claude Code không gửi nội dung suy nghĩ (chỉ có chữ ký). 'summarized' cho bản tóm tắt chạy ra
    // dần, để app hiện được Claude đang nghĩ gì.
    thinking: { type: 'adaptive', display: 'summarized' },
    abortController,
    env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' },
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
  let thinking = ''; // bản tóm tắt suy nghĩ đang chạy ra của tin hiện tại
  let sawResult = false;
  let costSoFar = 0; // total_cost_usd là số cộng dồn của cả tiến trình; mỗi result chỉ báo phần tăng thêm
  let idleTimer = null;
  let idle; // xong khi Claude đã rảnh và không còn tin nào đang trên đường tới
  const idled = new Promise((resolve) => { idle = () => resolve(IDLE); });
  let it;
  try {
    const q = query({ prompt: input(), options });
    it = q[Symbol.asyncIterator]();
    while (true) {
      const next = it.next();
      next.catch(() => {}); // nếu mình rời vòng lặp vì đã rảnh, lỗi đến sau của lần đọc dở không được thành lỗi lạc
      const step = await Promise.race([next, idled]);
      if (step === IDLE || step.done) break;
      const msg = step.value;
      if (msg.type === 'system' && msg.subtype === 'init') {
        onEvent({ type: 'init', claudeSessionId: msg.session_id, model: msg.model });
      } else if (msg.type === 'system' && msg.subtype === 'session_state_changed') {
        clearTimeout(idleTimer);
        if (msg.state === 'running') {
          const first = !stateSeen;
          stateSeen = true;
          boundary();
          if (first) onEvent({ type: 'ready' });
          else onEvent({ type: 'activity', kind: 'working' });
        } else if (msg.state === 'idle' && sawResult) {
          // Còn tin vừa đưa vào mà Claude chưa nhận: nó sẽ mở lượt mới ngay ("running"). Chờ một chút; không thấy
          // thì kết thúc, bên gọi sẽ gửi lại các tin đó thành lượt sau.
          if (waiting.length || outgoing.length) idleTimer = setTimeout(idle, 5000);
          else break;
        }
      } else if (msg.type === 'stream_event') {
        if (msg.parent_tool_use_id) continue; // bỏ qua chữ đang gõ của subagent
        const ev = msg.event;
        if (ev.type === 'message_start') {
          partial = ''; thinking = '';
          let count = 0;
          while (waiting.length && waiting[0].boundary) { waiting.shift(); count++; }
          if (count) onEvent({ type: 'delivered', count });
        }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
          thinking += ev.delta.thinking;
          onEvent({ type: 'thinking_partial', text: thinking });
        }
        // Claude vừa chuyển sang việc gì: suy nghĩ, viết câu trả lời, hay gọi một tool.
        if (ev.type === 'content_block_start') {
          const kind = ev.content_block?.type;
          if (kind === 'thinking' || kind === 'redacted_thinking') onEvent({ type: 'activity', kind: 'thinking' });
          else if (kind === 'text') onEvent({ type: 'activity', kind: 'writing' });
          else if (kind === 'tool_use' || kind === 'server_tool_use') onEvent({ type: 'activity', kind: 'tool', name: ev.content_block.name });
        }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          partial += ev.delta.text;
          onEvent({ type: 'partial', text: partial });
        }
      } else if (msg.type === 'assistant') {
        partial = '';
        const sub = Boolean(msg.parent_tool_use_id);
        for (const block of msg.message?.content || []) {
          if (block.type === 'thinking' && block.thinking?.trim() && !sub) {
            thinking = '';
            onEvent({ type: 'thinking', text: clip(block.thinking) });
          } else if (block.type === 'text' && block.text.trim() && !sub) {
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
          if (!msg.parent_tool_use_id) boundary();
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
        // Tin đã đưa vào mà tới giờ Claude chưa nhận thì nó mở lượt mới với tin đó ngay sau đây; có khi nó đi
        // thẳng sang lượt mới mà không báo "rảnh" rồi "đang chạy".
        boundary();
        const ok = msg.subtype === 'success' && !msg.is_error;
        onEvent({
          type: 'result',
          ok,
          text: ok ? '' : String(msg.result || (msg.errors || []).join('\n') || msg.subtype),
          costUsd: typeof msg.total_cost_usd === 'number' ? Math.max(0, msg.total_cost_usd - costSoFar) : null,
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
        if (typeof msg.total_cost_usd === 'number') costSoFar = Math.max(costSoFar, msg.total_cost_usd);
        // Claude Code cũ không báo trạng thái: kết thúc ngay ở đây như trước (khi đó cũng không nhận tin giữa lượt).
        if (!stateSeen) break;
      }
    }
  } finally {
    clearTimeout(idleTimer);
    close();
    try { await it?.return?.(); } catch { /* tiến trình đã tắt */ }
  }
  if (!sawResult && !signal.aborted) throw new Error(t('Claude kết thúc mà không trả kết quả.', 'Claude ended without returning a result.'));
  if (signal.aborted && !sawResult) throw new Error('aborted');
}

const IDLE = Symbol('idle');

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
