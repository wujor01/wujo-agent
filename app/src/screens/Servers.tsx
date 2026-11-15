import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, Text, View } from 'react-native';
import { Server, ServerLink, connectLink, parseAddress } from '../api';
import { Button, Card, Empty, Field, Header, KeyboardShift, Notice, useTheme } from '../ui';
import { Scanner } from '../Scanner';

export function confirm(title: string, message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if ((globalThis as any).confirm(`${title}\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [{ text: 'Huỷ', style: 'cancel' }, { text: 'Đồng ý', style: 'destructive', onPress: onYes }]);
}

export function Servers({ servers, onChange, onOpen, incoming, onIncomingDone }: {
  servers: Server[]; onChange: (list: Server[]) => void; onOpen: (s: Server) => void;
  /** Link thêm máy chủ tới từ bên ngoài app (camera của điện thoại, deep link). */
  incoming?: ServerLink | null; onIncomingDone?: () => void;
}) {
  const t = useTheme();
  const [adding, setAdding] = useState(servers.length === 0);
  const [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('7433');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const serversRef = useRef(servers);
  serversRef.current = servers;

  /** Nối thử rồi lưu. Máy chủ đã có (cùng địa chỉ và cổng) thì cập nhật token, giữ thư mục gốc đã chọn. */
  async function addLink(link: ServerLink): Promise<boolean> {
    setError('');
    try {
      const found = await connectLink(link);
      const list = serversRef.current;
      const old = list.find((s) => s.host === found.host && s.port === found.port);
      const server: Server = old ? { ...old, name: found.name, token: found.token } : found;
      onChange([...list.filter((s) => s !== old), server]);
      setAdding(false); setAddress(''); setToken('');
      onOpen(server);
      return true;
    } catch (e: any) {
      setError(e?.message || 'Không kết nối được.');
      return false;
    }
  }

  async function addManual() {
    setError('');
    const addr = parseAddress(address, Number(port) || 7433);
    if (!addr) return setError('Địa chỉ chưa đúng. Ví dụ: 100.64.0.10 hoặc 192.168.1.10');
    if (!token.trim()) return setError('Nhập token (chạy "wujoagent token" trên máy tính để xem), hoặc quét mã QR.');
    setBusy(true);
    await addLink({ hosts: [addr.host], port: addr.port, token: token.trim() });
    setBusy(false);
  }

  async function addScanned(link: ServerLink) {
    setLinking(true);
    const ok = await addLink(link);
    setLinking(false);
    // Không nối được: điền sẵn vào form để người dùng sửa địa chỉ rồi thử lại.
    if (!ok) { setAdding(true); setAddress(link.hosts[0]); setPort(String(link.port)); setToken(link.token); }
  }

  // Link tới từ ngoài app: xử lý một lần rồi báo lại để App xoá nó đi.
  useEffect(() => {
    if (!incoming) return;
    addScanned(incoming).finally(() => onIncomingDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  return (
    <KeyboardShift>
      <Header title="Máy chủ" right={!adding ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button small kind="plain" label="Quét QR" onPress={() => setScanning(true)} />
          <Button small kind="plain" label="Thêm" onPress={() => setAdding(true)} />
        </View>
      ) : undefined} />
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {linking ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={t.accent} />
              <Text style={{ color: t.text, fontSize: 15 }}>Đang kết nối tới máy chủ trong mã QR…</Text>
            </View>
          </Card>
        ) : null}
        {!adding ? <Notice text={error} /> : null}
        {adding ? (
          <Card>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>Thêm máy chủ</Text>
            <Button label="Quét mã QR" onPress={() => setScanning(true)} />
            <Text style={{ color: t.sub, fontSize: 13, marginTop: 8, marginBottom: 14 }}>
              Mã QR hiện trong terminal khi chạy "wujoagent serve" hoặc "wujoagent qr" trên máy tính. Hoặc nhập tay bên dưới.
            </Text>
            <Field label="Địa chỉ IP (mạng nội bộ hoặc Tailscale)" value={address} onChangeText={setAddress}
              placeholder="100.64.0.10" keyboardType="url" />
            <Field label="Cổng" value={port} onChangeText={setPort} keyboardType="number-pad" />
            <Field label="Token" value={token} onChangeText={setToken} placeholder="12 ký tự" secureTextEntry />
            <Notice text={error} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button kind="plain" label="Kết nối" onPress={addManual} busy={busy} /></View>
              {servers.length > 0 ? <Button kind="plain" label="Huỷ" onPress={() => { setAdding(false); setError(''); }} /> : null}
            </View>
          </Card>
        ) : null}
        {servers.map((sv) => (
          <Card key={sv.id} onPress={() => onOpen(sv)}
            onLongPress={() => confirm('Xoá máy chủ?', `${sv.name} (${sv.host})`, () => onChange(servers.filter((x) => x.id !== sv.id)))}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{sv.name}</Text>
            <Text style={{ color: t.sub, marginTop: 2 }}>{sv.host}:{sv.port}</Text>
          </Card>
        ))}
        {!adding && servers.length === 0 ? <Empty text="Chưa có máy chủ nào. Bấm Quét QR hoặc Thêm." /> : null}
        {servers.length > 0 ? (
          <Text style={{ color: t.sub, fontSize: 12, textAlign: 'center', marginTop: 8 }}>Giữ lâu vào một máy chủ để xoá.</Text>
        ) : null}
      </ScrollView>
      {scanning ? (
        <Scanner onClose={() => setScanning(false)} onScan={(link) => { setScanning(false); addScanned(link); }} />
      ) : null}
    </KeyboardShift>
  );
}
