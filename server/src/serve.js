import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, localAddresses, resetToken, tokenSource } from './config.js';
import { Store } from './store.js';
import { Manager } from './manager.js';
import { createServer } from './http.js';
import { claudeRunner } from './runner.js';
import { claudeHistory } from './history.js';
import { capabilities } from './models.js';
import { printQr } from './qr.js';
import { Push } from './push.js';
import { checkForUpdate, installKind, latestVersion } from './update.js';
import { t } from './lang.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Phiên bản báo ở /api/health lấy từ package.json, để không lệch với bản đã cài.
const { version } = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8'));

export function startServer({ port, host, qr } = {}) {
  const cfg = loadConfig();
  const store = new Store(cfg.dir);
  const push = new Push(cfg.dir);
  const manager = new Manager({
    store, runner: claudeRunner, history: claudeHistory,
    notify: (kind, info) => push.send(kind, info),
  });
  const webDir = process.env.CS_WEB_DIR || path.resolve(here, '../web');
  const server = createServer({
    manager, token: tokenSource(cfg.dir), resetToken: () => resetToken(cfg.dir), webDir, capabilities, push, version,
    latest: () => latestVersion(cfg.dir),
  });
  const listenPort = port || cfg.port;
  const listenHost = host || cfg.host;

  // Một lỗi lạc không được làm sập server và giết các lượt chat đang chạy.
  process.on('unhandledRejection', (err) => console.error(t('Lỗi chưa xử lý:', 'Unhandled error:'), err));

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(t(`Cổng ${listenPort} đang bị dùng. Có thể server đã chạy rồi, hoặc đổi cổng: wa serve --port <số>`,
        `Port ${listenPort} is in use. The server may already be running, or pick another port: wa serve --port <number>`));
    } else if (err.code === 'EADDRNOTAVAIL') {
      console.error(t(`Máy này không có địa chỉ ${listenHost}. Kiểm tra lại --host.`, `This machine has no address ${listenHost}. Check --host.`));
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });

  server.listen(listenPort, listenHost, () => {
    console.log(t(`WujoAgent đang chạy trên ${listenHost}:${listenPort}`, `WujoAgent is running on ${listenHost}:${listenPort}`));
    console.log(`Token: ${cfg.token}`);
    console.log(t('Nhập một trong các địa chỉ sau vào app:', 'Enter one of these addresses in the app:'));
    const addrs = listenHost === '0.0.0.0' ? localAddresses() : [{ kind: '', address: listenHost }];
    for (const a of addrs) console.log(`  ${a.kind.padEnd(10)} http://${a.address}:${listenPort}`);
    console.log(t(`Dữ liệu lưu tại: ${cfg.dir}`, `Data is stored in: ${cfg.dir}`));
    if (qr !== false) printQr({ host: listenHost, port: listenPort, token: cfg.token });
    // Hỏi GitHub xem có bản mới không. Chỉ nhắc, không tự cập nhật: cập nhật là việc của người dùng (wa update).
    checkForUpdate(cfg.dir).then((u) => {
      if (!u.newer) return;
      const how = installKind() === 'source' ? 'git pull' : 'wa update';
      console.log(t(`\nCó bản mới ${u.latest} (đang chạy ${u.current}). Cập nhật: ${how}, rồi chạy lại "wa serve".`,
        `\nVersion ${u.latest} is available (running ${u.current}). Update: ${how}, then run "wa serve" again.`));
    }).catch(() => {});
  });
  return server;
}
