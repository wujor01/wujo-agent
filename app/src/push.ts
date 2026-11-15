import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Api, Server } from './api';
import { lang, tr } from './i18n';

// Thông báo đẩy khi Claude chạy xong hoặc xin quyền trong lúc app không mở session đó.
// Máy tính của người dùng gửi thông báo qua dịch vụ đẩy của Expo; nội dung chỉ là câu cố định và tên
// thư mục dự án, không có chữ nào của cuộc trò chuyện (xem server/src/push.js).

/** Bản web và Expo Go trên Android không nhận được thông báo đẩy. */
export const pushSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export type PushData = { kind?: string; sessionId?: string; tag?: string };

/** Session đang mở trên màn hình: thông báo của chính session đó không cần hiện banner. */
let openSession: { tag: string; sessionId: string } | null = null;
export function setOpenSession(value: { tag: string; sessionId: string } | null) {
  openSession = value;
}

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = (notification.request.content.data || {}) as PushData;
      const here = !!openSession && openSession.sessionId === data.sessionId && openSession.tag === data.tag;
      return { shouldShowBanner: !here, shouldShowList: !here, shouldPlaySound: !here, shouldSetBadge: false };
    },
  });
}

/** Xin quyền (nếu chưa có) và lấy mã thiết bị của Expo. Ném lỗi kèm câu giải thích cho người dùng. */
async function deviceToken(): Promise<string> {
  if (!pushSupported) throw new Error(tr('Bản web không nhận được thông báo.', 'The web version cannot receive notifications.'));
  if (Platform.OS === 'android') {
    // Android cần có kênh thông báo trước khi xin quyền và lấy mã.
    await Notifications.setNotificationChannelAsync('default', {
      name: tr('Claude xong hoặc cần duyệt', 'Claude finished or needs approval'),
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let settings = await Notifications.getPermissionsAsync();
  if (!settings.granted) settings = await Notifications.requestPermissionsAsync();
  if (!settings.granted) {
    throw new Error(tr('Bạn chưa cho phép thông báo. Bật lại trong Cài đặt của điện thoại.', 'Notifications are not allowed. Turn them on in the phone\'s Settings.'));
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e: any) {
    throw new Error(tr(
      `Không lấy được mã thông báo của thiết bị. Thông báo đẩy cần bản app cài từ TestFlight hoặc file APK, không chạy trong Expo Go. (${e?.message || e})`,
      `Could not get this device's notification token. Push needs the app from TestFlight or the APK, not Expo Go. (${e?.message || e})`,
    ));
  }
}

/** Bật thông báo cho một máy chủ. Trả về mã thiết bị để lưu lại (dùng khi tắt). */
export async function enablePush(api: Api, server: Server): Promise<string> {
  const token = await deviceToken();
  await api.pushRegister({ token, tag: server.id, lang, platform: Platform.OS });
  return token;
}

export async function disablePush(api: Api, token: string): Promise<void> {
  await api.pushUnregister(token);
}

/**
 * Đăng ký lại âm thầm mỗi khi mở một máy chủ đã bật thông báo: mã thiết bị có thể đổi sau khi cài lại app,
 * và ngôn ngữ của máy có thể đã đổi. Lỗi thì bỏ qua, người dùng không làm gì ở bước này.
 */
export async function refreshPush(api: Api, server: Server): Promise<string | null> {
  if (!pushSupported || !server.push) return null;
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (!settings.granted) return null;
    return await enablePush(api, server);
  } catch {
    return null;
  }
}

/** Gọi `cb` khi người dùng bấm vào một thông báo, kể cả thông báo đã mở app từ trạng thái tắt. */
export function onNotificationOpen(cb: (data: PushData) => void): () => void {
  if (!pushSupported) return () => {};
  const read = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data as PushData | undefined;
    if (data?.sessionId) cb(data);
  };
  Notifications.getLastNotificationResponseAsync().then(read).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(read);
  return () => sub.remove();
}
