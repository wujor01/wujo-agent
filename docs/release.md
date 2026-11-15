# Phát hành WujoAgent

EAS dưới tài khoản Expo `wujor01`, mã định danh `dev.wujo.wujoagent`, landing là HTML tĩnh trên Cloudflare Workers ở `agent.wujo.dev`.

## Trạng thái

| Hạng mục | Trạng thái |
|---|---|
| Tên, icon, màn chờ, bundle ID, scheme `wujoagent://` | Xong (`app/app.json`), `npx expo-doctor` 20/20 |
| `app/eas.json`: profile `beta` (APK) và `production` | Xong |
| Landing vi/en, chính sách quyền riêng tư, 404 | Xong (`landing/`), đã chạy thử tại chỗ bằng `wrangler dev` |
| Worker, cấu hình Cloudflare, chép APK sang R2 | Xong (`deploy/cloudflare/`) |
| CI/CD trên GitHub Actions | Xong (`.github/workflows/`); cần thêm secret, xem mục 4b |
| Dự án EAS `@wujor01/wujoagent` | Xong (`extra.eas.projectId` trong `app/app.json`) |
| Build APK | Xong bản 1.0.0 (versionCode 1), đã chép sang R2 |
| Build iOS | Xong bản 1.0.0, đã lên App Store Connect (app ID `6835067140`) |
| Link TestFlight công khai | **Chưa có**: cần tạo nhóm thử nghiệm bên ngoài và qua Beta App Review |
| Gửi duyệt App Store | **Chưa làm**: thiếu ảnh chụp màn hình và thông tin cho người duyệt |
| Deploy landing lên `agent.wujo.dev` | Xong; nút tải Android đã có APK, nút iPhone còn báo chưa phát hành |
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

Hoặc chạy workflow **Build app (EAS)** trong tab Actions. Xong, EAS cho một link `https://expo.dev/artifacts/eas/....apk`. Dán link đó vào `ANDROID_APK_URL` trong `deploy/cloudflare/wrangler.landing.jsonc` rồi đẩy lên `main` **trong vòng 14 ngày** (EAS xoá file sau đó). Khi deploy, `sync-apk.mjs` chép file sang bucket R2 `wujoagent-downloads`, và `https://agent.wujo.dev/download/android` phục vụ từ đó về sau.

Khoá ký Android do EAS tạo và giữ. Đừng tạo lại khoá: bản cập nhật ký bằng khoá khác sẽ không cài đè được.

## 3. iOS: TestFlight và App Store

```bash
cd app
npx eas-cli build -p ios --profile production
```

```bash
npx eas-cli submit -p ios --profile production --latest
```

`ascAppId` của app (`6835067140`) đã nằm trong `app/eas.json`, nên các lần sau gửi được không cần nhập lại.

Bản build lên TestFlight trước. Để mọi người cài được qua nút "Tải cho iPhone" trên trang chủ:

1. App Store Connect → WujoAgent → TestFlight → điền Test Information (mô tả bản thử, email liên hệ, và cách người duyệt thử app).
2. Tạo nhóm **External Testing**, thêm bản build vào nhóm. Apple duyệt bản thử nghiệm (Beta App Review), thường mất khoảng một ngày.
3. Trong nhóm đó bật **Public Link** và chép link `https://testflight.apple.com/join/...`.
4. Dán link vào `IOS_URL` trong `deploy/cloudflare/wrangler.landing.jsonc` rồi đẩy lên `main`.

Khi app đã lên App Store thì đổi `IOS_URL` thành `https://apps.apple.com/app/id6835067140`.

### Điều cần chuẩn bị cho khâu duyệt của Apple

