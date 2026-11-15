# WujoAgent

[English](README.md) · **Tiếng Việt**

Quản lý và chat với các session Claude Code trên máy tính từ điện thoại, qua IP mạng nội bộ hoặc Tailscale, không dùng Claude Remote Control: mở lại session, giao việc, duyệt từng lần gọi tool, xem thay đổi git theo từng file. Điện thoại nối thẳng tới một server nhỏ trên máy của bạn, không qua máy chủ trung gian nào. Trang giới thiệu và hướng dẫn cài: [agent.wujo.dev](https://agent.wujo.dev/).

WujoAgent là dự án độc lập, không liên kết với Anthropic và không được Anthropic bảo trợ. Claude và Claude Code là nhãn hiệu của Anthropic, PBC.

- `server/` — server Node chạy trên máy có Claude Code (lệnh `wujoagent`, viết tắt `wa`). Chạy từng lượt chat bằng Claude Agent SDK, hỏi quyền từng tool như trên VS Code, đọc các session có sẵn của từng workspace, xem git và fetch / pull / push.
- `app/` — app iOS/Android (Expo). Cùng mã nguồn xuất được bản web, server tự phục vụ bản web đó.
- `landing/` — trang giới thiệu và chính sách quyền riêng tư (vi/en).
- `deploy/cloudflare/` — worker và cấu hình đưa landing lên Cloudflare.
- `docs/release.md` — các bước phát hành lên App Store, bản APK, deploy landing, CI/CD, nội dung store.
- `CHANGELOG.md`, `CHANGELOG.en.md` — nhật ký thay đổi; trang agent.wujo.dev/changelog dựng từ hai file này.
- `README.md`, `README.vi.md` — tài liệu này bằng tiếng Anh và tiếng Việt; sửa một bản thì sửa luôn bản kia.
- `.github/workflows/` — kiểm tra tự động, deploy landing, phát hành server, build app.

Thư mục dữ liệu vẫn là `~/.claude-sessions` (tên cũ của dự án) để không mất session đã có.

## Cài đặt (trên máy có Claude Code)

Cần Node 20 trở lên và đã đăng nhập `claude`.

Bản phát hành mới nhất:

```bash
npm install -g https://github.com/wujor01/wujo-agent/releases/latest/download/wujoagent.tgz
```

Lệnh `wa` và server mặc định nói tiếng Anh. Muốn tiếng Việt thì thêm `--wa-lang=vi` lúc cài:

```bash
npm install -g https://github.com/wujor01/wujo-agent/releases/latest/download/wujoagent.tgz --wa-lang=vi
```

Đổi sau khi cài: `wa lang vi` hoặc `wa lang en` (server đang chạy đổi theo từ lần chạy lại `wa serve`). Biến môi trường `WA_LANG=vi|en` thắng cả hai. `wa update` giữ nguyên ngôn ngữ đã chọn. Ngôn ngữ của app trên điện thoại chọn riêng trong app.

Hoặc từ mã nguồn:

```bash
cd server
npm install --wa-lang=vi
npm link
```

Cả hai cách đều tạo lệnh `wujoagent` và tên viết tắt `wa`. Không muốn link thì thay `wa` bằng `node bin/wujoagent.js`.

## Chạy server

```bash
wa serve
```

Server in ra token và các địa chỉ để nhập vào app, ví dụ (khi đã chọn tiếng Việt):

```
WujoAgent đang chạy trên 0.0.0.0:7433
Token: abcd2345efgh
  Tailscale  http://100.64.0.10:7433
  LAN        http://192.168.1.10:7433
```

Nếu điện thoại không nối được, Windows Firewall có thể đang chặn cổng. Mở cổng cho mạng riêng bằng PowerShell quyền admin (bạn tự chạy):

```powershell
New-NetFirewallRule -DisplayName "claude-sessions" -Direction Inbound -Protocol TCP -LocalPort 7433 -Action Allow -Profile Private
```

Chỉ muốn nghe trên Tailscale: `wa serve --host 100.64.0.10`.

## Dùng trên điện thoại

Có ba cách, từ nhanh tới đầy đủ:

1. **Trình duyệt** — mở `http://<IP>:7433` trên Safari/Chrome. Trên iPhone bấm Chia sẻ → Thêm vào MH chính để có biểu tượng như app. Bản cài từ bản phát hành đã kèm sẵn bản web; chạy từ mã nguồn thì build một lần:

   ```bash
   cd app
   npm install
   npx expo export -p web --output-dir ../server/web
   ```

2. **Expo Go** — cài Expo Go trên điện thoại, rồi trên máy tính:

   ```bash
   cd app
   npx expo start
   ```

   Quét mã QR. Điện thoại và máy tính phải cùng mạng (hoặc cùng tailnet).

3. **App cài hẳn** — cần tài khoản Expo; iOS cần thêm tài khoản Apple Developer. Đổi `bundleIdentifier` và `package` trong `app/app.json` trước.

   ```bash
   cd app
   npx eas-cli build --platform android --profile preview
   ```

   ```bash
   npx eas-cli build --platform ios
   ```

**Thêm máy chủ bằng mã QR.** `wa serve` in sẵn mã QR cho từng địa chỉ (Tailscale, LAN); `wa qr` in lại bất cứ lúc nào. Trong app bấm **Quét QR**, hoặc dùng camera của điện thoại quét mã: camera mở bản web và máy chủ được thêm ngay. Mã QR chứa token, đừng để người khác chụp được.

Trong app: **Thêm máy chủ** (quét QR, hoặc nhập IP, cổng, token) → **chọn thư mục gốc** (ví dụ `E:\work\repos`) → app liệt kê các workspace con và số session của từng cái → vào workspace để mở session cũ hoặc tạo session mới.

- Session tạo từ VS Code, terminal hay desktop đều hiện ra và chat tiếp được.
- Workspace là git repo sẽ có bảng git: nhánh, số commit lệch so với upstream, file thay đổi, commit gần đây, nút Fetch / Pull / Push. Pull chỉ chạy fast-forward. Commit hay đổi nhánh thì nhờ Claude trong chat.
- Bấm vào một file trong bảng git để xem thay đổi của file đó so với commit gần nhất.
- Trong màn chat, nút **± N file** ở góc trên liệt kê các file session đó đã sửa; bấm vào để xem thay đổi.
- Nút **⚙** ở góc trên phải mở cài đặt session: model, chế độ quyền, mức sử dụng (ngữ cảnh, giới hạn 5 giờ và 7 ngày), MCP server.
- Gõ `/` trong ô nhập để xem gợi ý lệnh của workspace (kể cả skill và lệnh riêng của dự án). `/mcp`, `/usage`, `/status` mở bảng cài đặt, `/model` mở bảng chọn model.
- Chế độ quyền và model cũng đổi được ở dòng phía trên ô nhập.
- Gửi tin trong lúc Claude đang làm việc: tin vào thẳng lượt đang chạy và Claude đọc nó ở bước kế tiếp, không phải chờ hết lượt.
- Giữ lâu vào một session để gỡ khỏi app; lịch sử của Claude trên máy chủ không bị xoá.

## Dùng qua SSH

`wa` nói chuyện với server đang chạy trên chính máy đó, nên SSH vào là dùng được:

```bash
ssh may-chu wa list
```

| Lệnh | Việc |
|---|---|
| `wa serve [--port N] [--host IP]` | chạy server |
| `wa version` | in phiên bản đang cài và bản mới nhất |
| `wa update` | cài bản mới nhất; sau đó chạy lại `wa serve` |
| `wa lang [vi\|en]` | xem hoặc đổi ngôn ngữ của lệnh `wa` và của server |
| `wa token` | in token |
| `wa token --reset` | đổi token mới; token cũ hết hiệu lực ngay, mọi thiết bị phải thêm lại máy chủ |
| `wa qr [tailscale\|lan\|IP]` | in mã QR để thêm máy chủ |
| `wa list` | liệt kê session đã mở qua hệ thống |
| `wa new <thư-mục> [tiêu đề]` | tạo session |
| `wa send <id> <tin nhắn>` | gửi tin, xem trả lời, duyệt quyền bằng `y` / `a` / `n` |
| `wa show <id>` | xem lịch sử |
| `wa git <id> [fetch\|pull\|push]` | xem repo hoặc chạy thao tác git |
| `wa rm <id>` | gỡ session |

Không muốn mở cổng ra mạng thì chạy `wa serve --host 127.0.0.1` và dùng đường hầm SSH từ máy khác:

```bash
ssh -L 7433:127.0.0.1:7433 may-chu
```

## Cấu hình

Dữ liệu nằm ở `~/.claude-sessions` (`config.json`, `sessions.json`, `events/`). Biến môi trường thắng file cấu hình.

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `CS_PORT` | cổng | 7433 |
| `CS_HOST` | địa chỉ lắng nghe | 0.0.0.0 |
| `CS_TOKEN` | token | sinh ngẫu nhiên lần chạy đầu |
| `CS_DATA_DIR` | thư mục dữ liệu | `~/.claude-sessions` |
| `WA_LANG` | ngôn ngữ của lệnh `wa` và của server, `vi` hoặc `en` | `en`, hoặc lựa chọn lúc cài hay bằng `wa lang` |
| `WA_NO_UPDATE_CHECK` | đặt `1` để server không hỏi GitHub về bản mới | (có hỏi, 6 giờ một lần) |
| `CS_CLAUDE_PATH` | đường dẫn `claude` nếu SDK không tự tìm thấy | (tự tìm) |

## Bảo mật

- Mọi API cần token; sai quá 10 lần trong một phút thì IP đó bị khoá một phút.
- Kết nối là HTTP thường. Qua Tailscale thì đã được mã hoá; trên LAN thì token đi dạng rõ, chỉ nên dùng ở mạng bạn tin.
- Ai có token thì điều khiển được Claude Code trên máy này với quyền của bạn. Đừng mở cổng ra internet.
- Không có chế độ bỏ qua hỏi quyền.
- Nghi token bị lộ thì đổi ngay: `wa token --reset`, hoặc nút **Đổi token** trong ⚙ của app. Không đổi được khi token đặt bằng biến `CS_TOKEN`.

## Kiểm thử

```bash
cd server
npm test
```

Chạy thật với Claude (tốn một ít token):

```bash
node scripts/smoke.mjs
```

```bash
node scripts/smoke-inject.mjs
```

```bash
cd app
npx tsc --noEmit
```

## Giấy phép

MIT, xem [LICENSE](LICENSE).
