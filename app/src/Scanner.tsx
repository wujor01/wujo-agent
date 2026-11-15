import React, { useRef, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ServerLink, parseServerLink } from './api';
import { Button, FullModal, useTheme } from './ui';
import { tr } from './i18n';

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
      if (lastBad.current !== data) { lastBad.current = data; setHint(tr('Mã này không phải mã của WujoAgent. Chạy "wujoagent qr" trên máy tính để lấy mã.', 'This is not a WujoAgent code. Run "wujoagent qr" on the computer to get one.')); }
      return;
    }
    done.current = true;
    onScan(link);
  }

  let body: React.ReactNode;
  if (!permission) {
    body = <Text style={{ color: t.sub, padding: 24, textAlign: 'center' }}>{tr('Đang kiểm tra quyền dùng camera…', 'Checking camera permission…')}</Text>;
  } else if (!permission.granted) {
    body = (
      <View style={{ padding: 24, gap: 14 }}>
        <Text style={{ color: t.text, fontSize: 16, textAlign: 'center' }}>
          {tr('App cần dùng camera để quét mã QR của máy chủ.', "The app needs the camera to scan the server's QR code.")}
        </Text>
        {permission.canAskAgain ? (
          <Button label={tr('Cho phép dùng camera', 'Allow camera access')} onPress={() => { requestPermission(); }} />
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={{ color: t.sub, textAlign: 'center' }}>
              {Platform.OS === 'web'
                ? tr('Quyền camera đang bị tắt. Bật lại trong phần cài đặt của trình duyệt.', 'Camera access is off. Turn it on in the browser settings.')
                : tr('Quyền camera đang bị tắt. Bật lại trong phần cài đặt của điện thoại.', 'Camera access is off. Turn it on in the phone settings.')}
            </Text>
            {Platform.OS !== 'web' ? <Button label={tr('Mở Cài đặt', 'Open Settings')} onPress={() => { Linking.openSettings(); }} /> : null}
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
            {hint || tr('Đưa camera vào mã QR hiện trong terminal của máy chủ.', "Point the camera at the QR code shown in the server's terminal.")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <FullModal onClose={onClose}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '600', flex: 1 }}>{tr('Quét mã QR', 'Scan QR code')}</Text>
          <Button small kind="plain" label={tr('Đóng', 'Close')} onPress={onClose} />
        </View>
        {body}
    </FullModal>
  );
}
