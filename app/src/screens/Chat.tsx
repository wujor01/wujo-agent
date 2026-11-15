import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, FlatList, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { Api, Capabilities, ChatEvent, Limits, Mode, Pending, PollResult, Server, Session, matchCommands, timeUntil } from '../api';
import { disablePush, enablePush, pushSupported, setOpenSession } from '../push';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Header, KeyboardShift, mono, useTheme } from '../ui';
import { DiffSheet, SessionChange, sessionChanges } from '../Diff';
import { locale, tr } from '../i18n';

const MODE_LABEL: Record<Mode, string> = {
  default: tr('Hỏi trước khi sửa', 'Ask before edits'), acceptEdits: tr('Tự sửa file', 'Auto-accept edits'), plan: tr('Lập kế hoạch', 'Plan mode'),
  auto: tr('Tự động', 'Auto'),
};
const MODE_ORDER: Mode[] = ['default', 'acceptEdits', 'plan', 'auto'];

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
      const label = e.decision === 'cancelled' ? tr('Yêu cầu quyền đã bị huỷ', 'Permission request cancelled')
        : e.decision === 'deny' ? tr('Đã từ chối', 'Denied')
        : e.decision === 'allow_always' ? tr('Đã cho phép (luôn luôn)', 'Allowed (always)') : tr('Đã cho phép', 'Allowed');
      rows.push({ key, kind: 'note', text: label });
    } else if (e.type === 'error') rows.push({ key, kind: 'error', text: e.text || tr('Lỗi', 'Error') });
    else if (e.type === 'stopped') rows.push({ key, kind: 'note', text: e.text || tr('Đã dừng.', 'Stopped.') });
    else if (e.type === 'result' && !e.ok) rows.push({ key, kind: 'error', text: e.text || tr('Lượt chat kết thúc với lỗi.', 'The turn ended with an error.') });
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
      <View>
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
          <View style={{ flex: 1 }}><Button label={tr('Gửi câu trả lời', 'Send answers')} disabled={!done} busy={busy} onPress={() => onAnswer('allow', answers)} /></View>
          <Button kind="plain" label={tr('Bỏ qua', 'Skip')} disabled={busy} onPress={() => onAnswer('deny')} />
        </View>
      </View>
    );
  }

  const isPlan = pending.toolName === 'ExitPlanMode';
  return (
    <View>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>
        {isPlan ? tr('Claude đã lập xong kế hoạch. Cho làm theo?', 'Claude has finished the plan. Go ahead with it?')
          : pending.title || tr(`Claude muốn dùng ${pending.toolName}`, `Claude wants to use ${pending.toolName}`)}
      </Text>
      {pending.reason ? <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>{pending.reason}</Text> : null}
      <ScrollView style={[s.code, { backgroundColor: t.code, maxHeight: 260, flexGrow: 0 }]} nestedScrollEnabled>
        <Text selectable style={{ color: t.text, fontFamily: mono, fontSize: 12.5 }}>{permissionDetail(pending)}</Text>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flexGrow: 1 }}><Button label={isPlan ? tr('Đồng ý', 'Approve') : tr('Cho phép', 'Allow')} busy={busy} onPress={() => onAnswer('allow')} /></View>
        {pending.canAlways && !isPlan ? <Button kind="plain" label={tr('Luôn cho phép', 'Always allow')} disabled={busy} onPress={() => onAnswer('allow_always')} /> : null}
        <Button kind="danger" label={tr('Từ chối', 'Deny')} disabled={busy} onPress={() => onAnswer('deny')} />
      </View>
    </View>
  );
}

/**
 * Dòng cho biết Claude đang làm gì và lượt này đã chạy bao lâu, để nhìn vào là biết agent còn đang xử lý.
 * Đồng hồ tự chạy mỗi giây ở phía app; nội dung do máy tính báo sang.
 */
