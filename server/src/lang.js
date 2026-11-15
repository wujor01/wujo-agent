import { AsyncLocalStorage } from 'node:async_hooks';

// Ngôn ngữ của request đang xử lý. Thông báo lỗi được tạo sâu trong manager/git, nơi không có `req`,
// nên ngôn ngữ đi theo ngữ cảnh bất đồng bộ thay vì truyền tham số qua từng hàm.
const store = new AsyncLocalStorage();

/** Chạy `fn` với ngôn ngữ `lang` ('vi' | 'en'). */
export function withLang(lang, fn) {
  return store.run(lang === 'en' ? 'en' : 'vi', fn);
}

/** Chọn câu theo ngôn ngữ của request; ngoài request (CLI, lúc khởi động) là tiếng Việt. */
export function t(vi, en) {
  return store.getStore() === 'en' ? en : vi;
}

/** Ngôn ngữ từ header Accept-Language: 'en' nếu ngôn ngữ đầu tiên là tiếng Anh, còn lại 'vi'. */
export function langOf(header) {
  const first = String(header || '').split(',')[0].trim().toLowerCase();
  return first.startsWith('en') ? 'en' : 'vi';
}
