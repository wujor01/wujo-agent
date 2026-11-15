# Nhật ký thay đổi

Mọi thay đổi đáng kể của WujoAgent được ghi ở đây. Bản tiếng Anh: `CHANGELOG.en.md`. Hai file phải đi cùng nhau; trang agent.wujo.dev/changelog được dựng từ chúng.

## [1.0.6] - 2026-11-15

### Thay đổi

- Tin gửi trong lúc Claude đang làm việc không còn phải chờ hết lượt: tin được đưa thẳng vào lượt đang chạy và Claude đọc nó ở bước kế tiếp (ngay sau khi tool đang chạy xong), nên đổi ý giữa chừng có hiệu lực liền. Tin nằm ở dòng chờ cho tới khi Claude thật sự nhận, rồi mới thành một dòng trong lịch sử. Nếu lượt bị dừng trước khi tin tới nơi, tin đó được gửi thành lượt kế tiếp.

### Thêm

- Đổi token: nút **Đổi token** trong ⚙ → Máy chủ, hoặc lệnh `wa token --reset`. Token cũ hết hiệu lực ngay, không phải khởi động lại server; máy vừa bấm nút được cập nhật token mới tự động, các thiết bị khác phải quét lại mã QR và thôi nhận thông báo đẩy.

## [1.0.5] - 2026-11-15

### Thêm

- Server báo khi có bản mới: `wa serve` in một dòng nhắc, `wa version` cho biết bản đang cài và bản mới nhất.
- Lệnh `wa update` cài bản mới nhất. Server không tự cập nhật và không tự khởi động lại; cập nhật xong bạn chạy lại `wa serve`.
- App hiện phiên bản server trong ⚙ và cảnh báo khi server trên máy tính cũ hơn mức app cần.
- Tắt việc hỏi bản mới bằng biến môi trường `WA_NO_UPDATE_CHECK=1`.

## [1.0.4] - 2026-11-15

### Thêm

- Xem được Claude đang nghĩ gì: bản tóm tắt suy nghĩ chạy ra dần trong lúc Claude làm việc, và nằm lại trong lịch sử dưới dạng dòng "Suy nghĩ" bấm để mở.

## [1.0.3] - 2026-11-15

### Thay đổi

- Gửi được tin nhắn trong lúc Claude đang làm việc: tin được xếp hàng và gửi thành lượt kế tiếp khi lượt hiện tại xong. Bấm Dừng thì tin đang chờ được gửi ngay. Hàng chờ huỷ được.
- Màn chat cho biết Claude đang làm gì (đang suy nghĩ, đang viết, đang chạy tool nào) và lượt đó đã chạy bao lâu.
- Mở bàn phím không còn làm phần cuối cuộc trò chuyện bị hụt lên; đang kéo lên đọc tin cũ thì danh sách không tự giật về cuối.

## [1.0.2] - 2026-11-15

### Thay đổi

- Đang mở một session trên điện thoại mà chat tiếp trên máy tính (VS Code, terminal): điện thoại tự hiện nội dung mới sau vài giây, không phải ra vào lại. Chỉ thấy các tin đã hoàn tất, không thấy chữ đang gõ dở.
- Thẻ xin quyền hiện thành popup giữa màn hình thay vì nằm trong dòng chat; thu lại được để đọc cuộc trò chuyện trước khi quyết định.

### Sửa lỗi

- App đơ khi mở một file trong danh sách "file session đã sửa" trên iPhone.
- Danh sách gợi ý lệnh khi gõ `/` bị dòng "Chế độ" che mất.
- Bản Android không build được sau khi thêm lời xin quyền tiếng Việt cho iOS.

## [1.0.1] - 2026-11-15

### Thay đổi

- Mã QR giờ trỏ về `agent.wujo.dev/add`: quét bằng camera của iPhone sẽ mở thẳng app đã cài. Chưa cài app thì trang đó cho chọn mở app hoặc dùng bản web trên chính máy tính.
- Token và địa chỉ máy tính vẫn nằm sau dấu `#` trong link, nên không được gửi lên `agent.wujo.dev`.

### Thêm

- App tự chọn tiếng Việt hoặc tiếng Anh theo ngôn ngữ của máy; thông báo lỗi từ máy tính cũng theo ngôn ngữ đó.
- Dòng `..` ở đầu danh sách thư mục để đi ra thư mục cha.
- Thông báo đẩy (tuỳ chọn, tắt theo mặc định): báo khi Claude chạy xong hoặc cần duyệt trong lúc app không mở session đó. Thông báo chỉ ghi tên thư mục dự án. Cần bản app cài từ TestFlight hoặc file APK; hiện mới chạy trên iPhone.
- Chế độ quyền **Tự động**: Claude tự duyệt các thao tác an toàn và chỉ hỏi khi không chắc.

### Sửa lỗi

- Xem diff báo "file nằm ngoài repo" khi thư mục được viết theo tên ngắn 8.3 của Windows.

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
