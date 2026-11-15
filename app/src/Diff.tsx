import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Api, ChatEvent, DiffResult } from './api';
import { Button, FullModal, mono, useTheme } from './ui';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export type SessionChange = {
  path: string; // đường dẫn tuyệt đối trên máy chủ
  name: string; // đường dẫn gọn để hiển thị (tương đối so với thư mục session nếu được)
  edits: number;
  created: boolean; // session này ghi mới toàn bộ file (Write)
  fallback: string; // diff dựng từ chính các lần sửa, dùng khi không có git
};

const norm = (p: string) => p.replace(/\\/g, '/');

/**
 * Các file mà session này đã ghi hoặc sửa, đọc từ lịch sử gọi tool.
 * Lần gọi bị từ chối hoặc lỗi không được tính.
 */
export function sessionChanges(events: ChatEvent[], cwd: string): SessionChange[] {
  const failed = new Set<string>();
  const answered = new Set<string>();
  for (const e of events) {
    if (e.type !== 'tool_result' || !e.toolId) continue;
    answered.add(e.toolId);
    if (e.isError) failed.add(e.toolId);
  }
  const root = norm(cwd).replace(/\/$/, '').toLowerCase();
  const byPath = new Map<string, SessionChange>();
  for (const e of events) {
    if (e.type !== 'tool_use' || !EDIT_TOOLS.has(e.name || '')) continue;
    if (!e.toolId || failed.has(e.toolId) || !answered.has(e.toolId)) continue;
    const input = e.input || {};
    const file = String(input.file_path || input.notebook_path || '');
    if (!file) continue;
    const key = norm(file).toLowerCase();
    let item = byPath.get(key);
    if (!item) {
      const full = norm(file);
      const name = full.toLowerCase().startsWith(root + '/') ? full.slice(root.length + 1) : full;
      item = { path: file, name, edits: 0, created: false, fallback: '' };
      byPath.set(key, item);
    }
    item.edits++;
    const parts: string[] = [];
    const minus = (t: unknown) => String(t ?? '').split('\n').map((l) => '-' + l).join('\n');
    const plus = (t: unknown) => String(t ?? '').split('\n').map((l) => '+' + l).join('\n');
    if (e.name === 'Write') {
      item.created = true;
      parts.push(`@@ ghi toàn bộ file @@\n${plus(input.content)}`);
    } else if (Array.isArray(input.edits)) {
      for (const ed of input.edits) parts.push(`@@ sửa @@\n${minus(ed.old_string)}\n${plus(ed.new_string)}`);
    } else if (typeof input.new_string === 'string' || typeof input.old_string === 'string') {
      parts.push(`@@ sửa @@\n${minus(input.old_string)}\n${plus(input.new_string)}`);
    } else if (typeof input.new_source === 'string') {
      parts.push(`@@ sửa ô notebook @@\n${plus(input.new_source)}`);
    }
    item.fallback += (item.fallback && parts.length ? '\n' : '') + parts.join('\n');
  }
  return [...byPath.values()];
}

/** Đếm số dòng thêm và bớt trong một đoạn diff. */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

export function DiffView({ diff }: { diff: string }) {
  const t = useTheme();
  const lines = diff.split('\n');
  const MAX = 1500;
  return (
    <ScrollView horizontal contentContainerStyle={{ minWidth: '100%' }}>
      <View style={{ minWidth: '100%' }}>
        {lines.slice(0, MAX).map((line, i) => {
          const kind = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
          const bg = kind === 'add' ? 'rgba(46,160,67,0.18)' : kind === 'del' ? 'rgba(248,81,73,0.18)' : 'transparent';
          const color = kind === 'hunk' ? t.accent : kind === 'add' ? t.ok : kind === 'del' ? t.danger : t.text;
          return (
            <Text key={i} selectable style={{
              fontFamily: mono, fontSize: 12, lineHeight: 18, color, backgroundColor: bg, paddingHorizontal: 10,
              fontWeight: kind === 'hunk' ? '700' : '400', marginTop: kind === 'hunk' && i > 0 ? 8 : 0,
            }}>
              {line || ' '}
            </Text>
          );
        })}
        {lines.length > MAX ? (
          <Text style={{ color: t.sub, fontSize: 12, padding: 10 }}>… còn {lines.length - MAX} dòng nữa không hiển thị.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

/**
 * Toàn màn hình: thay đổi của một file. Ưu tiên diff thật từ git; nếu file không
 * nằm trong repo nào thì hiện `fallback` (các lần sửa của chính session).
 */
export function DiffSheet({ api, dir, file, title, fallback, onClose }: {
  api: Api; dir: string; file: string; title: string; fallback?: string; onClose: () => void;
}) {
  const t = useTheme();
  const [result, setResult] = useState<DiffResult | null>(null);
  const [error, setError] = useState('');
  const [fromSession, setFromSession] = useState(false);

  useEffect(() => {
    let alive = true;
    setResult(null); setError(''); setFromSession(false);
    api.gitDiff(dir, file).then((r) => {
      if (!alive) return;
      // Git không thấy khác biệt (đã commit rồi, hoặc bị .gitignore) nhưng session có sửa: hiện phần session sửa.
      if (!r.diff && !r.binary && fallback) { setFromSession(true); setResult({ ...r, diff: fallback }); } else setResult(r);
    }).catch((e) => {
      if (!alive) return;
      if (fallback) { setFromSession(true); setResult({ file, diff: fallback, untracked: false, binary: false, deleted: false, truncated: false }); }
      else setError(e.message);
    });
    return () => { alive = false; };
  }, [api, dir, file, fallback]);

  const stats = result ? diffStats(result.diff) : null;
  return (
    <FullModal onClose={onClose}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={{ color: t.text, fontSize: 15, fontWeight: '600', fontFamily: mono }}>{title}</Text>
            {result ? (
              <Text style={{ fontSize: 12, marginTop: 2, color: t.sub }}>
                <Text style={{ color: t.ok, fontWeight: '700' }}>+{stats!.added}</Text>{'  '}
                <Text style={{ color: t.danger, fontWeight: '700' }}>−{stats!.removed}</Text>
                {result.untracked ? '  ·  file mới' : ''}{result.deleted ? '  ·  đã xoá' : ''}
                {fromSession ? '  ·  các lần sửa của session' : '  ·  so với commit gần nhất'}
              </Text>
            ) : null}
          </View>
          <Button small kind="plain" label="Đóng" onPress={onClose} />
        </View>
        {!result && !error ? <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} /> : null}
        {error ? <Text style={{ color: t.danger, padding: 16 }}>{error}</Text> : null}
        {result?.binary ? <Text style={{ color: t.sub, padding: 16 }}>File nhị phân, không hiển thị được nội dung.</Text> : null}
        {result && !result.binary && !result.diff ? (
          <Text style={{ color: t.sub, padding: 16 }}>File này không khác gì so với commit gần nhất.</Text>
        ) : null}
        {result && result.diff ? (
          <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
            <DiffView diff={result.diff} />
            {result.truncated ? <Text style={{ color: t.warn, fontSize: 12, padding: 10 }}>File quá lớn, chỉ hiện phần đầu.</Text> : null}
          </ScrollView>
        ) : null}
    </FullModal>
  );
}
