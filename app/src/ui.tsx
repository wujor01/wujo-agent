import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TextInputProps, View,
  useColorScheme,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Server, ServerVersion } from './api';
import { tr } from './i18n';

export type Theme = {
  bg: string; card: string; border: string; text: string; sub: string; accent: string; accentText: string;
  danger: string; ok: string; warn: string; userBubble: string; code: string;
};

const light: Theme = {
  bg: '#f6f5f2', card: '#ffffff', border: '#e3e0d8', text: '#1f1e1b', sub: '#6e6b63', accent: '#b8532f',
  accentText: '#ffffff', danger: '#b3261e', ok: '#2e7d4f', warn: '#9a6700', userBubble: '#ece8df', code: '#f0ede6',
};
const dark: Theme = {
  bg: '#1b1a18', card: '#262522', border: '#3a3833', text: '#eeece6', sub: '#a29f96', accent: '#d97757',
  accentText: '#1b1a18', danger: '#f2877f', ok: '#6fcf97', warn: '#e0b050', userBubble: '#34322d', code: '#2f2d29',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' });

// ---------- lưu danh sách máy chủ ----------

const KEY = 'cs.servers.v1';

export async function loadServers(): Promise<Server[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveServers(list: Server[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

// ---------- thành phần dùng chung ----------

/**
 * Màn phủ toàn màn hình. Modal có cây giao diện gốc riêng nên không thừa hưởng lề an toàn
 * của app: phải bọc SafeAreaProvider riêng, nếu không nội dung chui xuống dưới tai thỏ
 * và thanh home.
 */
export function FullModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const t = useTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom', 'left', 'right']}>
          {children}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * Đẩy nội dung lên trên bàn phím. Theo hướng dẫn của Expo: đặt `behavior="padding"` trên cả iOS lẫn
 * Android (app edge-to-edge nên cửa sổ Android không tự co), và bù phần lề trên của vùng an toàn,
 * vì màn hình nằm trong SafeAreaView chứ không bắt đầu từ mép trên cùng. Thiếu phần bù này thì
 * ô nhập ở đáy bị bàn phím che mất đúng bằng chiều cao tai thỏ.
 */
export function KeyboardShift({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'web') return <View style={{ flex: 1 }}>{children}</View>;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top}>
      {children}
    </KeyboardAvoidingView>
  );
}

export function Header({ title, subtitle, onBack, right }: {
  title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[s.header, { borderBottomColor: t.border, backgroundColor: t.bg }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('Quay lại', 'Back')} style={s.back}>
          <Text style={{ color: t.accent, fontSize: 28, lineHeight: 30 }}>‹</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 18, fontWeight: '600' }}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={{ color: t.sub, fontSize: 12, marginTop: 1 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled, busy, small }: {
  label: string; onPress: () => void; kind?: 'primary' | 'plain' | 'danger'; disabled?: boolean; busy?: boolean; small?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : 'transparent';
  const fg = kind === 'primary' ? t.accentText : kind === 'danger' ? t.danger : t.text;
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [
        s.button,
        small && { paddingVertical: 7, paddingHorizontal: 12 },
        { backgroundColor: bg, borderColor: kind === 'primary' ? t.accent : t.border, opacity: off ? 0.5 : pressed ? 0.75 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : (
        <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 13 : 15 }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.sub, fontSize: 13, marginBottom: 4 }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.sub}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        {...props}
        style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }, props.style]}
      />
    </View>
  );
}

export function Card({ children, onPress, onLongPress }: {
  children: React.ReactNode; onPress?: () => void; onLongPress?: () => void;
}) {
  const t = useTheme();
  const style = [s.card, { backgroundColor: t.card, borderColor: t.border }];
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button"
      style={({ pressed }) => [...style, { opacity: pressed ? 0.7 : 1 }]}>
      {children}
    </Pressable>
  );
}

export function Notice({ text, kind = 'error' }: { text: string; kind?: 'error' | 'info' }) {
  const t = useTheme();
  if (!text) return null;
  return (
    <View style={[s.notice, { borderColor: kind === 'error' ? t.danger : t.border }]}>
      <Text style={{ color: kind === 'error' ? t.danger : t.sub, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[s.badge, { borderColor: color }]}>
      <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

/** Dãy nút chọn một trong vài giá trị (ví dụ kiểu sắp xếp). */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Text style={{ color: t.sub, fontSize: 13 }}>{label}</Text>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button"
            accessibilityState={{ selected: on }} accessibilityLabel={`${label} ${o.label}`}
            style={{
              borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : 'transparent',
              borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
            }}>
            <Text style={{ color: on ? t.accentText : t.text, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Nhắc khi server trên máy tính đã cũ: quá cũ so với app thì cảnh báo, chỉ là có bản mới thì nhắc nhẹ. */
export function ServerVersionNotice({ v }: { v: ServerVersion | null }) {
  const t = useTheme();
  if (!v || (!v.tooOld && !v.updatable)) return null;
  return (
    <View style={[s.notice, { borderColor: v.tooOld ? t.warn : t.border }]} accessibilityRole="alert">
      <Text style={{ color: v.tooOld ? t.warn : t.sub, fontSize: 14, fontWeight: '600' }}>
        {v.tooOld
          ? tr(`Server trên máy tính đã cũ (${v.version || 'không rõ phiên bản'}). Một số tính năng của app sẽ không chạy.`,
            `The server on your computer is out of date (${v.version || 'unknown version'}). Some app features will not work.`)
          : tr(`Server có bản mới ${v.latest} (đang chạy ${v.version}).`, `Server update ${v.latest} is available (running ${v.version}).`)}
      </Text>
      <Text style={{ color: t.sub, fontSize: 13, marginTop: 4 }}>
        {tr('Trên máy tính chạy "wa update", rồi dừng server và chạy lại "wa serve".',
          'On the computer run "wa update", then stop the server and run "wa serve" again.')}
      </Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={{ color: t.sub, textAlign: 'center', marginTop: 40, paddingHorizontal: 24, fontSize: 15 }}>{text}</Text>;
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 8, minHeight: 54,
  },
  back: { paddingRight: 6, marginLeft: -4, minWidth: 28, alignItems: 'center' },
  button: {
    borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center', minHeight: 36,
  },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  notice: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 12 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
});
