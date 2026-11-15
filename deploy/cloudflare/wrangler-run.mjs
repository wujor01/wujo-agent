// Gọi wrangler mà không qua shell. Trên Windows, `npx` là file .cmd nên phải chạy qua cmd.exe, và cmd
// cắt tham số tại dấu ";" hay dấu ngoặc kép (ví dụ 'attachment; filename="WujoAgent.apk"').
// Chạy thẳng file JS của wrangler bằng node thì tham số đi nguyên vẹn trên mọi hệ điều hành.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const entry = fileURLToPath(new URL('./node_modules/wrangler/bin/wrangler.js', import.meta.url));

/** stdio 'inherit' in thẳng ra màn hình; ['ignore','pipe','ignore'] để lấy stdout về dạng chuỗi. */
export function wrangler(args, stdio = 'inherit') {
  return execFileSync(process.execPath, [entry, ...args], { cwd: here, encoding: 'utf8', stdio });
}
