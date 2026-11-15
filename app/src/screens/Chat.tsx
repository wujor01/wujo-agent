import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, Modal, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { Api, Capabilities, ChatEvent, Limits, Mode, Pending, Session, matchCommands, timeUntil } from '../api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Header, KeyboardShift, mono, useTheme } from '../ui';
import { DiffSheet, SessionChange, sessionChanges } from '../Diff';

const MODE_LABEL: Record<Mode, string> = { default: 'Hỏi trước khi sửa', acceptEdits: 'Tự sửa file', plan: 'Lập kế hoạch' };
const MODE_ORDER: Mode[] = ['default', 'acceptEdits', 'plan'];

/** Tóm tắt một lần gọi tool thành một dòng dễ đọc trên điện thoại. */
export function toolSummary(name: string, input: any): string {
  const i = input || {};
  const base = (p: unknown) => String(p || '').split(/[\\/]/).pop() || '';
  switch (name) {
    case 'Bash': case 'PowerShell': return String(i.command || '').split('\n')[0];
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return base(i.file_path || i.notebook_path);
    case 'Glob': case 'Grep': return String(i.pattern || '');
    case 'WebFetch': return String(i.url || '');
    case 'WebSearch': return String(i.query || '');
    case 'Agent': case 'Task': return String(i.description || '');
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string');
      return first ? String(first).split('\n')[0] : '';
    }
  }
}

function permissionDetail(p: Pending): string {
  const i = p.input || {};
  if (typeof i.command === 'string') return i.command;
  if (typeof i.plan === 'string') return i.plan;
  if (typeof i.file_path === 'string') {
    if (typeof i.content === 'string') return `${i.file_path}\n\n${i.content.slice(0, 1500)}`;
    if (typeof i.new_string === 'string') return `${i.file_path}\n\n- ${String(i.old_string || '').slice(0, 600)}\n+ ${i.new_string.slice(0, 600)}`;
    return i.file_path;
  }
  return JSON.stringify(i, null, 2).slice(0, 1500);
}

/** `mã` và **đậm** trong một dòng; mọi thứ khác giữ nguyên văn. */
export function inlineTokens(line: string): { text: string; kind: 'plain' | 'code' | 'bold' }[] {
  return line.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).filter(Boolean).map((tok) => {
    if (tok.length > 2 && tok.startsWith('`') && tok.endsWith('`')) return { text: tok.slice(1, -1), kind: 'code' as const };
    if (tok.length > 4 && tok.startsWith('**') && tok.endsWith('**')) return { text: tok.slice(2, -2), kind: 'bold' as const };
    return { text: tok, kind: 'plain' as const };
  });
}

function inline(line: string, codeBg: string) {
  return inlineTokens(line).map((tok, i) => {
    if (tok.kind === 'code') return <Text key={i} style={{ fontFamily: mono, fontSize: 14, backgroundColor: codeBg }}>{tok.text}</Text>;
    if (tok.kind === 'bold') return <Text key={i} style={{ fontWeight: '700' }}>{tok.text}</Text>;
    return tok.text;
  });
}

