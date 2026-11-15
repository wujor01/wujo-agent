import { AsyncLocalStorage } from 'node:async_hooks';

// Ngôn ngữ của request đang xử lý. Thông báo lỗi được tạo sâu trong manager/git, nơi không có `req`,
// nên ngôn ngữ đi theo ngữ cảnh bất đồng bộ thay vì truyền tham số qua từng hàm.
const store = new AsyncLocalStorage();

/** 'vi' | 'en' nếu `value` là một trong hai, còn lại undefined. */
export function normLang(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'vi' || v === 'en' ? v : undefined;
}

// Ngôn ngữ mặc định của server: dùng cho CLI, cho những gì `wa serve` in ra, và cho request không nói rõ
// ngôn ngữ. Thứ tự: biến môi trường WA_LANG, rồi `lang` trong config.json (đặt lúc cài hoặc bằng `wa lang`),
// rồi tiếng Anh.
let fallback = normLang(process.env.WA_LANG) || 'en';

/** Đặt ngôn ngữ mặc định. Biến môi trường WA_LANG, nếu có, vẫn thắng. */
export function setDefaultLang(lang) {
  fallback = normLang(process.env.WA_LANG) || normLang(lang) || 'en';
}

export function defaultLang() {
  return fallback;
}

/** Chạy `fn` với ngôn ngữ `lang` ('vi' | 'en'). */
export function withLang(lang, fn) {
  return store.run(normLang(lang) || fallback, fn);
}

/** Chọn câu theo ngôn ngữ của request; ngoài request (CLI, lúc khởi động) là ngôn ngữ mặc định của server. */
export function t(vi, en) {
  return (store.getStore() || fallback) === 'en' ? en : vi;
}

/** Ngôn ngữ từ header Accept-Language: theo ngôn ngữ đầu tiên nếu là vi/en, còn lại là mặc định của server. */
export function langOf(header) {
  const first = String(header || '').split(',')[0].trim().toLowerCase();
  if (first.startsWith('en')) return 'en';
  if (first.startsWith('vi')) return 'vi';
  return fallback;
}
