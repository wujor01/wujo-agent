# Phát hành WujoAgent

EAS dưới tài khoản Expo `wujor01`, mã định danh `dev.wujo.wujoagent`, landing là HTML tĩnh trên Cloudflare Workers ở `agent.wujo.dev`.

## Trạng thái

| Hạng mục | Trạng thái |
|---|---|
| Tên, icon, màn chờ, bundle ID, scheme `wujoagent://` | Xong (`app/app.json`), `npx expo-doctor` 20/20 |
| `app/eas.json`: profile `beta` (APK) và `production` | Xong |
| Landing vi/en, chính sách quyền riêng tư, 404 | Xong (`landing/`), đã chạy thử tại chỗ bằng `wrangler dev` |
| Worker, cấu hình Cloudflare, chép APK sang R2, đóng gói server | Xong (`deploy/cloudflare/`), `wrangler deploy --dry-run` qua |
| Dự án EAS `@wujor01/wujoagent` | Xong (`extra.eas.projectId` trong `app/app.json`) |
| Build APK | Đã gửi bản đầu lên EAS (profile `beta`) |
| Build iOS, gửi App Store | **Chưa làm**: có bước đăng nhập Apple |
| Deploy landing lên `agent.wujo.dev` | Xong lần đầu ngày 15/11/2026; link tải iOS và Android còn trống |
| Ảnh chụp màn hình cho store | **Chưa có** |

## Việc chỉ bạn làm được

1. **Cloudflare**: `npx wrangler login` bằng tài khoản đang giữ zone `wujo.dev`.
2. **Apple**: tạo bản ghi app trong App Store Connect (bundle ID `dev.wujo.wujoagent`), lấy Apple ID của app (`ascAppId`). Lần build và submit iOS đầu tiên phải chạy tương tác để đăng nhập Apple ID và xác thực hai lớp.
3. **Ảnh chụp màn hình**: chụp trên máy thật hoặc simulator (kích thước ở cuối tài liệu).

## 1. Dự án EAS

Đã tạo: `@wujor01/wujoagent`. Ai fork repo này để tự phát hành thì đổi `owner`, `bundleIdentifier`, `package` trong `app/app.json`, xoá `extra.eas`, rồi chạy `npx eas-cli init` để tạo dự án của riêng mình.

## 2. Bản cài APK cho Android

```bash
cd app
npx eas-cli build -p android --profile beta
```

Xong, EAS cho một link `https://expo.dev/artifacts/eas/....apk`. Dán link đó vào `ANDROID_APK_URL` trong `deploy/cloudflare/wrangler.landing.jsonc` rồi deploy landing **trong vòng 14 ngày** (EAS xoá file sau đó). Khi deploy, `sync-apk.mjs` chép file sang bucket R2 `wujoagent-downloads`, và `https://agent.wujo.dev/download/android` phục vụ từ đó về sau.

Khoá ký Android do EAS tạo và giữ. Đừng tạo lại khoá: bản cập nhật ký bằng khoá khác sẽ không cài đè được.

## 3. iOS: TestFlight và App Store

```bash
cd app
npx eas-cli build -p ios --profile production
```

```bash
npx eas-cli submit -p ios --profile production --latest
```

Sau khi có `ascAppId`, thêm vào `app/eas.json` để các lần sau không phải nhập:

```json
"submit": { "production": { "ios": { "ascAppId": "<Apple ID của app>" } } }
```

Bản build lên TestFlight trước. Muốn có link TestFlight công khai thì tạo nhóm thử nghiệm bên ngoài và chờ Beta App Review. Có link TestFlight hoặc link App Store rồi thì dán vào `IOS_URL` trong `wrangler.landing.jsonc` và deploy lại.

### Điều cần chuẩn bị cho khâu duyệt của Apple

- **App cần một máy tính chạy server thì mới dùng được.** Người duyệt không có máy đó. Trong phần App Review Information, hoặc cung cấp một máy chủ thử (địa chỉ công khai, token riêng, thư mục mẫu), hoặc gửi video quay toàn bộ luồng dùng. Thiếu phần này app rất dễ bị từ chối theo mục 2.1 (không kiểm tra được chức năng).
- **HTTP thường.** App bật `NSAllowsArbitraryLoads` vì server trong mạng nội bộ không có HTTPS. Apple có thể hỏi lý do; câu trả lời: app chỉ kết nối tới máy tính của chính người dùng trong LAN hoặc qua Tailscale, theo địa chỉ IP họ tự nhập.
- **Tên và nhãn hiệu.** Tên app là WujoAgent. Phần mô tả chỉ nhắc "Claude Code" để nói app làm việc với gì, và ghi rõ không liên kết với Anthropic. Đừng dùng logo hay tên Claude trong icon, tên app, ảnh chụp tiêu đề.
- **Mã hoá.** `ITSAppUsesNonExemptEncryption` đã đặt `false`.

## 4. Deploy landing

```bash
cd app
npm run build:web
```

```bash
cd deploy/cloudflare
npm ci
npm run deploy
```

