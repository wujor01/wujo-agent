import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, Text, View } from 'react-native';
import { Server, ServerLink, connectLink, parseAddress } from '../api';
import { Button, Card, Empty, Field, Header, KeyboardShift, Notice, useTheme } from '../ui';
import { Scanner } from '../Scanner';
import { tr } from '../i18n';

export function confirm(title: string, message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if ((globalThis as any).confirm(`${title}\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [{ text: tr('Huỷ', 'Cancel'), style: 'cancel' }, { text: tr('Đồng ý', 'OK'), style: 'destructive', onPress: onYes }]);
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

  // Sửa một máy chủ đã lưu: tên, địa chỉ, cổng, token.
  const [editing, setEditing] = useState<Server | null>(null);
  const [eName, setEName] = useState('');
  const [eAddress, setEAddress] = useState('');
  const [ePort, setEPort] = useState('');
  const [eToken, setEToken] = useState('');
  const [eError, setEError] = useState('');
  const [eBusy, setEBusy] = useState(false);
  const [eUnreachable, setEUnreachable] = useState(false); // đã thử mà không nối được: cho phép "vẫn lưu"

  function startEdit(sv: Server) {
    setAdding(false); setError('');
    setEditing(sv); setEName(sv.name); setEAddress(sv.host); setEPort(String(sv.port)); setEToken('');
    setEError(''); setEUnreachable(false);
  }

  /** Thông tin đã sửa, hoặc null (kèm thông báo lỗi) nếu nhập chưa đúng. Ô token để trống nghĩa là giữ token cũ. */
  function edited(): Server | null {
    if (!editing) return null;
    const addr = parseAddress(eAddress, Number(ePort) || editing.port);
    if (!addr) { setEError(tr('Địa chỉ chưa đúng. Ví dụ: 100.64.0.10 hoặc 192.168.1.10', 'Invalid address. Example: 100.64.0.10 or 192.168.1.10')); return null; }
    const clash = serversRef.current.find((s) => s.id !== editing.id && s.host === addr.host && s.port === addr.port);
    if (clash) { setEError(tr(`Đã có máy chủ "${clash.name}" ở địa chỉ này.`, `The server "${clash.name}" already uses this address.`)); return null; }
    return { ...editing, name: eName.trim() || addr.host, host: addr.host, port: addr.port, token: eToken.trim() || editing.token };
  }

  function store(next: Server) {
    onChange(serversRef.current.map((s) => (s.id === next.id ? next : s)));
    setEditing(null);
  }

  /** Lưu sau khi nối thử bằng thông tin mới. Không nối được thì báo lỗi và cho chọn "Vẫn lưu". */
  async function saveEdit() {
    setEError(''); setEUnreachable(false);
    const next = edited();
    if (!next) return;
    setEBusy(true);
    try {
      await connectLink({ hosts: [next.host], port: next.port, token: next.token });
      store(next);
    } catch (e: any) {
      setEError(e?.message || tr('Không kết nối được.', 'Could not connect.'));
      setEUnreachable(true);
    } finally {
      setEBusy(false);
    }
  }

  function saveAnyway() {
    const next = edited();
    if (next) store(next);
  }

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
      setError(e?.message || tr('Không kết nối được.', 'Could not connect.'));
      return false;
    }
  }

  async function addManual() {
    setError('');
    const addr = parseAddress(address, Number(port) || 7433);
    if (!addr) return setError(tr('Địa chỉ chưa đúng. Ví dụ: 100.64.0.10 hoặc 192.168.1.10', 'Invalid address. Example: 100.64.0.10 or 192.168.1.10'));
    if (!token.trim()) return setError(tr('Nhập token (chạy "wujoagent token" trên máy tính để xem), hoặc quét mã QR.', 'Enter the token (run "wujoagent token" on the computer to see it), or scan the QR code.'));
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
      <Header title={tr('Máy chủ', 'Servers')} right={!adding ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button small kind="plain" label={tr('Quét QR', 'Scan QR')} onPress={() => setScanning(true)} />
          <Button small kind="plain" label={tr('Thêm', 'Add')} onPress={() => setAdding(true)} />
        </View>
      ) : undefined} />
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {linking ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={t.accent} />
              <Text style={{ color: t.text, fontSize: 15 }}>{tr('Đang kết nối tới máy chủ trong mã QR…', 'Connecting to the server from the QR code…')}</Text>
            </View>
          </Card>
        ) : null}
        {!adding ? <Notice text={error} /> : null}
        {adding ? (
          <Card>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>{tr('Thêm máy chủ', 'Add server')}</Text>
            <Button label={tr('Quét mã QR', 'Scan QR code')} onPress={() => setScanning(true)} />
            <Text style={{ color: t.sub, fontSize: 13, marginTop: 8, marginBottom: 14 }}>
              {tr('Mã QR hiện trong terminal khi chạy "wujoagent serve" hoặc "wujoagent qr" trên máy tính. Hoặc nhập tay bên dưới.',
                'The QR code appears in the terminal when you run "wujoagent serve" or "wujoagent qr" on the computer. Or enter the details below.')}
            </Text>
            <Field label={tr('Địa chỉ IP (mạng nội bộ hoặc Tailscale)', 'IP address (local network or Tailscale)')} value={address} onChangeText={setAddress}
              placeholder="100.64.0.10" keyboardType="url" />
            <Field label={tr('Cổng', 'Port')} value={port} onChangeText={setPort} keyboardType="number-pad" />
            <Field label="Token" value={token} onChangeText={setToken} placeholder={tr('12 ký tự', '12 characters')} secureTextEntry />
            <Notice text={error} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button kind="plain" label={tr('Kết nối', 'Connect')} onPress={addManual} busy={busy} /></View>
              {servers.length > 0 ? <Button kind="plain" label={tr('Huỷ', 'Cancel')} onPress={() => { setAdding(false); setError(''); }} /> : null}
            </View>
          </Card>
        ) : null}
        {servers.map((sv) => (editing?.id === sv.id ? (
          <Card key={sv.id}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>{tr('Sửa máy chủ', 'Edit server')}</Text>
            <Field label={tr('Tên hiển thị', 'Display name')} value={eName} onChangeText={setEName} placeholder={sv.host} />
            <Field label={tr('Địa chỉ IP (mạng nội bộ hoặc Tailscale)', 'IP address (local network or Tailscale)')} value={eAddress} onChangeText={setEAddress}
              placeholder="100.64.0.10" keyboardType="url" autoCapitalize="none" autoCorrect={false} />
            <Field label={tr('Cổng', 'Port')} value={ePort} onChangeText={setEPort} keyboardType="number-pad" />
            <Field label="Token" value={eToken} onChangeText={setEToken} secureTextEntry autoCapitalize="none" autoCorrect={false}
              placeholder={tr('Để trống để giữ token hiện tại', 'Leave empty to keep the current token')} />
            <Notice text={eError} />
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <View style={{ flex: 1 }}><Button kind="plain" label={tr('Lưu', 'Save')} onPress={saveEdit} busy={eBusy} /></View>
              {eUnreachable ? <Button kind="plain" label={tr('Vẫn lưu', 'Save anyway')} onPress={saveAnyway} /> : null}
              <Button kind="plain" label={tr('Huỷ', 'Cancel')} onPress={() => setEditing(null)} />
            </View>
            <View style={{ alignSelf: 'flex-start', marginTop: 10 }}>
              <Button small kind="danger" label={tr('Xoá máy chủ này', 'Remove this server')}
                onPress={() => confirm(tr('Xoá máy chủ?', 'Remove server?'), `${sv.name} (${sv.host})`, () => { setEditing(null); onChange(servers.filter((x) => x.id !== sv.id)); })} />
            </View>
          </Card>
        ) : (
          <Card key={sv.id} onPress={() => onOpen(sv)}
            onLongPress={() => confirm(tr('Xoá máy chủ?', 'Remove server?'), `${sv.name} (${sv.host})`, () => onChange(servers.filter((x) => x.id !== sv.id)))}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{sv.name}</Text>
                <Text style={{ color: t.sub, marginTop: 2 }}>{sv.host}:{sv.port}</Text>
              </View>
              <Button small kind="plain" label={tr('Sửa', 'Edit')} onPress={() => startEdit(sv)} />
            </View>
          </Card>
        )))}
        {!adding && servers.length === 0 ? <Empty text={tr('Chưa có máy chủ nào. Bấm Quét QR hoặc Thêm.', 'No servers yet. Tap Scan QR or Add.')} /> : null}
        {servers.length > 0 ? (
          <Text style={{ color: t.sub, fontSize: 12, textAlign: 'center', marginTop: 8 }}>{tr('Bấm Sửa để đổi tên, địa chỉ, cổng hoặc token. Giữ lâu để xoá.', 'Tap Edit to change the name, address, port or token. Long-press to remove.')}</Text>
        ) : null}
      </ScrollView>
      {scanning ? (
        <Scanner onClose={() => setScanning(false)} onScan={(link) => { setScanning(false); addScanned(link); }} />
      ) : null}
    </KeyboardShift>
  );
}
