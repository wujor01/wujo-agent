import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, Pressable, RefreshControl, ScrollView, Text, View,
} from 'react-native';
import { Api, DirList, Server, SortKey, Workspace, sortDirs, sortWorkspaces, timeAgo } from '../api';
import { Badge, Button, Card, Empty, Field, Header, KeyboardShift, Notice, Segmented, useTheme } from '../ui';

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
      <Header title="Chọn thư mục gốc" subtitle={list?.path || 'Ổ đĩa'} onBack={onCancel} />
      {roots.length > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {roots.map((r) => {
            const here = current === r.path.toLowerCase();
            return (
              <Pressable key={r.path} onPress={() => go(r.path)} accessibilityRole="button"
                accessibilityLabel={r.name === 'Home' ? 'Thư mục Home' : `Ổ đĩa ${r.name}`}
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
          <Button label="Chọn thư mục này" disabled={!list?.path} onPress={() => list?.path && onPick(list.path)} />
        </View>
        {list && list.parent !== null ? <Button kind="plain" label="Lên trên" onPress={() => go(list.parent || '')} /> : null}
      </View>
      <View style={{ paddingHorizontal: 16, flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field label="Hoặc gõ đường dẫn" value={typed} onChangeText={setTyped} placeholder="E:\work\repos"
            onSubmitEditing={() => go(typed.trim())} returnKeyType="go" />
        </View>
        <View style={{ marginBottom: 12 }}><Button kind="plain" label="Đi tới" disabled={!typed.trim()} onPress={() => go(typed.trim())} /></View>
      </View>
      <View style={{ paddingHorizontal: 16 }}><Notice text={error} /></View>
      {list && list.path ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <Segmented label="Sắp xếp" value={sort} onChange={setSort}
            options={[{ value: 'modified', label: 'Ngày sửa' }, { value: 'name', label: 'Tên' }]} />
        </View>
      ) : null}
      {!list ? <ActivityIndicator style={{ marginTop: 30 }} color={t.accent} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
          {(list.path ? sortDirs(list.dirs, sort) : list.dirs).map((d) => (
            <Card key={d.path} onPress={() => go(d.path)}>
              <Text style={{ color: t.text, fontSize: 15 }}>{d.name}</Text>
              {list.path && d.modifiedAt ? <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }}>Sửa {timeAgo(d.modifiedAt)}</Text> : null}
            </Card>
          ))}
          {list.dirs.length === 0 ? <Empty text="Không có thư mục con." /> : null}
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(!server.root);
  const [home, setHome] = useState('');

  const load = useCallback(async () => {
    if (!server.root) return;
    setLoading(true); setError('');
    try {
      setItems((await api.workspaces(server.root)).workspaces);
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
        right={<Button small kind="plain" label="Đổi thư mục" onPress={() => setPicking(true)} />} />
      <FlatList
        data={sorted}
        keyExtractor={(w) => w.path}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={t.accent} />}
        ListHeaderComponent={(
          <View style={{ marginBottom: 12 }}>
            <Notice text={error} />
            <Segmented label="Sắp xếp" value={sort} onChange={onSetSort}
              options={[{ value: 'activity', label: 'Hoạt động' }, { value: 'modified', label: 'Ngày sửa' }, { value: 'name', label: 'Tên' }]} />
          </View>
        )}
        ListEmptyComponent={!loading && !error ? <Empty text="Thư mục này không có thư mục con." /> : undefined}
        renderItem={({ item: w, index }) => (
          <View>
            {index === firstEmpty ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 14 }}
                accessibilityRole="header" accessibilityLabel="Các thư mục chưa có session">
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
                <Text style={{ color: t.sub, fontSize: 12, fontWeight: '600' }}>Chưa có session</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
              </View>
            ) : null}
          <Card onPress={() => onOpen(w)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '600', flexShrink: 1 }}>
                {w.name}{w.isRoot ? ' (thư mục gốc)' : ''}
              </Text>
              {w.isRepo ? <Badge text="git" color={t.sub} /> : null}
              {w.active > 0 ? <Badge text="đang chạy" color={t.ok} /> : null}
            </View>
            <Text style={{ color: t.sub, marginTop: 3, fontSize: 13 }}>
              {w.sessions > 0 ? `${w.sessions} session · ${timeAgo(w.updatedAt)}` : 'Chưa có session'}
              {sort === 'modified' && w.modifiedAt ? ` · sửa ${timeAgo(w.modifiedAt)}` : ''}
            </Text>
          </Card>
          </View>
        )}
      />
    </View>
  );
}
