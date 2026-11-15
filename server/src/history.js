import path from 'node:path';
import { listSessions, getSessionMessages, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

const MAX_RESULT_CHARS = 4000;

/** So sánh đường dẫn: Windows không phân biệt hoa thường. */
export function normPath(p) {
  let out = path.resolve(String(p || ''));
  if (out.length > 3) out = out.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

function titleOf(info) {
  return (info.customTitle || info.summary || info.firstPrompt || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function shape(info) {
  return {
    claudeSessionId: info.sessionId,
    title: titleOf(info),
    updatedAt: info.lastModified,
    cwd: info.cwd || null,
    gitBranch: info.gitBranch || null,
  };
}

/**
 * Đọc các session Claude Code có sẵn trên máy (kể cả session tạo từ VS Code,
 * terminal hay desktop) qua Agent SDK, tức là từ ~/.claude/projects.
 */
export const claudeHistory = {
  /** Mọi session trên máy (dir bỏ trống) hoặc của một thư mục. */
  async list(dir) {
    const opts = { includeProgrammatic: true };
    if (dir) opts.dir = dir;
    const all = await listSessions(opts);
    return all.filter((s) => !s.archived).map(shape);
  },

  async info(sessionId, dir) {
    const info = await getSessionInfo(sessionId, dir ? { dir } : undefined);
    return info ? shape(info) : null;
  },

  /** Lịch sử một session, đổi sang dạng sự kiện của app (chưa có seq). */
  async events(sessionId, dir) {
    const messages = await getSessionMessages(sessionId, dir ? { dir } : undefined);
    return transcriptToEvents(messages);
  },
};

// Chữ do hệ thống chèn vào lượt của người dùng, không phải lời họ gõ.
const NOISE = /^\s*<(system-reminder|local-command-|command-name|command-message|command-args|task-notification|user-prompt-submit-hook)/;

export function transcriptToEvents(messages) {
  const events = [];
  for (const m of messages) {
    if (m.parent_tool_use_id) continue; // lượt của subagent
    const content = m.message?.content;
    if (m.type === 'user') {
      if (typeof content === 'string') {
        if (content.trim() && !NOISE.test(content)) events.push({ type: 'user', text: content });
        continue;
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === 'text' && block.text.trim() && !NOISE.test(block.text)) {
          events.push({ type: 'user', text: block.text });
        } else if (block.type === 'tool_result') {
          events.push({
            type: 'tool_result',
            toolId: block.tool_use_id,
            isError: Boolean(block.is_error),
            text: clip(flatten(block.content)),
          });
        }
      }
    } else if (m.type === 'assistant') {
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === 'text' && block.text.trim()) events.push({ type: 'assistant', text: block.text });
        else if (block.type === 'tool_use') {
          events.push({ type: 'tool_use', toolId: block.id, name: block.name, input: block.input });
        }
      }
    }
  }
  return events;
}

export function flatten(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[hình ảnh]' : ''))
    .join('\n');
}

export function clip(text) {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS) + `\n… (cắt bớt, tổng ${text.length} ký tự)`;
}
