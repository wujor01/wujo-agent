import { getLocales } from 'expo-localization';

export type Lang = 'vi' | 'en';

function detect(): Lang {
  try {
    return getLocales()[0]?.languageCode === 'vi' ? 'vi' : 'en';
  } catch {
    return 'en';
  }
}

/** Ngôn ngữ của app, chốt một lần lúc nạp module theo ngôn ngữ đầu tiên của thiết bị. */
export const lang: Lang = detect();

/** Locale dùng cho định dạng số và ngày. */
export const locale = lang === 'vi' ? 'vi-VN' : 'en-US';

export function tr(vi: string, en: string): string {
  return lang === 'vi' ? vi : en;
}
