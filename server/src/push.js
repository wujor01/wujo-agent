import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './manager.js';
import { t } from './lang.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/;

// Nội dung thông báo là câu cố định theo ngôn ngữ của thiết bị. Không bao giờ kèm chữ của cuộc trò chuyện:
// thông báo đi qua máy chủ của Expo và của Apple/Google, là nơi duy nhất dữ liệu rời khỏi máy người dùng.
const TEXT = {
  done: { vi: 'Claude đã chạy xong.', en: 'Claude has finished.' },
  ask: { vi: 'Claude đang chờ bạn duyệt.', en: 'Claude is waiting for your approval.' },
  error: { vi: 'Lượt chat kết thúc với lỗi.', en: 'The turn ended with an error.' },
};

/**
 * Thông báo đẩy tới các điện thoại đã bật thông báo cho máy chủ này.
 *   devices.json — [{ token, tag, lang, platform, updatedAt }]
 * `tag` là mã mà app tự đặt cho máy chủ này (để khi bấm vào thông báo, app biết mở máy chủ nào).
 */
export class Push {
  constructor(dir, { fetchImpl = globalThis.fetch } = {}) {
    this.file = path.join(dir, 'devices.json');
    this.fetch = fetchImpl;
    this.devices = [];
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data)) this.devices = data.filter((d) => d && TOKEN.test(d.token));
    } catch { /* chưa có file hoặc file hỏng: bắt đầu với danh sách rỗng */ }
  }

  #save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.devices, null, 2));
    fs.renameSync(tmp, this.file);
  }

  register({ token, tag, lang, platform }) {
    if (typeof token !== 'string' || !TOKEN.test(token)) {
      throw new HttpError(400, t('Mã thiết bị không hợp lệ.', 'Invalid device token.'));
    }
    const device = {
      token,
      tag: typeof tag === 'string' ? tag.slice(0, 64) : '',
      lang: lang === 'vi' ? 'vi' : 'en',
      platform: platform === 'android' ? 'android' : 'ios',
      updatedAt: Date.now(),
    };
    this.devices = [...this.devices.filter((d) => d.token !== token), device].slice(-20);
    this.#save();
    return { ok: true, devices: this.devices.length };
  }

  unregister(token) {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.token !== token);
    if (this.devices.length !== before) this.#save();
    return { ok: true, devices: this.devices.length };
  }

  /** Bỏ mọi thiết bị, trừ thiết bị có mã `keep` (dùng khi đổi token: các máy khác không còn quyền nữa). */
  keepOnly(keep) {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => keep && d.token === keep);
    if (this.devices.length !== before) this.#save();
    return { ok: true, devices: this.devices.length };
  }

  /**
   * Gửi một thông báo tới mọi thiết bị đã đăng ký. Không bao giờ ném lỗi: mất mạng hay Expo từ chối
   * không được ảnh hưởng tới lượt chat. Trả về số thông báo đã được Expo nhận.
   */
  async send(kind, { sessionId, cwd }) {
    const text = TEXT[kind];
    if (!text || !this.devices.length) return 0;
    const folder = path.basename(String(cwd || '')) || 'WujoAgent';
    const messages = this.devices.map((d) => ({
      to: d.token,
      title: folder,
      body: text[d.lang] || text.en,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      data: { kind, sessionId, tag: d.tag },
    }));
    try {
      const res = await this.fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json().catch(() => null);
      const tickets = Array.isArray(body?.data) ? body.data : [];
      // Thiết bị đã gỡ app hoặc tắt thông báo: bỏ khỏi danh sách để lần sau không gửi nữa.
      const dead = new Set();
      tickets.forEach((ticket, i) => {
        if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') dead.add(messages[i].to);
      });
      if (dead.size) {
        this.devices = this.devices.filter((d) => !dead.has(d.token));
        this.#save();
      }
      if (!res.ok) console.error(`Gửi thông báo đẩy thất bại: HTTP ${res.status}`);
      return tickets.filter((x) => x?.status === 'ok').length;
    } catch (err) {
      console.error(`Gửi thông báo đẩy thất bại: ${err?.message || err}`);
      return 0;
    }
  }
}
