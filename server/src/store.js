import fs from 'node:fs';
import path from 'node:path';

/**
 * Lưu session và sự kiện xuống đĩa.
 *   sessions.json        — metadata của mọi session
 *   events/<id>.jsonl    — mỗi dòng một sự kiện, chỉ ghi nối
 */
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.eventsDir = path.join(dir, 'events');
    fs.mkdirSync(this.eventsDir, { recursive: true });
    this.file = path.join(dir, 'sessions.json');
  }

  loadSessions() {
    if (!fs.existsSync(this.file)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      // Giữ file hỏng lại để người dùng xem, không ghi đè mất dữ liệu.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, backup);
      console.error(`sessions.json hỏng, đã đổi tên thành ${backup}`);
      return [];
    }
  }

  saveSessions(sessions) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sessions, null, 2));
    fs.renameSync(tmp, this.file);
  }

  eventsFile(id) {
    return path.join(this.eventsDir, `${id}.jsonl`);
  }

  loadEvents(id) {
    const file = this.eventsFile(id);
    if (!fs.existsSync(file)) return [];
    const events = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* dòng ghi dở khi mất điện: bỏ qua */ }
    }
    return events;
  }

  appendEvent(id, event) {
    fs.appendFileSync(this.eventsFile(id), JSON.stringify(event) + '\n');
  }

  /** Ghi lại toàn bộ sự kiện (khi đồng bộ lại từ lịch sử của Claude). */
  replaceEvents(id, events) {
    const tmp = `${this.eventsFile(id)}.tmp`;
    fs.writeFileSync(tmp, events.map((e) => JSON.stringify(e) + '\n').join(''));
    fs.renameSync(tmp, this.eventsFile(id));
  }

  removeEvents(id) {
    fs.rmSync(this.eventsFile(id), { force: true });
  }
}
