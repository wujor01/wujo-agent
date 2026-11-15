import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, localAddresses } from './config.js';
import { Store } from './store.js';
import { Manager } from './manager.js';
import { createServer } from './http.js';
import { claudeRunner } from './runner.js';
import { claudeHistory } from './history.js';
import { capabilities } from './models.js';
import { printQr } from './qr.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function startServer({ port, host, qr } = {}) {
  const cfg = loadConfig();
  const store = new Store(cfg.dir);
  const manager = new Manager({ store, runner: claudeRunner, history: claudeHistory });
  const webDir = process.env.CS_WEB_DIR || path.resolve(here, '../web');
  const server = createServer({ manager, token: cfg.token, webDir, capabilities });
  const listenPort = port || cfg.port;
  const listenHost = host || cfg.host;

  // Một lỗi lạc không được làm sập server và giết các lượt chat đang chạy.
  process.on('unhandledRejection', (err) => console.error('Lỗi chưa xử lý:', err));

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Cổng ${listenPort} đang bị dùng. Có thể server đã chạy rồi, hoặc đổi cổng: cs serve --port <số>`);
    } else if (err.code === 'EADDRNOTAVAIL') {
      console.error(`Máy này không có địa chỉ ${listenHost}. Kiểm tra lại --host.`);
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });

  server.listen(listenPort, listenHost, () => {
    console.log(`WujoAgent đang chạy trên ${listenHost}:${listenPort}`);
    console.log(`Token: ${cfg.token}`);
    console.log('Nhập một trong các địa chỉ sau vào app:');
    const addrs = listenHost === '0.0.0.0' ? localAddresses() : [{ kind: '', address: listenHost }];
    for (const a of addrs) console.log(`  ${a.kind.padEnd(10)} http://${a.address}:${listenPort}`);
    console.log(`Dữ liệu lưu tại: ${cfg.dir}`);
    if (qr !== false) printQr({ host: listenHost, port: listenPort, token: cfg.token });
  });
  return server;
}
