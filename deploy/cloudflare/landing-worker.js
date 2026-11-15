// Worker của trang agent.wujo.dev. Chỉ chạy cho các trang HTML và các link tải (xem
// run_worker_first trong wrangler.landing.jsonc); CSS, JS, ảnh và gói server do Cloudflare phục vụ thẳng.
//
// Ngôn ngữ: tiếng Việt ở "/", tiếng Anh ở "/en/".
//   - ?lang=vi|en   lựa chọn từ nút đổi ngôn ngữ: nhớ vào cookie rồi chuyển về URL sạch.
//   - cookie lang   lựa chọn trước đó thắng vị trí.
//   - còn lại       khách từ Việt Nam (request.cf.country) xem tiếng Việt ở "/", nơi khác được chuyển
//                   sang "/en/". URL "/en/..." luôn hiện tiếng Anh, không chuyển ngược.
//
// Tải app:
//   /download/android  file APK trong bucket R2 DOWNLOADS (sync-apk.mjs chép từ EAS sang), hỗ trợ Range
//                      để tải dở nối lại được; bucket chưa có thì chuyển tới ANDROID_APK_URL.
//   /download/ios      chuyển tới IOS_URL (link TestFlight công khai hoặc trang App Store).
//   Chưa cấu hình thì quay về trang chủ kèm ?soon=..., app.js hiện dòng "chưa phát hành".

const APK_KEY = 'android/wujoagent.apk';
const YEAR = 60 * 60 * 24 * 365;
const PAGES = new Set(['/', '/privacy']);

function redirect(location, cookie) {
  const headers = { Location: location, 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 302, headers });
}

/** URL của một trang ("/" hoặc "/privacy") trong ngôn ngữ cho trước. */
function pathIn(lang, page) {
  if (lang === 'en') return page === '/' ? '/en/' : `/en${page}`;
  return page;
}

function langOf(request) {
  const cookie = /(?:^|;\s*)lang=(vi|en)\b/.exec(request.headers.get('Cookie') ?? '')?.[1];
  return cookie ?? (request.cf?.country === 'VN' ? 'vi' : 'en');
}

function soon(request, platform) {
  return redirect(`${pathIn(langOf(request), '/')}?soon=${platform}`);
}

/** File APK từ R2, có Range; chưa có trong R2 thì dùng link EAS; chưa có cả hai thì báo chưa phát hành. */
async function androidApk(request, env) {
  const head = request.method === 'HEAD';
  const object = head
    ? await env.DOWNLOADS?.head(APK_KEY)
    : await env.DOWNLOADS?.get(APK_KEY, { range: request.headers, onlyIf: request.headers });
  if (!object) return env.ANDROID_APK_URL ? redirect(env.ANDROID_APK_URL) : soon(request, 'android');

  const headers = new Headers({ 'Cache-Control': 'public, max-age=300', 'Accept-Ranges': 'bytes', ETag: object.httpEtag });
  object.writeHttpMetadata(headers);
  if (head) {
    headers.set('Content-Length', String(object.size));
    return new Response(null, { headers });
  }
  if (!object.body) return new Response(null, { status: 304, headers }); // If-None-Match khớp
  if (object.range && request.headers.has('Range')) {
    const { suffix } = object.range;
    const offset = suffix !== undefined ? object.size - suffix : (object.range.offset ?? 0);
    const length = object.range.length ?? object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/download/android') return androidApk(request, env);
    if (path === '/download/ios') return env.IOS_URL ? redirect(env.IOS_URL) : soon(request, 'ios');

    const isEnglishUrl = path === '/en' || path.startsWith('/en/');
    const page = isEnglishUrl ? path.slice(3) || '/' : path;
    if (PAGES.has(page)) {
      const chosen = url.searchParams.get('lang');
      if (chosen === 'vi' || chosen === 'en') {
        const rest = new URLSearchParams(url.search);
        rest.delete('lang');
        const query = rest.size ? `?${rest}` : '';
        return redirect(pathIn(chosen, page) + query, `lang=${chosen}; Path=/; Max-Age=${YEAR}; SameSite=Lax; Secure`);
      }
      if (!isEnglishUrl && langOf(request) === 'en') return redirect(pathIn('en', page) + url.search);
      // "/en" (không có dấu / cuối) về dạng chuẩn "/en/".
      if (url.pathname === '/en') return redirect(`/en/${url.search}`);
    }

    const response = await env.ASSETS.fetch(request);
    if (!PAGES.has(page)) return response;
    // Trang ở "/" tuỳ theo người xem (ngôn ngữ), nên bộ đệm dùng chung không được giữ lại.
    const out = new Response(response.body, response);
    out.headers.set('Cache-Control', 'private, no-cache');
    out.headers.set('Vary', 'Cookie');
    return out;
  },
};
