// `wa startup`: tự chạy WujoAgent (và, nếu chọn, VS Code web) mỗi khi người dùng đăng nhập vào máy.
//
// Chỉ dùng cơ chế tự khởi động của riêng người dùng, không cần quyền quản trị và gỡ được bằng `wa startup off`:
//   Windows — một file .vbs trong thư mục Startup, chạy ẩn các file .cmd nằm trong thư mục dữ liệu
//   macOS   — LaunchAgent trong ~/Library/LaunchAgents
//   Linux   — file .desktop trong ~/.config/autostart
// Nhật ký của các tiến trình tự chạy nằm trong thư mục dữ liệu (startup-serve.log, startup-code.log).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(here, '../bin/wujoagent.js');

/** Các lệnh sẽ tự chạy: luôn có `serve`; có `code` khi người dùng chọn. */
export function startupJobs({ code = false, folder } = {}) {
  const jobs = [{ name: 'serve', args: ['serve', '--no-qr'] }];
  // Lúc tự chạy không có ai trả lời câu hỏi giấy phép của VS Code Server, nên chỉ bật được sau khi `wa code`
  // đã chạy tay một lần (người dùng đã tự chấp nhận).
  if (code) jobs.push({ name: 'code', args: ['code', ...(folder ? [folder] : []), '--no-qr', '--accept-license'] });
  return jobs;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Các file cần ghi để bật tự khởi động. Hàm thuần: không đụng đĩa, để kiểm thử được trên mọi hệ điều hành.
 * Trả về [{ path, content, encoding }].
 */
export function startupFiles({ platform = process.platform, home = os.homedir(), appData = process.env.APPDATA, node = process.execPath, bin = BIN, dir, code = false, folder } = {}) {
  const jobs = startupJobs({ code, folder });
  if (platform === 'win32') {
    const startupDir = path.win32.join(appData || path.win32.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const files = jobs.map((j) => ({
      path: path.win32.join(dir, `startup-${j.name}.cmd`),
      // chcp 65001: đường dẫn có dấu (tên người dùng tiếng Việt) vẫn đúng.
      content: `@echo off\r\nchcp 65001 >nul\r\n"${node}" "${bin}" ${j.args.map((a) => (/[\s&()^]/.test(a) ? `"${a}"` : a)).join(' ')} > "${path.win32.join(dir, `startup-${j.name}.log`)}" 2>&1\r\n`,
      encoding: 'utf8',
    }));
    const runs = files.map((f) => `sh.Run "cmd /c """"${f.path}""""", 0, False`).join('\r\n');
    files.push({
      path: path.win32.join(startupDir, 'WujoAgent.vbs'),
      content: `' WujoAgent: starts hidden at sign-in. Remove with: wa startup off\r\nSet sh = CreateObject("WScript.Shell")\r\n${runs}\r\n`,
      encoding: 'utf16le', // wscript đọc đúng đường dẫn có dấu khi file là UTF-16 có BOM
    });
    return files;
  }
  if (platform === 'darwin') {
    return jobs.map((j) => ({
      path: path.posix.join(home, 'Library', 'LaunchAgents', `dev.wujo.agent.${j.name}.plist`),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.wujo.agent.${j.name}</string>
  <key>ProgramArguments</key>
  <array>
${[node, bin, ...j.args].map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(process.env.PATH || '/usr/local/bin:/usr/bin:/bin')}</string></dict>
  <key>StandardOutPath</key><string>${xml(path.posix.join(dir, `startup-${j.name}.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(path.posix.join(dir, `startup-${j.name}.log`))}</string>
</dict>
</plist>
`,
      encoding: 'utf8',
    }));
  }
  return jobs.map((j) => ({
    path: path.posix.join(process.env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'autostart', `wujoagent-${j.name}.desktop`),
    content: `[Desktop Entry]
Type=Application
Name=WujoAgent ${j.name}
Exec=sh -c ${JSON.stringify(`exec ${[node, bin, ...j.args].map(shq).join(' ')} > ${shq(path.posix.join(dir, `startup-${j.name}.log`))} 2>&1`)}
X-GNOME-Autostart-enabled=true
NoDisplay=true
`,
    encoding: 'utf8',
  }));
}

/** Mọi file mà `wa startup on` có thể đã tạo (cả phần code), để `off` và `status` tìm đủ. */
function allFiles(opts) {
  return startupFiles({ ...opts, code: true });
}

export function enableStartup(opts) {
  disableStartup(opts); // bỏ phần `code` cũ nếu lần này không chọn
  const files = startupFiles(opts);
  for (const f of files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, f.encoding === 'utf16le' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(f.content, 'utf16le')]) : f.content);
  }
  return files.map((f) => f.path);
}

export function disableStartup(opts) {
  const removed = [];
  for (const f of allFiles(opts)) {
    if (!fs.existsSync(f.path)) continue;
    fs.rmSync(f.path, { force: true });
    removed.push(f.path);
  }
  return removed;
}

/** { on, code }: đang bật không, và có kèm VS Code web không. */
export function startupStatus(opts) {
  const present = allFiles(opts).filter((f) => fs.existsSync(f.path)).map((f) => f.path);
  const has = (name) => present.some((p) => path.basename(p).includes(name));
  return { on: has('serve'), code: has('code'), files: present };
}