- **App cần một máy tính chạy server thì mới dùng được.** Người duyệt không có máy đó. Trong phần App Review Information, hoặc cung cấp một máy chủ thử (địa chỉ công khai, token riêng, thư mục mẫu), hoặc gửi video quay toàn bộ luồng dùng. Thiếu phần này app rất dễ bị từ chối theo mục 2.1 (không kiểm tra được chức năng).
- **HTTP thường.** App bật `NSAllowsArbitraryLoads` vì server trong mạng nội bộ không có HTTPS. Apple có thể hỏi lý do; câu trả lời: app chỉ kết nối tới máy tính của chính người dùng trong LAN hoặc qua Tailscale, theo địa chỉ IP họ tự nhập.
- **Tên và nhãn hiệu.** Tên app là WujoAgent. Phần mô tả chỉ nhắc "Claude Code" để nói app làm việc với gì, và ghi rõ không liên kết với Anthropic. Đừng dùng logo hay tên Claude trong icon, tên app, ảnh chụp tiêu đề.
- **Mã hoá.** `ITSAppUsesNonExemptEncryption` đã đặt `false`.

## 4. Deploy landing

Tự động: mỗi lần `main` thay đổi ở `landing/`, `deploy/cloudflare/` hoặc hai file changelog, workflow **Deploy landing** chạy và đưa trang lên `agent.wujo.dev`. Cũng bấm chạy tay được trong tab Actions.

Từ máy mình (đã `npx wrangler login`):

```bash
cd deploy/cloudflare
npm ci
npm run deploy
```

`npm run deploy` làm bốn việc: dựng trang nhật ký thay đổi từ `CHANGELOG.md` và `CHANGELOG.en.md`, tạo bucket R2 nếu chưa có, chép APK (nếu đã điền link), rồi `wrangler deploy`. Wrangler tự tạo bản ghi DNS và chứng chỉ cho `agent.wujo.dev`.

Thử tại chỗ trước khi deploy:

```bash
npm run dev
```

## 4a. Phát hành server

Trang chủ hướng dẫn cài server bằng file đính kèm bản phát hành mới nhất trên GitHub:

```
npm install -g https://github.com/wujor01/wujo-agent/releases/latest/download/wujoagent.tgz
```

**Link này chỉ tải được khi repo ở chế độ công khai và đã có ít nhất một bản phát hành.**

Ra bản mới:

1. Thêm mục `## [X.Y.Z] - ngày` vào `CHANGELOG.md` và `CHANGELOG.en.md`.
2. Đổi `version` trong `server/package.json`.
3. Đẩy tag:

```bash
git tag vX.Y.Z
```

```bash
git push origin vX.Y.Z
```

Workflow **Release** chạy test, build bản web, đóng gói `wujoagent.tgz`, cài thử, rồi tạo GitHub Release với ghi chú lấy từ changelog. Tag không khớp `server/package.json`, hoặc changelog thiếu mục cho phiên bản đó, thì workflow dừng.

## 4b. CI/CD trên GitHub Actions

| Workflow | Khi nào chạy | Làm gì | Secret |
|---|---|---|---|
| `ci.yml` | mỗi lần đẩy lên `main`, mỗi pull request | test server trên Linux và Windows, typecheck app, `expo-doctor`, build bản web, đóng gói thử, dựng thử landing | không |
| `deploy-landing.yml` | `main` đổi ở landing, deploy, changelog; hoặc chạy tay | deploy `agent.wujo.dev`, rồi kiểm tra ba trang trả 200 | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `release.yml` | đẩy tag `vX.Y.Z` | tạo GitHub Release kèm `wujoagent.tgz` | không |
| `build-app.yml` | chạy tay | build APK hoặc iOS trên EAS, tuỳ chọn gửi App Store | `EXPO_TOKEN` |

Thêm secret tại Settings → Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN`: tạo ở dash.cloudflare.com → My Profile → API Tokens, mẫu "Edit Cloudflare Workers", thêm quyền Workers R2 Storage: Edit; giới hạn vào tài khoản và zone `wujo.dev`.
- `CLOUDFLARE_ACCOUNT_ID`: ở trang tổng quan Workers trong Cloudflare.
- `EXPO_TOKEN`: expo.dev → Account settings → Access tokens.

Chưa có secret thì `ci.yml` và `release.yml` vẫn chạy được; hai workflow còn lại sẽ báo lỗi xác thực.

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
