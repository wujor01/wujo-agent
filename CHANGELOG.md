# Nhật ký thay đổi

Mọi thay đổi đáng kể của WujoAgent được ghi ở đây. Bản tiếng Anh: `CHANGELOG.en.md`. Hai file phải đi cùng nhau; trang agent.wujo.dev/changelog được dựng từ chúng.

## [1.0.0] - 2026-11-15

Bản phát hành đầu tiên.

### Server trên máy tính

- Lệnh `wujoagent serve` chạy một server nhỏ trên máy có Claude Code; điện thoại nối thẳng tới qua mạng nội bộ hoặc Tailscale.
- Mỗi lượt chat chạy bằng Claude Agent SDK, hỏi quyền từng thao tác như trên VS Code: cho phép, luôn cho phép, từ chối.
- Đọc các session Claude Code có sẵn theo từng thư mục dự án, kể cả session tạo từ VS Code hay terminal, và chat tiếp được.
- Xem git: nhánh, số commit lệch, file thay đổi kèm số dòng thêm bớt, diff từng file; fetch, pull (chỉ fast-forward), push.
- In mã QR để thêm máy chủ vào app; lệnh `wujoagent qr` in lại.
- Mọi API cần token; đoán sai quá mười lần trong một phút thì địa chỉ đó bị chặn tạm.

### App điện thoại

- Thêm máy chủ bằng cách quét mã QR hoặc nhập IP, cổng, token.
- Chọn thư mục gốc, xem các dự án kèm số session, sắp xếp theo hoạt động, ngày sửa hoặc tên.
- Màn chat hiện câu trả lời từng chữ, thẻ xin quyền, nút Dừng.
- Chọn model và chế độ quyền cho từng session.
- Gõ `/` để xem lệnh và skill của dự án.
- Bảng cài đặt: phần trăm ngữ cảnh, giới hạn 5 giờ và 7 ngày, trạng thái MCP server.
- Xem các file mà session đã sửa và diff của từng file.
- Chạy được trên iOS, Android và trình duyệt.