function WorkingRow({ activity, started }: { activity: PollResult['activity']; started: number }) {
  const t = useTheme();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const label = !activity || activity.kind === 'working' ? tr('Claude đang làm việc', 'Claude is working')
    : activity.kind === 'starting' ? tr('Đang bắt đầu', 'Starting')
    : activity.kind === 'thinking' ? tr('Claude đang suy nghĩ', 'Claude is thinking')
    : activity.kind === 'writing' ? tr('Claude đang viết', 'Claude is writing')
    : tr(`Đang chạy ${activity.name || 'tool'}`, `Running ${activity.name || 'a tool'}`);
  const secs = started ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0;
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}s`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}
      accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="small" color={t.accent} />
      <Text style={{ color: t.sub, fontSize: 14 }}>{label}…</Text>
      {started ? <Text style={{ color: t.sub, fontSize: 13, fontVariant: ['tabular-nums'] }}>{elapsed}</Text> : null}
    </View>
  );
}

/**
 * Thẻ xin quyền hiện thành popup giữa màn hình, không nằm trong dòng chat (ở đó nó bị trôi khi chat cuộn).
 * "Xem cuộc trò chuyện" thu popup lại thành một thanh phía trên ô nhập để người dùng đọc lại ngữ cảnh
 * trước khi quyết định; yêu cầu vẫn đang chờ cho tới khi được trả lời.
 */
function PermissionPopup({ pending, onAnswer, busy, onHide }: {
  pending: Pending; busy: boolean; onHide: () => void;
  onAnswer: (decision: 'allow' | 'allow_always' | 'deny', answers?: Record<string, string>) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="fade" onRequestClose={onHide} statusBarTranslucent>
      <View style={[s.popupBackdrop, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={[s.popup, { backgroundColor: t.card, borderColor: t.accent }]} accessibilityViewIsModal
          accessibilityLabel={tr('Claude đang chờ bạn duyệt', 'Claude is waiting for your approval')}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
            <PermissionCard pending={pending} onAnswer={onAnswer} busy={busy} />
          </ScrollView>
          <Pressable onPress={onHide} disabled={busy} accessibilityRole="button" hitSlop={6}
            style={[s.popupHide, { borderTopColor: t.border }]}>
            <Text style={{ color: t.sub, fontSize: 13.5, fontWeight: '600' }}>{tr('Xem cuộc trò chuyện', 'View the conversation')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Bảng nổi từ đáy màn chat: cài đặt, chọn model, danh sách file đã sửa.
 *
 * Cố ý KHÔNG dùng Modal của hệ điều hành mà là một lớp phủ nằm trong chính màn chat. iOS chỉ cho hiện một
 * Modal tại một thời điểm: mở Modal thứ hai (xem diff của một file, popup xin quyền, hay chuyển từ bảng
 * cài đặt sang bảng chọn model) trong lúc Modal đầu còn đó thì cái thứ hai không hiện ra nhưng vẫn chặn
 * mọi thao tác, và app đơ. Lớp phủ thường thì không vướng giới hạn đó.
 */
function Sheet({ title, onClose, children, action }: {
  title: string; onClose: () => void; children: React.ReactNode; action?: React.ReactNode;
}) {
  const t = useTheme();
  // Nút Back của Android đóng bảng trước, chứ không rời màn chat.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);
  return (
    <View style={s.overlay} accessibilityViewIsModal>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={tr('Đóng', 'Close')} />
      <View style={[s.sheet, { backgroundColor: t.bg, borderColor: t.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '600', flex: 1 }}>{title}</Text>
          {action}
          <Button small kind="plain" label={tr('Đóng', 'Close')} onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </View>
  );
}

const LIMIT_LABEL: Record<string, string> = {
  five_hour: tr('Giới hạn 5 giờ', '5-hour limit'), seven_day: tr('Giới hạn 7 ngày', '7-day limit'),
  seven_day_opus: tr('7 ngày (Opus)', '7 days (Opus)'), seven_day_sonnet: tr('7 ngày (Sonnet)', '7 days (Sonnet)'),
  overage: tr('Dùng vượt mức', 'Extra usage'),
};

/** Thanh phần trăm có nhãn; đổi màu khi gần đầy. */
function Meter({ label, percent, note }: { label: string; percent: number; note?: string }) {
  const t = useTheme();
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const color = p >= 90 ? t.danger : p >= 70 ? t.warn : t.accent;
  return (
    <View style={{ marginBottom: 12 }} accessible accessibilityLabel={tr(`${label}: ${p} phần trăm. ${note || ''}`, `${label}: ${p} percent. ${note || ''}`)}>
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
  connected: tr('đã kết nối', 'connected'), failed: tr('lỗi', 'failed'), 'needs-auth': tr('cần đăng nhập', 'needs sign-in'),
  pending: tr('đang kết nối', 'connecting'), disabled: tr('đã tắt', 'disabled'),
};

export function Chat({ api, session: initial, server, onServerChange, onBack }: {
  api: Api; session: Session; server: Server; onServerChange: (s: Server) => void; onBack: () => void;
}) {
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

  // Giữ danh sách chat dính đáy. `atBottom` ghi lại người dùng có đang ở cuối cuộc trò chuyện không:
  // nếu có thì mọi lần khung chat đổi kích thước (bàn phím mở/đóng, ô nhập cao lên) hay có nội dung mới,
  // danh sách cuộn lại xuống cuối. Nếu họ đã kéo lên đọc tin cũ thì để nguyên chỗ họ đang đọc.
  const atBottom = useRef(true);
  const stickToEnd = useCallback((animated = false) => {
    if (atBottom.current) listRef.current?.scrollToEnd({ animated });
  }, []);
  useEffect(() => {
    // Bàn phím mở làm khung chat thấp đi: phần cuối bị hụt lên trên nếu không cuộn lại.
    // Ghi nhận vị trí TRƯỚC khi bàn phím lên (sau đó khoảng cách tới đáy đã bị cộng thêm chiều cao bàn phím).
    let wasAtBottom = true;
    const before = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      wasAtBottom = atBottom.current;
    });
    const after = Keyboard.addListener('keyboardDidShow', () => {
      if (!wasAtBottom) return;
      atBottom.current = true;
      listRef.current?.scrollToEnd({ animated: true });
      // Lần nữa sau khi bố cục ổn định, vì khung chat co lại theo hoạt ảnh của bàn phím.
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 120);
    });
    return () => { before.remove(); after.remove(); };
  }, []);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState('');
  const [capsLoading, setCapsLoading] = useState(false);
  const [sheet, setSheet] = useState<'model' | 'settings' | 'changes' | null>(null);
  const [viewing, setViewing] = useState<SessionChange | null>(null);
  const [limits, setLimits] = useState<Limits>({});
  const [activity, setActivity] = useState<PollResult['activity']>(null);
  const [started, setStarted] = useState(0); // thời điểm lượt hiện tại bắt đầu, quy về đồng hồ của điện thoại
  const [queued, setQueued] = useState<string[]>([]); // tin đã gửi trong lúc Claude bận, đang chờ lượt kế tiếp

  // Model, lệnh gạch chéo và MCP server dùng được trong workspace này.
  async function loadCaps(fresh: boolean) {
    setCapsLoading(true); setCapsError('');
    try { setCaps(await api.capabilities(initial.id, fresh)); } catch (e: any) { setCapsError(e.message); } finally { setCapsLoading(false); }
  }
  useEffect(() => { loadCaps(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [api, initial.id]);

  // Vòng long-poll: nối lại từ con trỏ khi mất mạng hoặc điện thoại ngủ dậy.
  // Khi app bị đưa xuống nền, vòng lặp huỷ yêu cầu đang treo và tạm nghỉ: máy chủ thấy kết nối đóng nên
  // biết không còn ai xem session, và sẽ gửi thông báo đẩy khi Claude xong hoặc xin quyền.
  useEffect(() => {
    const ac = new AbortController();
    let after = 0, v = -1, epoch: number | null = null;
    let request: AbortController | null = null;
    let wake: (() => void) | null = null;
    let active = AppState.currentState !== 'background';
    const sub = AppState.addEventListener('change', (state) => {
      active = state !== 'background';
      if (active) { wake?.(); wake = null; } else request?.abort();
    });
    ac.signal.addEventListener('abort', () => { request?.abort(); wake?.(); });
    setOpenSession({ tag: server.id, sessionId: initial.id });
    (async () => {
      while (!ac.signal.aborted) {
        if (!active) { await new Promise<void>((r) => { wake = r; }); continue; }
        try {
          request = new AbortController();
          const out = await api.poll(initial.id, after, v, epoch, request.signal);
          if (ac.signal.aborted) return;
          const fresh = out.events;
          if (out.reset || epoch === null) setEvents(fresh);
          else if (fresh.length) setEvents((prev) => [...prev, ...fresh.filter((e) => e.seq > (prev.at(-1)?.seq ?? 0))]);
          if (fresh.length) after = fresh[fresh.length - 1].seq;
          else if (out.reset) after = 0;
          v = out.v; epoch = out.epoch;
          setSession(out.session); setPartial(out.partial); setPending(out.pending);
          if (out.limits) setLimits(out.limits);
          setQueued(out.queued || []);
          setActivity(out.activity || null);
          setStarted(out.runningMs ? Date.now() - out.runningMs : 0);
          setOffline(''); setLoaded(true);
        } catch (e: any) {
          if (ac.signal.aborted) return;
          if (!active) continue; // yêu cầu bị huỷ vì app xuống nền, không phải mất kết nối
          if (e?.status === 404) { setOffline(tr('Session này đã bị xoá trên máy chủ.', 'This session was deleted on the server.')); return; }
          if (e?.status === 401 || e?.status === 429) { setOffline(e.message); return; }
          setOffline(tr('Mất kết nối, đang thử lại…', 'Connection lost, retrying…'));
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
    return () => { ac.abort(); sub.remove(); setOpenSession(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, initial.id]);

  const rows = useMemo(() => buildRows(events), [events]);
  const changes = useMemo(() => sessionChanges(events, session.cwd), [events, session.cwd]);
  const busy = session.status !== 'idle';

  async function send() {
    const msg = text.trim();
    if (!msg || sending) return; // Claude đang bận vẫn gửi được: máy tính xếp tin vào hàng chờ
    // Hai lệnh này là bảng điều khiển trong Claude Code, không phải lời nhắn cho Claude: mở bảng tương ứng.
    if (msg === '/mcp' || msg === '/usage' || msg === '/status') { setText(''); Keyboard.dismiss(); setSheet('settings'); loadCaps(true); return; }
    if (msg === '/model') { setText(''); Keyboard.dismiss(); setSheet('model'); return; }
    setSending(true); setError('');
    try {
      const r = await api.send(session.id, msg);
      setText(''); setSession(r.session);
      atBottom.current = true;
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

  // Popup xin quyền: mỗi yêu cầu mới lại bật lên, kể cả khi yêu cầu trước đã bị thu lại.
  const closeSheet = useCallback(() => setSheet(null), []);
  const [permHidden, setPermHidden] = useState(false);
  const pendingId = pending?.requestId;
  useEffect(() => { setPermHidden(false); if (pendingId) Keyboard.dismiss(); }, [pendingId]);

  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  async function togglePush() {
    setPushBusy(true); setPushError('');
    try {
      if (server.push) {
        if (server.pushToken) await disablePush(api, server.pushToken);
        onServerChange({ ...server, push: false, pushToken: undefined });
      } else {
        const token = await enablePush(api, server);
        onServerChange({ ...server, push: true, pushToken: token });
      }
    } catch (e: any) {
      setPushError(e?.message || tr('Không đổi được cài đặt thông báo.', 'Could not change the notification setting.'));
    } finally {
      setPushBusy(false);
    }
  }

  async function pickModel(value: string) {
    setSheet(null);
    try { setSession((await api.patch(session.id, { model: value === 'default' ? null : value })).session); } catch (e: any) { setError(e.message); }
  }

  const suggestions = caps ? matchCommands(caps.commands, text, 5) : []; // 5 dòng: vừa khoảng trống phía trên bàn phím
  const currentModel = session.model || 'default';
  const modelName = caps?.models.find((m) => m.value === currentModel)?.name || (session.model || tr('Mặc định', 'Default'));

  async function setMode(next: Mode) {
    try { setSession((await api.patch(session.id, { mode: next })).session); } catch (e: any) { setError(e.message); }
  }
  const cycleMode = () => setMode(MODE_ORDER[(MODE_ORDER.indexOf(session.mode) + 1) % MODE_ORDER.length]);

  const footer = (
    <View>
      {partial ? <View style={s.row}><RichText text={partial} color={t.text} /></View> : null}
      {busy && !pending ? <WorkingRow activity={activity} started={started} /> : null}
    </View>
  );

  return (
    <KeyboardShift>
      <Header title={session.title || tr('Session mới', 'New session')} subtitle={session.cwd} onBack={onBack}
        right={(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {changes.length > 0 ? (
            <Pressable onPress={() => { Keyboard.dismiss(); setSheet('changes'); }} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={tr(`Session này đã sửa ${changes.length} file. Bấm để xem.`, `This session changed ${changes.length} ${changes.length === 1 ? 'file' : 'files'}. Tap to view.`)}
              style={{ borderWidth: 1, borderColor: t.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: t.accent, fontSize: 13, fontWeight: '700' }}>± {changes.length} {tr('file', changes.length === 1 ? 'file' : 'files')}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => { Keyboard.dismiss(); setSheet('settings'); loadCaps(false); }} hitSlop={10}
            accessibilityRole="button" accessibilityLabel={tr('Cài đặt session', 'Session settings')} style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
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
        onContentSizeChange={() => stickToEnd()}
        onLayout={() => stickToEnd()}
        scrollEventThrottle={64}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          atBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
        }}
        ListEmptyComponent={!loaded ? undefined : (
          <Text style={{ color: t.sub, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
            {tr('Gõ tin nhắn đầu tiên để bắt đầu.', 'Type your first message to start.')}
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
      {pending && permHidden ? (
        <Pressable onPress={() => setPermHidden(false)} accessibilityRole="button"
          style={[s.waitBar, { backgroundColor: t.accent }]}>
          <Text style={{ color: t.accentText, fontSize: 14.5, fontWeight: '700', flex: 1 }}>
            {tr('Claude đang chờ bạn duyệt', 'Claude is waiting for your approval')}
          </Text>
          <Text style={{ color: t.accentText, fontSize: 14, fontWeight: '700' }}>{tr('Xem', 'Review')}</Text>
        </Pressable>
      ) : null}
      {pending && !permHidden && !sheet && !viewing ? (
        <PermissionPopup key={pending.requestId} pending={pending} onAnswer={answer} busy={answering}
          onHide={() => setPermHidden(true)} />
      ) : null}
      {queued.length > 0 ? (
        <View style={[s.queued, { borderTopColor: t.border, backgroundColor: t.card }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: t.sub, fontSize: 12, fontWeight: '700' }}>
              {tr(`${queued.length} tin chờ gửi khi Claude xong`, `${queued.length} ${queued.length === 1 ? 'message' : 'messages'} queued until Claude finishes`)}
            </Text>
            {queued.map((q, i) => (
              <Text key={i} numberOfLines={2} style={{ color: t.text, fontSize: 14, marginTop: 3 }}>{q}</Text>
            ))}
          </View>
          <Button small kind="plain" label={tr('Huỷ', 'Cancel')}
            onPress={() => api.clearQueue(session.id).then(() => setQueued([])).catch((e) => setError(e.message))} />
        </View>
      ) : null}
      {error ? <Text style={[s.banner, { color: t.danger, borderColor: t.border }]}>{error}</Text> : null}
      {suggestions.length > 0 ? (
        <View style={[s.suggest, { borderTopColor: t.border, backgroundColor: t.card }]}>
          {suggestions.map((c) => (
            <Pressable key={c.name} onPress={() => setText(`/${c.name} `)} accessibilityRole="button"
              accessibilityLabel={tr(`Lệnh ${c.name}`, `Command ${c.name}`)} style={({ pressed }) => [s.suggestRow, { opacity: pressed ? 0.6 : 1 }]}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 14 }}>
                <Text style={{ fontFamily: mono, fontWeight: '700' }}>/{c.name}</Text>
                {c.argumentHint ? <Text style={{ color: t.sub, fontFamily: mono }}> {c.argumentHint}</Text> : null}
              </Text>
              {c.description ? <Text numberOfLines={1} style={{ color: t.sub, fontSize: 12 }}>{c.description}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={[s.composer, { borderTopColor: t.border, backgroundColor: t.bg }]}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginBottom: 8, opacity: busy ? 0.5 : 1 }}>
          <Pressable onPress={cycleMode} disabled={busy} hitSlop={6} accessibilityRole="button"
            accessibilityLabel={tr(`Chế độ: ${MODE_LABEL[session.mode]}. Bấm để đổi.`, `Mode: ${MODE_LABEL[session.mode]}. Tap to change.`)}>
            <Text style={{ color: t.sub, fontSize: 12.5 }}>{tr('Chế độ', 'Mode')}: <Text style={{ color: t.accent, fontWeight: '600' }}>{MODE_LABEL[session.mode]}</Text></Text>
          </Pressable>
          <Pressable onPress={() => { Keyboard.dismiss(); setSheet('model'); }} disabled={busy} hitSlop={6} accessibilityRole="button"
            accessibilityLabel={tr(`Model: ${modelName}. Bấm để đổi.`, `Model: ${modelName}. Tap to change.`)}>
            <Text style={{ color: t.sub, fontSize: 12.5 }}>Model: <Text style={{ color: t.accent, fontWeight: '600' }}>{modelName}</Text></Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={tr('Nhắn cho Claude…', 'Message Claude…')}
            placeholderTextColor={t.sub}
            accessibilityLabel={tr('Tin nhắn', 'Message')}
            multiline
            style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
          />
          {busy ? <Button kind="danger" label={tr('Dừng', 'Stop')} onPress={() => api.interrupt(session.id).catch((e) => setError(e.message))} /> : null}
          {!busy || text.trim() ? <Button label={tr('Gửi', 'Send')} onPress={send} busy={sending} disabled={!text.trim()} /> : null}
        </View>
      </View>
      {sheet === 'model' ? (
        <Sheet title={tr('Chọn model', 'Choose model')} onClose={closeSheet}>
          {capsLoading && !caps ? <ActivityIndicator color={t.accent} style={{ margin: 20 }} /> : null}
          {capsError && !caps ? (
            <View>
              <Text style={{ color: t.danger, marginBottom: 10 }}>{capsError}</Text>
              <Button kind="plain" label={tr('Thử lại', 'Retry')} onPress={() => loadCaps(true)} />
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
          <Text style={{ color: t.sub, fontSize: 12, marginTop: 6, marginBottom: 8 }}>{tr('Model mới áp dụng từ tin nhắn kế tiếp.', 'The new model applies from the next message.')}</Text>
        </Sheet>
      ) : null}
      {sheet === 'changes' ? (
        <Sheet title={tr('File session này đã sửa', 'Files changed by this session')} onClose={closeSheet}>
          {changes.map((c) => (
            <Pressable key={c.path} onPress={() => setViewing(c)} accessibilityRole="button"
              accessibilityLabel={tr(`Xem thay đổi của ${c.name}`, `View changes in ${c.name}`)}
              style={[s.option, { borderColor: t.border, borderWidth: 1, backgroundColor: t.card, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} ellipsizeMode="head" style={{ color: t.text, fontFamily: mono, fontSize: 13 }}>{c.name}</Text>
                <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>
                  {c.created ? tr('ghi toàn bộ file', 'whole file written') : tr('sửa', 'edited')} · {tr(`${c.edits} lần`, `${c.edits} ${c.edits === 1 ? 'edit' : 'edits'}`)}
                </Text>
              </View>
              <Text style={{ color: t.sub, fontSize: 18 }}>›</Text>
            </Pressable>
          ))}
          <Text style={{ color: t.sub, fontSize: 12, marginTop: 4, marginBottom: 8 }}>
            {tr('Bấm vào file để xem khác biệt so với commit gần nhất. File không thuộc git repo thì hiện chính các lần sửa của session.',
              "Tap a file to see its diff against the last commit. Files outside a git repo show the session's own edits.")}
          </Text>
        </Sheet>
      ) : null}
      {viewing ? (
        <DiffSheet api={api} dir={session.cwd} file={viewing.path} title={viewing.name} fallback={viewing.fallback}
          onClose={() => setViewing(null)} />
      ) : null}
      {sheet === 'settings' ? (
        <Sheet title={tr('Cài đặt session', 'Session settings')} onClose={closeSheet}
          action={<Button small kind="plain" label={tr('Tải lại', 'Reload')} busy={capsLoading} onPress={() => loadCaps(true)} />}>
          {capsError ? <Text style={{ color: t.danger, marginBottom: 6 }}>{capsError}</Text> : null}

          <SectionTitle text="Model" />
          <Pressable onPress={() => setSheet('model')} disabled={busy} accessibilityRole="button"
            accessibilityLabel={tr(`Model: ${modelName}. Bấm để đổi.`, `Model: ${modelName}. Tap to change.`)}
            style={[s.option, { borderColor: t.border, borderWidth: 1, backgroundColor: t.card, flexDirection: 'row', alignItems: 'center', opacity: busy ? 0.5 : 1 }]}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{modelName}</Text>
            <Text style={{ color: t.accent, fontSize: 14 }}>{tr('Đổi', 'Change')}</Text>
          </Pressable>

          <SectionTitle text={tr('Chế độ quyền', 'Permission mode')} />
          {MODE_ORDER.map((m) => {
            const on = m === session.mode;
            return (
              <Pressable key={m} onPress={() => setMode(m)} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={[s.option, { borderColor: on ? t.accent : t.border, borderWidth: on ? 2 : 1, backgroundColor: t.card, opacity: busy ? 0.5 : 1 }]}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: on ? '700' : '500' }}>{MODE_LABEL[m]}</Text>
              </Pressable>
            );
          })}
          <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>
            {tr('Tự động: Claude tự duyệt các thao tác an toàn và chỉ hỏi bạn khi không chắc.', 'Auto: Claude approves safe actions itself and asks you only when unsure.')}
          </Text>

          <SectionTitle text={tr('Mức sử dụng', 'Usage')} />
          {session.context ? (
            <Meter label={tr('Ngữ cảnh của session', 'Session context')} percent={session.context.percentage}
              note={`${session.context.totalTokens.toLocaleString(locale)} / ${session.context.maxTokens.toLocaleString(locale)} ${tr('token', 'tokens')}`} />
          ) : null}
          {Object.entries(limits).map(([type, w]) => (
            <Meter key={type} label={LIMIT_LABEL[type] || type} percent={w.percent} note={timeUntil(w.resetsAt)} />
          ))}
          {!session.context && Object.keys(limits).length === 0 ? (
            <Text style={{ color: t.sub, fontSize: 13, marginBottom: 8 }}>{tr('Chưa có số liệu. Gửi một tin nhắn, số liệu sẽ cập nhật sau lượt đó.', 'No data yet. Send a message and the numbers will update after that turn.')}</Text>
          ) : null}
          {typeof session.costUsd === 'number' ? (
            <Text style={{ color: t.sub, fontSize: 13 }}>
              {tr('Chi phí quy đổi của session qua app', 'Equivalent cost of this session via the app')}: ${session.costUsd.toFixed(2)}
            </Text>
          ) : null}
          {caps?.account?.plan ? (
            <Text style={{ color: t.sub, fontSize: 13, marginTop: 2 }}>
              {tr('Gói', 'Plan')}: {caps.account.plan}{caps.account.organization ? ` · ${caps.account.organization}` : ''}
            </Text>
          ) : null}

          <SectionTitle text={tr('Thông báo', 'Notifications')} />
          {pushSupported ? (
            <Pressable onPress={togglePush} disabled={pushBusy} accessibilityRole="switch"
              accessibilityState={{ checked: !!server.push, busy: pushBusy }}
              accessibilityLabel={tr('Thông báo khi Claude xong hoặc cần duyệt', 'Notify when Claude finishes or needs approval')}
              style={[s.option, { borderColor: server.push ? t.accent : t.border, borderWidth: server.push ? 2 : 1, backgroundColor: t.card, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pushBusy ? 0.6 : 1 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>
                  {tr('Báo khi Claude xong hoặc cần duyệt', 'Notify when Claude finishes or needs approval')}
                </Text>
                <Text style={{ color: t.sub, fontSize: 12.5, marginTop: 3 }}>
                  {tr(`Áp dụng cho mọi session trên ${server.name}. Thông báo chỉ ghi tên thư mục dự án, không kèm nội dung trò chuyện, và đi qua dịch vụ đẩy của Expo và ${Platform.OS === 'ios' ? 'Apple' : 'Google'}.`,
                    `Applies to every session on ${server.name}. The notification shows only the project folder name, never chat content, and travels through the Expo and ${Platform.OS === 'ios' ? 'Apple' : 'Google'} push services.`)}
                </Text>
              </View>
              {pushBusy ? <ActivityIndicator color={t.accent} /> : (
                <Text style={{ color: server.push ? t.accent : t.sub, fontSize: 14, fontWeight: '700' }}>
                  {server.push ? tr('Đang bật', 'On') : tr('Đang tắt', 'Off')}
                </Text>
              )}
            </Pressable>
          ) : (
            <Text style={{ color: t.sub, fontSize: 13, marginBottom: 8 }}>
              {tr('Bản web không nhận được thông báo. Dùng app trên iPhone hoặc Android.', 'The web version cannot receive notifications. Use the iPhone or Android app.')}
            </Text>
          )}
          {pushError ? <Text style={{ color: t.danger, fontSize: 13, marginBottom: 6 }}>{pushError}</Text> : null}

          <SectionTitle text="MCP server" />
          {capsLoading && !caps ? <ActivityIndicator color={t.accent} style={{ margin: 12 }} /> : null}
          {caps && caps.mcp.length === 0 ? (
            <Text style={{ color: t.sub, fontSize: 13, marginBottom: 8 }}>{tr('Workspace này chưa cấu hình MCP server nào.', 'No MCP servers are configured for this workspace.')}</Text>
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
                {m.tools.length} {tr('tool', m.tools.length === 1 ? 'tool' : 'tools')}{m.scope ? ` · ${m.scope}` : ''}
              </Text>
              {m.error ? <Text selectable style={{ color: t.danger, fontSize: 12, marginTop: 4 }}>{m.error}</Text> : null}
            </View>
          ))}
          <Text style={{ color: t.sub, fontSize: 12, marginTop: 4, marginBottom: 8 }}>
            {tr('Thêm, xoá hay đăng nhập MCP server thì làm trên máy tính bằng lệnh claude mcp.', 'To add, remove or sign in to MCP servers, use the claude mcp command on the computer.')}
          </Text>
        </Sheet>
      ) : null}
    </KeyboardShift>
  );
}

const s = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, elevation: 50 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '75%', borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
  suggest: { flexGrow: 0, flexShrink: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  suggestRow: { paddingHorizontal: 14, paddingVertical: 7 },
  row: { paddingHorizontal: 16, paddingVertical: 6 },
  user: { alignSelf: 'flex-end', maxWidth: '85%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 16, marginVertical: 6 },
  tool: { marginHorizontal: 16, marginVertical: 3, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  code: { borderRadius: 8, padding: 10, marginVertical: 8 },
  popupBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  popup: { width: '100%', maxWidth: 520, maxHeight: '100%', borderWidth: 1.5, borderRadius: 16, overflow: 'hidden' },
  popupHide: { alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  queued: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  waitBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  option: { borderRadius: 10, padding: 10, marginBottom: 6 },
  banner: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16, maxHeight: 130, minHeight: 40 },
});
