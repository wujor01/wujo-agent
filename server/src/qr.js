import qrcode from 'qrcode-terminal';
import { localAddresses } from './config.js';

export const LINK_BASE = 'https://agent.wujo.dev/add';

/**
 * Link để thêm máy chủ vào app bằng cách quét QR.
 *
 *   https://agent.wujo.dev/add#t=<token>&p=<port>&h=<host1>,<host2>
 *
 * - Là Universal Link / App Link của app: camera của điện thoại mở thẳng app nếu đã cài. Chưa cài thì
 *   mở trang agent.wujo.dev/add, trang đó cho mở app hoặc dùng bản web trên chính máy tính này.
 * - Token và địa chỉ nằm sau dấu # nên trình duyệt không gửi chúng lên agent.wujo.dev.
 * - `h` liệt kê mọi địa chỉ của máy (Tailscale, LAN), địa chỉ của mã đứng đầu; app thử lần lượt và
 *   giữ cái nối được.
 */
export function addLink({ host, port, token, hosts = [host] }) {
  const all = [host, ...hosts.filter((h) => h !== host)];
  return `${LINK_BASE}#t=${encodeURIComponent(token)}&p=${port}&h=${all.map(encodeURIComponent).join(',')}`;
}

/** Các địa chỉ mà điện thoại có thể dùng để nối tới server này. */
export function reachableAddresses(listenHost) {
  if (listenHost === '0.0.0.0' || listenHost === '::') return localAddresses();
  if (listenHost === '127.0.0.1' || listenHost === 'localhost') return [];
  return [{ kind: '', address: listenHost }];
}

function render(text) {
  return new Promise((resolve) => qrcode.generate(text, { small: true }, resolve));
}

/** In mã QR ra terminal, mỗi địa chỉ một mã (điện thoại phải nối được đúng địa chỉ trong mã nó quét). */
export async function printQr({ host, port, token, only }) {
  let addrs = reachableAddresses(host);
  if (only) addrs = addrs.filter((a) => a.address === only || a.kind.toLowerCase() === String(only).toLowerCase());
  if (!addrs.length) {
    console.log(only
      ? `Máy này không có địa chỉ "${only}".`
      : 'Server chỉ nghe trên máy này (127.0.0.1) nên điện thoại không nối được; không in mã QR.');
    return;
  }
  const hosts = reachableAddresses(host).map((a) => a.address);
  for (const a of addrs) {
    console.log(`\nQuét để thêm máy chủ qua ${a.kind || 'địa chỉ'} ${a.address}:`);
    console.log(await render(addLink({ host: a.address, port, token, hosts })));
  }
  console.log('Mã QR chứa token. Ai quét được mã này thì điều khiển được Claude Code trên máy này.');
}