/** Văn bản có khối ``` hiển thị chữ đơn cách; phần còn lại giữ nguyên. */
function RichText({ text, color }: { text: string; color: string }) {
  const t = useTheme();
  const parts = useMemo(() => text.split(/```[^\n]*\n?/), [text]);
  return (
    <View>
      {parts.map((part, idx) => {
        if (!part) return null;
        if (idx % 2 === 1) {
          return (
            <View key={idx} style={[s.code, { backgroundColor: t.code }]}>
              <Text selectable style={{ color: t.text, fontFamily: mono, fontSize: 12.5 }}>{part.replace(/\n$/, '')}</Text>
            </View>
          );
        }
        return (
          <Text key={idx} selectable style={{ color, fontSize: 15.5, lineHeight: 22 }}>
            {part.trim().split('\n').map((line, n, all) => {
              const heading = /^#{1,6}\s+/.test(line);
              const body = heading ? line.replace(/^#{1,6}\s+/, '') : line;
              return (
                <Text key={n} style={heading ? { fontWeight: '700' } : undefined}>
                  {inline(body, t.code)}{n < all.length - 1 ? '\n' : ''}
                </Text>
              );
            })}
          </Text>
        );
      })}
    </View>
  );
}

type Row =
  | { key: string; kind: 'user' | 'assistant' | 'note' | 'error'; text: string }
  | { key: string; kind: 'tool'; name: string; summary: string; result?: string; isError?: boolean };

function buildRows(events: ChatEvent[]): Row[] {
  const rows: Row[] = [];
  const tools = new Map<string, Extract<Row, { kind: 'tool' }>>();
  for (const e of events) {
    const key = `e${e.seq}`;
    if (e.type === 'user') rows.push({ key, kind: 'user', text: e.text || '' });
    else if (e.type === 'assistant') rows.push({ key, kind: 'assistant', text: e.text || '' });
    else if (e.type === 'tool_use') {
      const row = { key, kind: 'tool' as const, name: e.name || 'tool', summary: toolSummary(e.name || '', e.input) };
      if (e.toolId) tools.set(e.toolId, row);
      rows.push(row);
    } else if (e.type === 'tool_result') {
      const row = e.toolId ? tools.get(e.toolId) : undefined;
      if (row) { row.result = e.text; row.isError = e.isError; }
    } else if (e.type === 'permission_resolved') {
      const label = e.decision === 'cancelled' ? 'Yêu cầu quyền đã bị huỷ' : e.decision === 'deny' ? 'Đã từ chối' : e.decision === 'allow_always' ? 'Đã cho phép (luôn luôn)' : 'Đã cho phép';
      rows.push({ key, kind: 'note', text: label });
    } else if (e.type === 'error') rows.push({ key, kind: 'error', text: e.text || 'Lỗi' });
    else if (e.type === 'stopped') rows.push({ key, kind: 'note', text: e.text || 'Đã dừng.' });
    else if (e.type === 'result' && !e.ok) rows.push({ key, kind: 'error', text: e.text || 'Lượt chat kết thúc với lỗi.' });
  }
  return rows;
}

function ToolRow({ row }: { row: Extract<Row, { kind: 'tool' }> }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(!open)} accessibilityRole="button"
      style={[s.tool, { borderColor: row.isError ? t.danger : t.border }]}>
      <Text numberOfLines={open ? 6 : 1} style={{ color: t.sub, fontSize: 13 }}>
        <Text style={{ fontWeight: '700', color: row.isError ? t.danger : t.text }}>{row.name}</Text>
        {row.summary ? <Text style={{ fontFamily: mono }}>  {row.summary}</Text> : null}
      </Text>
      {open && row.result ? (
        <Text selectable style={{ color: row.isError ? t.danger : t.sub, fontFamily: mono, fontSize: 12, marginTop: 6 }}>
          {row.result.slice(0, 3000)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function PermissionCard({ pending, onAnswer, busy }: {
  pending: Pending; busy: boolean;
  onAnswer: (decision: 'allow' | 'allow_always' | 'deny', answers?: Record<string, string>) => void;
}) {
  const t = useTheme();
  const questions: any[] = pending.toolName === 'AskUserQuestion' && Array.isArray(pending.input?.questions)
    ? pending.input.questions : [];
  const [answers, setAnswers] = useState<Record<string, string>>({});

  if (questions.length) {
    const done = questions.every((q) => answers[q.question]);
    return (
      <View style={[s.perm, { borderColor: t.accent, backgroundColor: t.card }]}>
        {questions.map((q) => (
          <View key={q.question} style={{ marginBottom: 10 }}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', marginBottom: 6 }}>{q.question}</Text>
            {(q.options || []).map((o: any) => {
              const picked = answers[q.question] === o.label;
              return (
                <Pressable key={o.label} onPress={() => setAnswers({ ...answers, [q.question]: o.label })}
                  accessibilityRole="button" accessibilityState={{ selected: picked }}
                  style={[s.option, { borderColor: picked ? t.accent : t.border, borderWidth: picked ? 2 : 1 }]}>
                  <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{o.label}</Text>
                  {o.description ? <Text style={{ color: t.sub, fontSize: 13, marginTop: 2 }}>{o.description}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button label="Gửi câu trả lời" disabled={!done} busy={busy} onPress={() => onAnswer('allow', answers)} /></View>
          <Button kind="plain" label="Bỏ qua" disabled={busy} onPress={() => onAnswer('deny')} />
        </View>
      </View>
    );
  }

  const isPlan = pending.toolName === 'ExitPlanMode';
  return (
    <View style={[s.perm, { borderColor: t.accent, backgroundColor: t.card }]}>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>
        {isPlan ? 'Claude đã lập xong kế hoạch. Cho làm theo?' : pending.title || `Claude muốn dùng ${pending.toolName}`}
      </Text>
      {pending.reason ? <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>{pending.reason}</Text> : null}
      <View style={[s.code, { backgroundColor: t.code, maxHeight: 220, overflow: 'hidden' }]}>
        <Text selectable style={{ color: t.text, fontFamily: mono, fontSize: 12.5 }}>{permissionDetail(pending)}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flexGrow: 1 }}><Button label={isPlan ? 'Đồng ý' : 'Cho phép'} busy={busy} onPress={() => onAnswer('allow')} /></View>
        {pending.canAlways && !isPlan ? <Button kind="plain" label="Luôn cho phép" disabled={busy} onPress={() => onAnswer('allow_always')} /> : null}
        <Button kind="danger" label="Từ chối" disabled={busy} onPress={() => onAnswer('deny')} />
      </View>
    </View>
  );
}

/** Bảng trượt từ dưới lên cho chọn model và xem MCP. */
function Sheet({ title, onClose, children, action }: {
  title: string; onClose: () => void; children: React.ReactNode; action?: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets(); // lấy từ app, vì Modal không có lề an toàn riêng
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Đóng" />
      <View style={[s.sheet, { backgroundColor: t.bg, borderColor: t.border, paddingBottom: 16 + insets.bottom }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '600', flex: 1 }}>{title}</Text>
          {action}
          <Button small kind="plain" label="Đóng" onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}

const LIMIT_LABEL: Record<string, string> = {
  five_hour: 'Giới hạn 5 giờ', seven_day: 'Giới hạn 7 ngày', seven_day_opus: '7 ngày (Opus)',
  seven_day_sonnet: '7 ngày (Sonnet)', overage: 'Dùng vượt mức',
};

/** Thanh phần trăm có nhãn; đổi màu khi gần đầy. */
function Meter({ label, percent, note }: { label: string; percent: number; note?: string }) {
  const t = useTheme();
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const color = p >= 90 ? t.danger : p >= 70 ? t.warn : t.accent;
  return (
    <View style={{ marginBottom: 12 }} accessible accessibilityLabel={`${label}: ${p} phần trăm. ${note || ''}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: t.text, fontSize: 14 }}>{label}</Text>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>{p}%</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: t.code, marginTop: 5, overflow: 'hidden' }}>
        <View style={{ height: 8, width: `${p}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
      {note ? <Text style={{ color: t.sub, fontSize: 12, marginTop: 3 }}>{note}</Text> : null}
    </View>
  );
}

function SectionTitle({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={{ color: t.sub, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 14, marginBottom: 8 }}>{text.toUpperCase()}</Text>;
}

const MCP_LABEL: Record<string, string> = {
  connected: 'đã kết nối', failed: 'lỗi', 'needs-auth': 'cần đăng nhập', pending: 'đang kết nối', disabled: 'đã tắt',
};

export function Chat({ api, session: initial, onBack }: { api: Api; session: Session; onBack: () => void }) {
  const t = useTheme();
  const [session, setSession] = useState(initial);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [partial, setPartial] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [offline, setOffline] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<FlatList<Row>>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState('');
  const [capsLoading, setCapsLoading] = useState(false);
  const [sheet, setSheet] = useState<'model' | 'settings' | 'changes' | null>(null);
  const [viewing, setViewing] = useState<SessionChange | null>(null);
  const [limits, setLimits] = useState<Limits>({});

  // Model, lệnh gạch chéo và MCP server dùng được trong workspace này.
  async function loadCaps(fresh: boolean) {
    setCapsLoading(true); setCapsError('');
    try { setCaps(await api.capabilities(initial.id, fresh)); } catch (e: any) { setCapsError(e.message); } finally { setCapsLoading(false); }
  }
  useEffect(() => { loadCaps(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [api, initial.id]);

  // Vòng long-poll: nối lại từ con trỏ khi mất mạng hoặc điện thoại ngủ dậy.
  useEffect(() => {
    const ac = new AbortController();
    let after = 0, v = -1, epoch: number | null = null;
    (async () => {
      while (!ac.signal.aborted) {
        try {
          const out = await api.poll(initial.id, after, v, epoch, ac.signal);
          if (ac.signal.aborted) return;
          const fresh = out.events;
          if (out.reset || epoch === null) setEvents(fresh);
          else if (fresh.length) setEvents((prev) => [...prev, ...fresh.filter((e) => e.seq > (prev.at(-1)?.seq ?? 0))]);
          if (fresh.length) after = fresh[fresh.length - 1].seq;
          else if (out.reset) after = 0;
          v = out.v; epoch = out.epoch;
          setSession(out.session); setPartial(out.partial); setPending(out.pending);
          if (out.limits) setLimits(out.limits);
          setOffline(''); setLoaded(true);
        } catch (e: any) {
          if (ac.signal.aborted) return;
          if (e?.status === 404) { setOffline('Session này đã bị xoá trên máy chủ.'); return; }
          if (e?.status === 401 || e?.status === 429) { setOffline(e.message); return; }
          setOffline('Mất kết nối, đang thử lại…');
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
    return () => ac.abort();
  }, [api, initial.id]);

  const rows = useMemo(() => buildRows(events), [events]);
  const changes = useMemo(() => sessionChanges(events, session.cwd), [events, session.cwd]);
  const busy = session.status !== 'idle';

  async function send() {
    const msg = text.trim();
    if (!msg || busy || sending) return;
    // Hai lệnh này là bảng điều khiển trong Claude Code, không phải lời nhắn cho Claude: mở bảng tương ứng.
    if (msg === '/mcp' || msg === '/usage' || msg === '/status') { setText(''); Keyboard.dismiss(); setSheet('settings'); loadCaps(true); return; }
    if (msg === '/model') { setText(''); Keyboard.dismiss(); setSheet('model'); return; }
    setSending(true); setError('');
    try {
      const r = await api.send(session.id, msg);
      setText(''); setSession(r.session);
    } catch (e: any) {
      setError(e.message); // giữ nguyên chữ đã gõ để gửi lại
    } finally {
      setSending(false);
    }
  }

  async function answer(decision: 'allow' | 'allow_always' | 'deny', answers?: Record<string, string>) {
    if (!pending) return;
    setAnswering(true); setError('');
    try {
      await api.permission(session.id, { requestId: pending.requestId, decision, answers });
      setPending(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnswering(false);
    }
  }

  async function pickModel(value: string) {
    setSheet(null);
    try { setSession((await api.patch(session.id, { model: value === 'default' ? null : value })).session); } catch (e: any) { setError(e.message); }
  }

  const suggestions = caps ? matchCommands(caps.commands, text) : [];
  const currentModel = session.model || 'default';
  const modelName = caps?.models.find((m) => m.value === currentModel)?.name || (session.model || 'Mặc định');

  async function setMode(next: Mode) {
    try { setSession((await api.patch(session.id, { mode: next })).session); } catch (e: any) { setError(e.message); }
  }
  const cycleMode = () => setMode(MODE_ORDER[(MODE_ORDER.indexOf(session.mode) + 1) % MODE_ORDER.length]);

  const footer = (
    <View>
      {partial ? <View style={s.row}><RichText text={partial} color={t.text} /></View> : null}
      {busy && !partial && !pending ? <Text style={{ color: t.sub, paddingHorizontal: 16, paddingVertical: 6 }}>Claude đang làm việc…</Text> : null}
      {pending ? <PermissionCard key={pending.requestId} pending={pending} onAnswer={answer} busy={answering} /> : null}
    </View>
  );

  return (
    <KeyboardShift>
      <Header title={session.title || 'Session mới'} subtitle={session.cwd} onBack={onBack}
        right={(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {changes.length > 0 ? (
            <Pressable onPress={() => { Keyboard.dismiss(); setSheet('changes'); }} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={`Session này đã sửa ${changes.length} file. Bấm để xem.`}
              style={{ borderWidth: 1, borderColor: t.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: t.accent, fontSize: 13, fontWeight: '700' }}>± {changes.length} file</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => { Keyboard.dismiss(); setSheet('settings'); loadCaps(false); }} hitSlop={10}
            accessibilityRole="button" accessibilityLabel="Cài đặt session" style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: t.accent, fontSize: 22 }}>⚙</Text>
          </Pressable>
          </View>
        )} />
      {offline ? <Text style={[s.banner, { color: t.warn, borderColor: t.border }]}>{offline}</Text> : null}
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingVertical: 10 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={!loaded ? undefined : (
          <Text style={{ color: t.sub, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
            Gõ tin nhắn đầu tiên để bắt đầu.
          </Text>
        )}
        ListFooterComponent={footer}
        renderItem={({ item: r }) => {
          if (r.kind === 'tool') return <ToolRow row={r} />;
          if (r.kind === 'user') {
            return (
              <View style={[s.user, { backgroundColor: t.userBubble }]}>
                <Text selectable style={{ color: t.text, fontSize: 15.5, lineHeight: 22 }}>{r.text}</Text>
              </View>
            );
          }
          if (r.kind === 'assistant') return <View style={s.row}><RichText text={r.text} color={t.text} /></View>;
          return (
            <Text style={{ color: r.kind === 'error' ? t.danger : t.sub, fontSize: 13, paddingHorizontal: 16, paddingVertical: 4 }}>
              {r.text}
            </Text>
          );
        }}
      />
      {error ? <Text style={[s.banner, { color: t.danger, borderColor: t.border }]}>{error}</Text> : null}
      {suggestions.length > 0 ? (
        <ScrollView style={[s.suggest, { borderTopColor: t.border, backgroundColor: t.card }]} keyboardShouldPersistTaps="handled">
          {suggestions.map((c) => (
            <Pressable key={c.name} onPress={() => setText(`/${c.name} `)} accessibilityRole="button"
              accessibilityLabel={`Lệnh ${c.name}`} style={({ pressed }) => [s.suggestRow, { opacity: pressed ? 0.6 : 1 }]}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 14 }}>
                <Text style={{ fontFamily: mono, fontWeight: '700' }}>/{c.name}</Text>
                {c.argumentHint ? <Text style={{ color: t.sub, fontFamily: mono }}> {c.argumentHint}</Text> : null}
              </Text>
              {c.description ? <Text numberOfLines={1} style={{ color: t.sub, fontSize: 12 }}>{c.description}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={[s.composer, { borderTopColor: t.border, backgroundColor: t.bg }]}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginBottom: 8, opacity: busy ? 0.5 : 1 }}>
          <Pressable onPress={cycleMode} disabled={busy} hitSlop={6} accessibilityRole="button"
            accessibilityLabel={`Chế độ: ${MODE_LABEL[session.mode]}. Bấm để đổi.`}>
            <Text style={{ color: t.sub, fontSize: 12.5 }}>Chế độ: <Text style={{ color: t.accent, fontWeight: '600' }}>{MODE_LABEL[session.mode]}</Text></Text>
          </Pressable>
          <Pressable onPress={() => { Keyboard.dismiss(); setSheet('model'); }} disabled={busy} hitSlop={6} accessibilityRole="button"
            accessibilityLabel={`Model: ${modelName}. Bấm để đổi.`}>
            <Text style={{ color: t.sub, fontSize: 12.5 }}>Model: <Text style={{ color: t.accent, fontWeight: '600' }}>{modelName}</Text></Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Nhắn cho Claude…"
            placeholderTextColor={t.sub}
            accessibilityLabel="Tin nhắn"
            multiline
            style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
          />
          {busy
            ? <Button kind="danger" label="Dừng" onPress={() => api.interrupt(session.id).catch((e) => setError(e.message))} />
            : <Button label="Gửi" onPress={send} busy={sending} disabled={!text.trim()} />}
        </View>
      </View>
      {sheet === 'model' ? (
        <Sheet title="Chọn model" onClose={() => setSheet(null)}>
          {capsLoading && !caps ? <ActivityIndicator color={t.accent} style={{ margin: 20 }} /> : null}
          {capsError && !caps ? (
            <View>
              <Text style={{ color: t.danger, marginBottom: 10 }}>{capsError}</Text>
              <Button kind="plain" label="Thử lại" onPress={() => loadCaps(true)} />
            </View>
          ) : null}
          {(caps?.models || []).map((m) => {
            const on = m.value === currentModel;
            return (
              <Pressable key={m.value} onPress={() => pickModel(m.value)} accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[s.option, { borderColor: on ? t.accent : t.border, borderWidth: on ? 2 : 1, backgroundColor: t.card }]}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{m.name}</Text>
                {m.description ? <Text style={{ color: t.sub, fontSize: 13, marginTop: 2 }}>{m.description}</Text> : null}
              </Pressable>
            );
          })}
          <Text style={{ color: t.sub, fontSize: 12, marginTop: 6, marginBottom: 8 }}>Model mới áp dụng từ tin nhắn kế tiếp.</Text>
        </Sheet>
      ) : null}
      {sheet === 'changes' ? (
        <Sheet title="File session này đã sửa" onClose={() => setSheet(null)}>
          {changes.map((c) => (
            <Pressable key={c.path} onPress={() => setViewing(c)} accessibilityRole="button"
              accessibilityLabel={`Xem thay đổi của ${c.name}`}
              style={[s.option, { borderColor: t.border, borderWidth: 1, backgroundColor: t.card, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} ellipsizeMode="head" style={{ color: t.text, fontFamily: mono, fontSize: 13 }}>{c.name}</Text>
                <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>
                  {c.created ? 'ghi toàn bộ file' : 'sửa'} · {c.edits} lần
                </Text>
              </View>
              <Text style={{ color: t.sub, fontSize: 18 }}>›</Text>
            </Pressable>
          ))}
          <Text style={{ color: t.sub, fontSize: 12, marginTop: 4, marginBottom: 8 }}>
            Bấm vào file để xem khác biệt so với commit gần nhất. File không thuộc git repo thì hiện chính các lần sửa của session.
          </Text>
        </Sheet>
      ) : null}
      {viewing ? (
        <DiffSheet api={api} dir={session.cwd} file={viewing.path} title={viewing.name} fallback={viewing.fallback}
          onClose={() => setViewing(null)} />
      ) : null}
      {sheet === 'settings' ? (
        <Sheet title="Cài đặt session" onClose={() => setSheet(null)}
          action={<Button small kind="plain" label="Tải lại" busy={capsLoading} onPress={() => loadCaps(true)} />}>
          {capsError ? <Text style={{ color: t.danger, marginBottom: 6 }}>{capsError}</Text> : null}

          <SectionTitle text="Model" />
          <Pressable onPress={() => setSheet('model')} disabled={busy} accessibilityRole="button"
            accessibilityLabel={`Model: ${modelName}. Bấm để đổi.`}
            style={[s.option, { borderColor: t.border, borderWidth: 1, backgroundColor: t.card, flexDirection: 'row', alignItems: 'center', opacity: busy ? 0.5 : 1 }]}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{modelName}</Text>
            <Text style={{ color: t.accent, fontSize: 14 }}>Đổi</Text>
          </Pressable>

          <SectionTitle text="Chế độ quyền" />
          {MODE_ORDER.map((m) => {
            const on = m === session.mode;
            return (
              <Pressable key={m} onPress={() => setMode(m)} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={[s.option, { borderColor: on ? t.accent : t.border, borderWidth: on ? 2 : 1, backgroundColor: t.card, opacity: busy ? 0.5 : 1 }]}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: on ? '700' : '500' }}>{MODE_LABEL[m]}</Text>
              </Pressable>
            );
          })}

          <SectionTitle text="Mức sử dụng" />
          {session.context ? (
            <Meter label="Ngữ cảnh của session" percent={session.context.percentage}
              note={`${session.context.totalTokens.toLocaleString('vi-VN')} / ${session.context.maxTokens.toLocaleString('vi-VN')} token`} />
          ) : null}
          {Object.entries(limits).map(([type, w]) => (
            <Meter key={type} label={LIMIT_LABEL[type] || type} percent={w.percent} note={timeUntil(w.resetsAt)} />
          ))}
          {!session.context && Object.keys(limits).length === 0 ? (
            <Text style={{ color: t.sub, fontSize: 13, marginBottom: 8 }}>Chưa có số liệu. Gửi một tin nhắn, số liệu sẽ cập nhật sau lượt đó.</Text>
          ) : null}
          {typeof session.costUsd === 'number' ? (
            <Text style={{ color: t.sub, fontSize: 13 }}>
              Chi phí quy đổi của session qua app: ${session.costUsd.toFixed(2)}
            </Text>
          ) : null}
          {caps?.account?.plan ? (
            <Text style={{ color: t.sub, fontSize: 13, marginTop: 2 }}>
              Gói: {caps.account.plan}{caps.account.organization ? ` · ${caps.account.organization}` : ''}
            </Text>
          ) : null}

          <SectionTitle text="MCP server" />
          {capsLoading && !caps ? <ActivityIndicator color={t.accent} style={{ margin: 12 }} /> : null}
          {caps && caps.mcp.length === 0 ? (
            <Text style={{ color: t.sub, fontSize: 13, marginBottom: 8 }}>Workspace này chưa cấu hình MCP server nào.</Text>
          ) : null}
          {(caps?.mcp || []).map((m) => (
            <View key={m.name} style={[s.option, { borderColor: t.border, borderWidth: 1, backgroundColor: t.card }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{m.name}</Text>
                <Text style={{ color: m.status === 'connected' ? t.ok : m.status === 'failed' ? t.danger : t.warn, fontSize: 13, fontWeight: '600' }}>
                  {MCP_LABEL[m.status] || m.status}
                </Text>
              </View>
              <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>
                {m.tools.length} tool{m.scope ? ` · ${m.scope}` : ''}
              </Text>
              {m.error ? <Text selectable style={{ color: t.danger, fontSize: 12, marginTop: 4 }}>{m.error}</Text> : null}
            </View>
          ))}
          <Text style={{ color: t.sub, fontSize: 12, marginTop: 4, marginBottom: 8 }}>
            Thêm, xoá hay đăng nhập MCP server thì làm trên máy tính bằng lệnh claude mcp.
          </Text>
        </Sheet>
      ) : null}
    </KeyboardShift>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '75%', borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
  suggest: { maxHeight: 220, flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth },
  suggestRow: { paddingHorizontal: 14, paddingVertical: 8 },
  row: { paddingHorizontal: 16, paddingVertical: 6 },
  user: { alignSelf: 'flex-end', maxWidth: '85%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 16, marginVertical: 6 },
  tool: { marginHorizontal: 16, marginVertical: 3, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  code: { borderRadius: 8, padding: 10, marginVertical: 8 },
  perm: { margin: 16, borderWidth: 1.5, borderRadius: 12, padding: 14 },
  option: { borderRadius: 10, padding: 10, marginBottom: 6 },
  banner: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16, maxHeight: 130, minHeight: 40 },
});
