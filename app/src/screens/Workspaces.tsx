import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, Pressable, RefreshControl, ScrollView, Text, View,
} from 'react-native';
import { Api, DirList, Server, SortKey, Workspace, sortDirs, sortWorkspaces, timeAgo } from '../api';
import { Badge, Button, Card, Empty, Field, Header, KeyboardShift, Notice, Segmented, mono, useTheme } from '../ui';
import { tr } from '../i18n';

/** Chọn thư mục gốc trên máy chủ bằng cách đi từng cấp. */
function DirPicker({ api, start, initialSort, onPick, onCancel }: {
  api: Api; start: string; initialSort: 'modified' | 'name'; onPick: (path: string) => void; onCancel: () => void;
}) {
  const t = useTheme();
  const [list, setList] = useState<DirList | null>(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState(start);
  const [roots, setRoots] = useState<DirList['dirs']>([]);
  const [sort, setSort] = useState<'modified' | 'name'>(initialSort);

  const go = useCallback(async (path: string) => {
    Keyboard.dismiss(); // bàn phím không được che danh sách thư mục vừa mở
    setError('');
    try { const l = await api.dirs(path); setList(l); setTyped(l.path); } catch (e: any) {
      setError(e.message);
      if (path) { try { setList(await api.dirs('')); } catch { /* giữ lỗi đầu */ } }
    }
  }, [api]);

  useEffect(() => { go(start); }, [go, start]);
  // Ổ đĩa và thư mục Home luôn hiện sẵn, không bắt người dùng bấm "Lên trên" tới tận gốc.
  useEffect(() => { api.dirs('').then((l) => setRoots(l.dirs)).catch(() => {}); }, [api]);

  const current = (list?.path || '').toLowerCase();
  return (
    <KeyboardShift>
      <Header title={tr('Chọn thư mục gốc', 'Choose root folder')} subtitle={list?.path || tr('Ổ đĩa', 'Drives')} onBack={onCancel} />
      {roots.length > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {roots.map((r) => {
            const here = current === r.path.toLowerCase();
            return (
              <Pressable key={r.path} onPress={() => go(r.path)} accessibilityRole="button"
                accessibilityLabel={r.name === 'Home' ? tr('Thư mục Home', 'Home folder') : tr(`Ổ đĩa ${r.name}`, `Drive ${r.name}`)}
                accessibilityState={{ selected: here }}
                style={({ pressed }) => ({
                  borderWidth: here ? 2 : 1, borderColor: here ? t.accent : t.border, backgroundColor: t.card,
                  borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, minWidth: 52, alignItems: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{r.name.replace(/\\$/, '')}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={{ padding: 16, paddingBottom: 8, flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={tr('Chọn thư mục này', 'Choose this folder')} disabled={!list?.path} onPress={() => list?.path && onPick(list.path)} />
        </View>
        {list && list.parent !== null ? <Button kind="plain" label={tr('Lên trên', 'Up')} onPress={() => go(list.parent || '')} /> : null}
      </View>
      <View style={{ paddingHorizontal: 16, flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field label={tr('Hoặc gõ đường dẫn', 'Or type a path')} value={typed} onChangeText={setTyped} placeholder="E:\work\repos"
            onSubmitEditing={() => go(typed.trim())} returnKeyType="go" />
        </View>
        <View style={{ marginBottom: 12 }}><Button kind="plain" label={tr('Đi tới', 'Go')} disabled={!typed.trim()} onPress={() => go(typed.trim())} /></View>
      </View>
      <View style={{ paddingHorizontal: 16 }}><Notice text={error} /></View>
      {list && list.path ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <Segmented label={tr('Sắp xếp', 'Sort')} value={sort} onChange={setSort}
            options={[{ value: 'modified', label: tr('Ngày sửa', 'Modified') }, { value: 'name', label: tr('Tên', 'Name') }]} />
        </View>
      ) : null}
      {!list ? <ActivityIndicator style={{ marginTop: 30 }} color={t.accent} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
          {list.path && list.parent !== null ? (
            <Card onPress={() => go(list.parent || '')}>
              <Text style={{ color: t.text, fontSize: 15, fontFamily: mono, fontWeight: '700' }}>..</Text>
              <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>{list.parent || tr('Ổ đĩa', 'Drives')}</Text>
            </Card>
          ) : null}
          {(list.path ? sortDirs(list.dirs, sort) : list.dirs).map((d) => (
            <Card key={d.path} onPress={() => go(d.path)}>
              <Text style={{ color: t.text, fontSize: 15 }}>{d.name}</Text>
              {list.path && d.modifiedAt ? <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>{tr(`Sửa ${timeAgo(d.modifiedAt)}`, `Modified ${timeAgo(d.modifiedAt)}`)}</Text> : null}
            </Card>
          ))}
          {list.dirs.length === 0 ? <Empty text={tr('Không có thư mục con.', 'No subfolders.')} /> : null}
        </ScrollView>
      )}
    </KeyboardShift>
  );
}

export function Workspaces({ server, api, onBack, onOpen, onSetRoot, onSetSort }: {
  server: Server; api: Api; onBack: () => void; onOpen: (w: Workspace) => void; onSetRoot: (root: string) => void;
  onSetSort: (sort: SortKey) => void;
}) {
  // Giá trị lạ (bản cũ lưu 'created') thì quay về mặc định.
  const sort: SortKey = server.sort === 'modified' || server.sort === 'name' ? server.sort : 'activity';
  const t = useTheme();
  const [items, setItems] = useState<Workspace[] | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(!server.root);
  const [home, setHome] = useState('');

  const load = useCallback(async () => {
    if (!server.root) return;
    setLoading(true); setError('');
    try {
      const res = await api.workspaces(server.root);
      setItems(res.workspaces); setParent(res.parent ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api, server.root]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.info().then((i) => setHome(i.home)).catch(() => {}); }, [api]);

  const sorted = sortWorkspaces(items || [], sort);
  // Vị trí thư mục đầu tiên chưa có session: kẻ một dòng phân cách phía trên nó (nếu phía trên có thư mục đã có session).
  const firstEmptyAt = sorted.findIndex((w) => !w.isRoot && w.sessions === 0);
  const firstEmpty = firstEmptyAt > 0 && sorted.some((w) => !w.isRoot && w.sessions > 0) ? firstEmptyAt : -1;

  if (picking) {
    return (
      <DirPicker api={api} start={server.root || home} initialSort={sort === 'name' ? 'name' : 'modified'}
        onPick={(p) => { setPicking(false); setItems(null); onSetRoot(p); }}
        onCancel={() => (server.root ? setPicking(false) : onBack())} />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Header title={server.name} subtitle={server.root} onBack={onBack}
        right={<Button small kind="plain" label={tr('Đổi thư mục', 'Change folder')} onPress={() => setPicking(true)} />} />
      <FlatList
        data={sorted}
        keyExtractor={(w) => w.path}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.accent} />}
        ListHeaderComponent={(
          <View style={{ marginBottom: 12 }}>
            <Notice text={error} />
            <Segmented label={tr('Sắp xếp', 'Sort')} value={sort} onChange={onSetSort}
              options={[{ value: 'activity', label: tr('Hoạt động', 'Activity') }, { value: 'modified', label: tr('Ngày sửa', 'Modified') }, { value: 'name', label: tr('Tên', 'Name') }]} />
            {parent ? (
              <View style={{ marginTop: 12 }}>
                <Card onPress={() => { setItems(null); onSetRoot(parent); }}>
                  <Text style={{ color: t.text, fontSize: 16, fontFamily: mono, fontWeight: '700' }}>..</Text>
                  <Text numberOfLines={1} ellipsizeMode="head" style={{ color: t.sub, marginTop: 3, fontSize: 13 }}>{parent}</Text>
                </Card>
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={!loading && !error ? <Empty text={tr('Thư mục này không có thư mục con.', 'This folder has no subfolders.')} /> : undefined}
        renderItem={({ item: w, index }) => (
          <View>
            {index === firstEmpty ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 14 }}
                accessibilityRole="header" accessibilityLabel={tr('Các thư mục chưa có session', 'Folders with no sessions yet')}>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
                <Text style={{ color: t.sub, fontSize: 12, fontWeight: '600' }}>{tr('Chưa có session', 'No sessions yet')}</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
              </View>
            ) : null}
          <Card onPress={() => onOpen(w)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '600', flexShrink: 1 }}>
                {w.name}{w.isRoot ? tr(' (thư mục gốc)', ' (root folder)') : ''}
              </Text>
              {w.isRepo ? <Badge text="git" color={t.sub} /> : null}
              {w.active > 0 ? <Badge text={tr('đang chạy', 'running')} color={t.ok} /> : null}
            </View>
            <Text style={{ color: t.sub, marginTop: 3, fontSize: 13 }}>
              {w.sessions > 0 ? tr(`${w.sessions} session · ${timeAgo(w.updatedAt)}`, `${w.sessions} ${w.sessions === 1 ? 'session' : 'sessions'} · ${timeAgo(w.updatedAt)}`) : tr('Chưa có session', 'No sessions yet')}
              {sort === 'modified' && w.modifiedAt ? tr(` · sửa ${timeAgo(w.modifiedAt)}`, ` · modified ${timeAgo(w.modifiedAt)}`) : ''}
            </Text>
          </Card>
          </View>
        )}
      />
    </View>
  );
}
