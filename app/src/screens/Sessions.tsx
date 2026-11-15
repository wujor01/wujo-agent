import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Api, GitInfo, Session, Workspace, WorkspaceSession, timeAgo } from '../api';
import { Pressable } from 'react-native';
import { Badge, Button, Card, Empty, Header, Notice, mono, useTheme } from '../ui';
import { DiffSheet } from '../Diff';
import { confirm } from './Servers';
import { tr } from '../i18n';

type Op = 'fetch' | 'pull' | 'push';

function GitPanel({ api, path }: { api: Api; path: string }) {
  const t = useTheme();
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [busy, setBusy] = useState<Op | null>(null);
  const [output, setOutput] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    api.gitAt(path).then(setInfo).catch((e) => setOutput({ ok: false, text: e.message }));
  }, [api, path]);
  useEffect(load, [load]);

  async function run(op: Op) {
    setBusy(op); setOutput(null);
    try {
      const r = await api.gitRunAt(path, op);
      setOutput({ ok: r.ok, text: r.output });
      setInfo(r.info);
    } catch (e: any) {
      setOutput({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  if (!info || !info.repo) return null;
  const files = info.files || [];
  const commits = info.commits || [];
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', fontFamily: mono }}>
          {info.detached ? '(detached HEAD)' : info.branch}
        </Text>
        {info.upstream ? (
          <Text style={{ color: t.sub, fontSize: 13 }}>↑{info.ahead} ↓{info.behind} {tr('so với', 'vs.')} {info.upstream}</Text>
        ) : <Text style={{ color: t.warn, fontSize: 13 }}>{tr('chưa có upstream', 'no upstream')}</Text>}
      </View>
      {info.error ? <Text style={{ color: t.danger, fontSize: 13, marginTop: 4 }}>{info.error}</Text> : (
        <Text style={{ color: files.length ? t.warn : t.sub, fontSize: 13, marginTop: 4 }}>
          {files.length ? tr(`${files.length} file thay đổi chưa commit`, `${files.length} uncommitted ${files.length === 1 ? 'file' : 'files'}`) : tr('Không có thay đổi chưa commit', 'No uncommitted changes')}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Button small kind="plain" label="Fetch" onPress={() => run('fetch')} busy={busy === 'fetch'} disabled={!!busy} />
        <Button small kind="plain" label="Pull" onPress={() => run('pull')} busy={busy === 'pull'} disabled={!!busy} />
        <Button small kind="plain" label="Push" busy={busy === 'push'} disabled={!!busy}
          onPress={() => confirm(tr('Push lên remote?', 'Push to remote?'), tr(`Nhánh ${info.branch || ''} → ${info.upstream || 'remote'}`, `Branch ${info.branch || ''} → ${info.upstream || 'remote'}`), () => run('push'))} />
        <Button small kind="plain" label={open ? tr('Ẩn commit', 'Hide commits') : tr('Commit gần đây', 'Recent commits')} onPress={() => setOpen(!open)} />
      </View>
      {output ? (
        <Text selectable style={{ color: output.ok ? t.sub : t.danger, fontFamily: mono, fontSize: 12, marginTop: 10 }}>
          {output.text}
        </Text>
      ) : null}
      {files.length > 0 ? (
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: t.border }}>
          {(showAll ? files : files.slice(0, 12)).map((f) => (
            <Pressable key={f.path} onPress={() => setViewing(f.path)} accessibilityRole="button"
              accessibilityLabel={tr(`Xem thay đổi của ${f.path}`, `View changes in ${f.path}`)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9,
                borderBottomWidth: 1, borderBottomColor: t.border, opacity: pressed ? 0.6 : 1,
              })}>
              <Text style={{
                width: 20, textAlign: 'center', fontFamily: mono, fontSize: 12, fontWeight: '700',
                color: f.status === '?' || f.status.includes('A') ? t.ok : f.status.includes('D') ? t.danger : t.warn,
              }}>{f.status === '?' ? 'U' : f.status[0]}</Text>
              <Text numberOfLines={1} ellipsizeMode="head" style={{ color: t.text, fontFamily: mono, fontSize: 13, flex: 1 }}>{f.path}</Text>
              {typeof f.added === 'number' ? <Text style={{ color: t.ok, fontSize: 12, fontWeight: '700' }}>+{f.added}</Text> : null}
              {typeof f.removed === 'number' ? <Text style={{ color: t.danger, fontSize: 12, fontWeight: '700' }}>−{f.removed}</Text> : null}
              <Text style={{ color: t.sub, fontSize: 16 }}>›</Text>
            </Pressable>
          ))}
          {files.length > 12 ? (
            <Pressable onPress={() => setShowAll(!showAll)} accessibilityRole="button" style={{ paddingVertical: 9 }}>
              <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>
                {showAll ? tr('Thu gọn', 'Show less') : tr(`Xem tất cả ${files.length} file`, `Show all ${files.length} files`)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {viewing ? <DiffSheet api={api} dir={path} file={viewing} title={viewing} onClose={() => setViewing(null)} /> : null}
      {open ? (
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: t.sub, fontSize: 12, marginBottom: 2 }}>{tr('Commit gần đây', 'Recent commits')}</Text>
          {commits.map((c) => (
            <Text key={c.hash} numberOfLines={1} style={{ color: t.text, fontSize: 12 }}>
              <Text style={{ fontFamily: mono, color: t.sub }}>{c.hash} </Text>{c.subject}
              <Text style={{ color: t.sub }}> · {c.when}</Text>
            </Text>
          ))}
          {commits.length === 0 ? <Text style={{ color: t.sub, fontSize: 12 }}>{tr('Chưa có commit.', 'No commits yet.')}</Text> : null}
        </View>
      ) : null}
    </Card>
  );
}

export function Sessions({ api, workspace, onBack, onOpen }: {
  api: Api; workspace: Workspace; onBack: () => void; onOpen: (s: Session) => void;
}) {
  const t = useTheme();
  const [items, setItems] = useState<WorkspaceSession[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setItems((await api.workspaceSessions(workspace.path)).sessions);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api, workspace.path]);
  useEffect(() => { load(); }, [load]);

  async function open(claudeSessionId?: string | null) {
    if (opening) return;
    setOpening(true); setError('');
    try {
      onOpen((await api.open(workspace.path, claudeSessionId)).session);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOpening(false);
    }
  }

  async function openItem(s: WorkspaceSession) {
    if (!s.id) return open(s.claudeSessionId);
    // Session đã thuộc hệ thống: mở thẳng.
    onOpen({
      id: s.id, title: s.title, cwd: workspace.path, mode: s.mode, status: s.status,
      claudeSessionId: s.claudeSessionId, createdAt: s.updatedAt, updatedAt: s.updatedAt,
    });
  }

  return (
    <View style={{ flex: 1 }}>
      <Header title={workspace.name} subtitle={workspace.path} onBack={onBack}
        right={<Button small label={tr('Session mới', 'New session')} onPress={() => open(null)} busy={opening} />} />
      <FlatList
        data={items || []}
        keyExtractor={(s) => s.id || s.claudeSessionId || s.title}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.accent} />}
        ListHeaderComponent={<View><GitPanel api={api} path={workspace.path} /><Notice text={error} /></View>}
        ListEmptyComponent={!loading && !error ? <Empty text={tr('Workspace này chưa có session. Bấm Session mới để bắt đầu.', 'No sessions yet in this workspace. Tap New session to start.')} /> : undefined}
        renderItem={({ item: s }) => (
          <Card onPress={() => openItem(s)}
            onLongPress={s.id ? () => confirm(tr('Gỡ session khỏi app?', 'Remove session from the app?'), tr('Lịch sử của Claude trên máy chủ vẫn còn nguyên.', "Claude's history on the server is kept."), async () => {
              try { await api.remove(s.id!); load(); } catch (e: any) { setError(e.message); }
            }) : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={2} style={{ color: t.text, fontSize: 15, fontWeight: '500', flex: 1 }}>
                {s.title || tr('(chưa có tiêu đề)', '(untitled)')}
              </Text>
              {s.status === 'running' ? <Badge text={tr('đang chạy', 'running')} color={t.ok} /> : null}
              {s.status === 'waiting' ? <Badge text={tr('chờ duyệt', 'needs approval')} color={t.warn} /> : null}
            </View>
            <Text style={{ color: t.sub, marginTop: 3, fontSize: 12 }}>
              {timeAgo(s.updatedAt)}{s.gitBranch ? ` · ${s.gitBranch}` : ''}
            </Text>
          </Card>
        )}
      />
    </View>
  );
}
