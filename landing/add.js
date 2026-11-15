// Trang đích của mã QR thêm máy chủ:  https://agent.wujo.dev/add#t=<token>&p=<cổng>&h=<host1>,<host2>
//
// iPhone đã cài app: camera mở thẳng app qua Universal Link, trang này không hiện ra.
// Chưa cài app (hoặc máy không hỗ trợ): trang hiện hai lối đi, mở app bằng wujoagent:// hoặc dùng bản web
// do chính máy tính của người dùng phục vụ.
//
// Mọi thông tin kết nối nằm sau dấu #: trình duyệt không gửi phần đó lên agent.wujo.dev, và trang này
// không gọi mạng với nó. Trang chỉ ghép lại thành hai đường link cho người dùng bấm.
(function () {
  var en = !/^vi\b/i.test(navigator.language || '');
  var $ = function (id) { return document.getElementById(id); };
  if (en) {
    document.documentElement.lang = 'en';
    document.title = 'Add a computer — WujoAgent';
    $('title').textContent = 'Add a computer';
    $('lead').textContent = 'This QR code adds a computer to WujoAgent.';
    $('open-app').firstChild.textContent = 'Open in the WujoAgent app';
    $('open-app-note').textContent = 'If you have the app installed';
    $('open-web').firstChild.textContent = 'Use the web version';
    $('open-web-note').textContent = 'Nothing to install';
    $('install-note').innerHTML = 'No app yet? <a href="/download/ios">Get it for iPhone</a> · <a href="/download/android">Get it for Android</a>, then scan the code again.';
    $('invalid').innerHTML = 'This link has no computer details. Run <code>wujoagent qr</code> on your computer and scan the new code.';
  }

  var hash = location.hash.slice(1);
  var params = {};
  hash.split('&').forEach(function (pair) {
    var eq = pair.indexOf('=');
    if (eq > 0) { try { params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1)); } catch (e) { /* bỏ qua */ } }
  });
  var hosts = (params.h || '').split(',').map(function (h) {
    try { return decodeURIComponent(h).trim(); } catch (e) { return ''; }
  }).filter(function (h) { return /^[a-zA-Z0-9.\-]+$/.test(h); });
  var port = Number(params.p) || 7433;
  if (!params.t || !hosts.length || port < 1 || port > 65535) return; // giữ dòng báo link hỏng

  $('invalid').style.display = 'none';
  $('actions').hidden = false;
  $('open-app').href = 'wujoagent://add#' + hash;
  // Bản web chạy trên chính máy tính của người dùng, ở địa chỉ đầu tiên trong mã (địa chỉ họ vừa quét).
  $('open-web').href = 'http://' + hosts[0] + ':' + port + '/add#' + hash;
  $('host-note').textContent = (en ? 'Computer: ' : 'Máy tính: ') + hosts.join(', ') + (en ? ', port ' : ', cổng ') + port + '.';
})();
