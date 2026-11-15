import React, { useRef, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ServerLink, parseServerLink } from './api';
import { Button, FullModal, useTheme } from './ui';

/** Toàn màn hình: quét mã QR mà `wujoagent serve` hoặc `wujoagent qr` in ra để thêm máy chủ. */
export function Scanner({ onScan, onClose }: { onScan: (link: ServerLink) => void; onClose: () => void }) {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState('');
  const done = useRef(false);
  const lastBad = useRef('');

  function handle(data: string) {
    if (done.current) return;
    const link = parseServerLink(data);
    if (!link) {
      // Camera báo liên tục cùng một mã: chỉ nhắc một lần cho mỗi mã lạ.
      if (lastBad.current !== data) { lastBad.current = data; setHint('Mã này không phải mã của WujoAgent. Chạy "wujoagent qr" trên máy tính để lấy mã.'); }
      return;
    }
    done.current = true;
    onScan(link);
  }

  let body: React.ReactNode;
  if (!permission) {
    body = <Text style={{ color: t.sub, padding: 24, textAlign: 'center' }}>Đang kiểm tra quyền dùng camera…</Text>;
  } else if (!permission.granted) {
    body = (
      <View style={{ padding: 24, gap: 14 }}>
        <Text style={{ color: t.text, fontSize: 16, textAlign: 'center' }}>
          App cần dùng camera để quét mã QR của máy chủ.
        </Text>
        {permission.canAskAgain ? (
          <Button label="Cho phép dùng camera" onPress={() => { requestPermission(); }} />
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={{ color: t.sub, textAlign: 'center' }}>
              Quyền camera đang bị tắt. Bật lại trong phần cài đặt của {Platform.OS === 'web' ? 'trình duyệt' : 'điện thoại'}.
            </Text>
            {Platform.OS !== 'web' ? <Button label="Mở Cài đặt" onPress={() => { Linking.openSettings(); }} /> : null}
          </View>
        )}
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => handle(String(result.data || ''))}
        />
        <View style={{ padding: 16 }}>
          <Text style={{ color: hint ? t.warn : t.sub, textAlign: 'center', fontSize: 14 }}>
            {hint || 'Đưa camera vào mã QR hiện trong terminal của máy chủ.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <FullModal onClose={onClose}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '600', flex: 1 }}>Quét mã QR</Text>
          <Button small kind="plain" label="Đóng" onPress={onClose} />
        </View>
        {body}
    </FullModal>
  );
}
