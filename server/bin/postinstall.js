#!/usr/bin/env node
// Chạy sau khi cài (npm postinstall). Nếu lúc cài có chọn ngôn ngữ thì ghi vào cấu hình:
//   npm install -g <gói> --wa-lang=vi        (npm chuyển tham số thành biến npm_config_wa_lang)
//   WA_LANG=vi npm install -g <gói>
// Không chọn thì không đụng gì: lần cài đầu dùng tiếng Anh, `wa update` giữ nguyên lựa chọn cũ.
// Không bao giờ làm hỏng việc cài đặt: mọi lỗi đều bị bỏ qua, đổi ngôn ngữ sau bằng `wa lang vi|en`.
try {
  const raw = String(process.env.npm_config_wa_lang || process.env.WA_LANG || '').trim().toLowerCase();
  if (raw === 'vi' || raw === 'en') {
    const { setLang } = await import('../src/config.js');
    setLang(raw);
    console.log(raw === 'vi' ? 'WujoAgent: ngôn ngữ mặc định là Tiếng Việt.' : 'WujoAgent: default language is English.');
  } else if (raw) {
    console.log(`WujoAgent: unknown language "${raw}" (use vi or en). Set it later with: wa lang vi`);
  }
} catch { /* cài đặt vẫn tiếp tục */ }
