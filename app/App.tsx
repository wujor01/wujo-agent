import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, View } from 'react-native';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Api, Server, ServerLink, Session, Workspace, parseServerLink } from './src/api';
import { loadServers, saveServers, useTheme } from './src/ui';
import { Servers } from './src/screens/Servers';
import { Workspaces } from './src/screens/Workspaces';
import { Sessions } from './src/screens/Sessions';
import { Chat } from './src/screens/Chat';

export default function App() {
  const t = useTheme();
  const [servers, setServers] = useState<Server[] | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => { loadServers().then(setServers); }, []);

  // Link thêm máy chủ tới từ ngoài app: camera của điện thoại mở link trong mã QR (bản web),
  // hoặc deep link wujoagent://add#... mở bản app đã cài.
  const url = Linking.useLinkingURL();
  const handled = useRef<string | null>(null);
  const [incoming, setIncoming] = useState<ServerLink | null>(null);
  useEffect(() => {
    if (!url || handled.current === url) return;
    handled.current = url;
    const link = parseServerLink(url);
    if (!link) return;
    // Xoá token khỏi thanh địa chỉ và lịch sử của trình duyệt ngay khi đã đọc xong.
    if (Platform.OS === 'web') { try { (globalThis as any).history.replaceState(null, '', '/'); } catch { /* bỏ qua */ } }
    setSession(null); setWorkspace(null); setServerId(null);
    setIncoming(link);
  }, [url]);

  const server = servers?.find((s) => s.id === serverId) || null;
  const api = useMemo(
    () => (server ? new Api(server) : null),
    // chỉ tạo lại khi thông tin kết nối đổi, không phải khi đổi thư mục gốc
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server?.host, server?.port, server?.token],
  );

  function update(list: Server[]) {
    setServers(list);
    saveServers(list).catch(() => {});
  }

  function back(): boolean {
    if (session) { setSession(null); return true; }
    if (workspace) { setWorkspace(null); return true; }
    if (serverId) { setServerId(null); return true; }
    return false;
  }

  // Nút Back của Android đi lùi một màn thay vì thoát app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  });

  let screen: React.ReactNode;
  if (!servers) {
    screen = <ActivityIndicator style={{ marginTop: 80 }} color={t.accent} />;
  } else if (!server || !api) {
    screen = (
      <Servers servers={servers} onChange={update} onOpen={(s) => setServerId(s.id)}
        incoming={incoming} onIncomingDone={() => setIncoming(null)} />
    );
  } else if (session) {
    screen = <Chat key={session.id} api={api} session={session} onBack={() => setSession(null)} />;
  } else if (workspace) {
    screen = <Sessions key={workspace.path} api={api} workspace={workspace} onBack={() => setWorkspace(null)} onOpen={setSession} />;
  } else {
    screen = (
      <Workspaces
        key={server.id}
        server={server}
        api={api}
        onBack={() => setServerId(null)}
        onOpen={setWorkspace}
        onSetRoot={(root) => update(servers.map((s) => (s.id === server.id ? { ...s, root } : s)))}
        onSetSort={(sort) => update(servers.map((s) => (s.id === server.id ? { ...s, sort } : s)))}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>{screen}</View>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