`npm run deploy` làm bốn việc: đóng gói server thành `landing/download/wujoagent.tgz`, tạo bucket R2 nếu chưa có, chép APK (nếu đã điền link), rồi `wrangler deploy`. Wrangler tự tạo bản ghi DNS và chứng chỉ cho `agent.wujo.dev`.

**Lưu ý:** bước này đưa mã nguồn server lên mạng dưới dạng file tải công khai, vì trang chủ hướng dẫn cài bằng `npm install -g https://agent.wujo.dev/download/wujoagent.tgz`. Nếu bạn muốn phát hành server qua npm thay vì tự lưu trữ, đổi lệnh trong `landing/index.html` và `landing/en/index.html`, rồi bỏ bước `pack` khỏi script `deploy`.

Thử tại chỗ trước khi deploy:

```bash
npm run dev
```

Deploy qua GitLab CI: đẩy repo lên GitLab, đặt biến `CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID`, rồi push lên `master` với chữ "deploy" trong commit message. Job `deploy-landing` nằm trong `.gitlab-ci.yml`.

## 5. Nội dung store

Mọi dòng dưới đây đã được đếm ký tự cho vừa giới hạn.

### App Store

| Trường | Tiếng Việt | English |
|---|---|---|
| Tên (≤30) | WujoAgent | WujoAgent |
| Phụ đề (≤30) | Điều khiển Claude Code từ xa | Remote for Claude Code |
| Văn bản quảng bá (≤170) | Chat với Claude Code trên máy tính, duyệt từng thao tác và xem thay đổi git ngay trên điện thoại. Kết nối thẳng qua mạng nội bộ hoặc Tailscale. | Chat with Claude Code on your computer, approve each action and review git changes from your phone. Connects directly over your LAN or Tailscale. |
| Từ khoá (≤100) | claude code,lập trình,remote,terminal,git,ai,agent,tailscale,code,dev | claude code,coding,remote,terminal,git,ai,agent,tailscale,developer,ssh |
| Danh mục | Developer Tools | Developer Tools |
| URL hỗ trợ | https://agent.wujo.dev | https://agent.wujo.dev/en/ |
| URL quyền riêng tư | https://agent.wujo.dev/privacy | https://agent.wujo.dev/en/privacy |

**Mô tả (vi)**

WujoAgent là điều khiển từ xa cho Claude Code đang chạy trên máy tính của bạn.

Cài WujoAgent trên máy tính, quét mã QR, rồi làm việc từ điện thoại:

• Mở lại các session Claude Code đang dở, kể cả session tạo từ VS Code hay terminal
• Nhắn việc mới và xem câu trả lời hiện ra từng chữ
• Duyệt từng thao tác: cho phép, luôn cho phép, hoặc từ chối
• Xem thay đổi git theo từng file; fetch, pull, push
• Đổi model và chế độ quyền cho từng session
• Theo dõi phần trăm ngữ cảnh và giới hạn sử dụng của tài khoản
• Gõ / để dùng lệnh và skill của dự án

Điện thoại nối thẳng tới máy tính qua mạng nội bộ hoặc Tailscale. Không có máy chủ trung gian, không cần tạo tài khoản, không thu thập dữ liệu.

Cần có: một máy tính đã cài Claude Code và Node.js 20 trở lên. Hướng dẫn tại agent.wujo.dev.

WujoAgent là sản phẩm độc lập, không liên kết với Anthropic. Claude và Claude Code là nhãn hiệu của Anthropic, PBC.

**Description (en)**

WujoAgent is a remote control for Claude Code running on your own computer.

Install WujoAgent on your computer, scan a QR code, then work from your phone:

• Reopen unfinished Claude Code sessions, including ones started in VS Code or a terminal
• Send new work and watch the answer stream in
• Approve each action: allow once, always allow, or deny
• Review git changes file by file; fetch, pull, push
• Switch model and permission mode per session
• Track context percentage and your account's usage limits
• Type / to use your project's commands and skills

Your phone connects straight to your computer over your local network or Tailscale. No relay server, no account, no data collection.

Requires a computer with Claude Code and Node.js 20 or later. Setup guide at agent.wujo.dev.

WujoAgent is an independent product and is not affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.

### Quyền riêng tư (App Privacy)

Chọn **Data Not Collected**. App không có tài khoản, không phân tích, không quảng cáo; dữ liệu chỉ đi giữa điện thoại và máy tính của người dùng. Chi tiết ở `landing/privacy.html`.

### Ảnh chụp màn hình

- iPhone 6,9 inch: 1320×2868, tối thiểu 3 ảnh. iPad 13 inch: 2064×2752 (app đang bật hỗ trợ iPad; nếu không muốn chuẩn bị ảnh iPad, đặt `ios.supportsTablet` thành `false`).
- Gợi ý năm cảnh: danh sách workspace; màn chat có thẻ xin quyền; bảng thay đổi git với một file đang mở; bảng cài đặt có mức sử dụng; màn quét QR.

## 6. Bản tiếp theo

`eas.json` dùng `appVersionSource: remote` và `autoIncrement`, nên số build tự tăng. Chỉ đổi `version` trong `app/app.json` khi ra bản mới cho người dùng (1.0.0 → 1.1.0).
