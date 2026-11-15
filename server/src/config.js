import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { defaultLang, normLang, setDefaultLang, t } from './lang.js';

export const DEFAULT_PORT = 7433;

export function dataDir() {
  return process.env.CS_DATA_DIR || path.join(os.homedir(), '.claude-sessions');
}

// Bảng chữ cái dễ gõ trên điện thoại: bỏ các ký tự dễ nhầm (0/o, 1/l/i).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateToken(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Đọc cấu hình; tạo token ở lần chạy đầu. Biến môi trường thắng file. */
export function loadConfig(dir = dataDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error(t(`File cấu hình hỏng: ${file}. Sửa hoặc xoá file này rồi chạy lại.`,
        `The config file is corrupt: ${file}. Fix or delete it, then run again.`));
    }
  }
  let changed = false;
  if (!cfg.token) { cfg.token = generateToken(); changed = true; }
  if (!cfg.port) { cfg.port = DEFAULT_PORT; changed = true; }
  if (!cfg.host) { cfg.host = '0.0.0.0'; changed = true; }
  if (changed) fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return {
    dir,
    token: process.env.CS_TOKEN || cfg.token,
    port: Number(process.env.CS_PORT || cfg.port),
    host: process.env.CS_HOST || cfg.host,
    lang: normLang(process.env.WA_LANG) || normLang(cfg.lang) || 'en',
  };
}

function writeConfig(file, cfg) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Lấy ngôn ngữ mặc định từ file cấu hình và áp dụng cho tiến trình này. Không tạo file hay thư mục nào,
 * nên gọi được cả ở `wa help`. File hỏng thì bỏ qua: lệnh đọc cấu hình sau đó sẽ báo lỗi rõ ràng.
 */
export function initLang(dir = dataDir()) {
  let lang;
  try { lang = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).lang; } catch { /* chưa có cấu hình */ }
  setDefaultLang(lang);
  return defaultLang();
}

/** Ghi ngôn ngữ mặc định ('vi' | 'en') vào file cấu hình. Server đang chạy dùng ngôn ngữ mới từ lần chạy lại. */
export function setLang(lang, dir = dataDir()) {
  const value = normLang(lang);
  if (!value) throw new Error(t('Ngôn ngữ phải là "vi" hoặc "en".', 'The language must be "vi" or "en".'));
  loadConfig(dir);
  const file = path.join(dir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.lang = value;
  writeConfig(file, cfg);
  setDefaultLang(value);
  return value;
}

/**
 * Đổi token: sinh token mới và ghi vào file cấu hình. Mọi thiết bị đang dùng token cũ phải thêm lại máy chủ.
 * Token lấy từ biến môi trường CS_TOKEN thì không đổi được ở đây.
 */
export function resetToken(dir = dataDir()) {
  if (process.env.CS_TOKEN) {
    throw new Error(t('Token đang lấy từ biến môi trường CS_TOKEN. Đổi biến đó rồi chạy lại server.',
      'The token comes from the CS_TOKEN environment variable. Change that variable and restart the server.'));
  }
  loadConfig(dir);
  const file = path.join(dir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.token = generateToken();
  writeConfig(file, cfg);
  return cfg.token;
}

/**
 * Hàm trả token hiện hành. Đọc lại file cấu hình khi file đổi, nên `wa token --reset` có hiệu lực ngay với
 * server đang chạy, không phải khởi động lại.
 */
export function tokenSource(dir = dataDir()) {
  const file = path.join(dir, 'config.json');
  let token = loadConfig(dir).token;
  let seen = mtime(file);
  return () => {
    if (process.env.CS_TOKEN) return process.env.CS_TOKEN;
    const now = mtime(file);
    if (now !== seen) {
      seen = now;
      try { token = loadConfig(dir).token; } catch { /* file đang ghi dở hoặc hỏng: giữ token cũ */ }
    }
    return token;
  };
}

function mtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

/** Các địa chỉ IPv4 của máy, để in ra cho người dùng nhập vào app. */
export function localAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const tailscale = a.address.startsWith('100.') && isCgnat(a.address);
      out.push({ name, address: a.address, kind: tailscale ? 'Tailscale' : 'LAN' });
    }
  }
  return out;
}

function isCgnat(ip) {
  const second = Number(ip.split('.')[1]);
  return second >= 64 && second <= 127;
}
