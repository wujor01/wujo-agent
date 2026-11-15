// Khi /download/... chưa có bản phát hành, worker chuyển về trang chủ kèm ?soon=ios|android.
// Hiện một dòng báo ngay dưới các nút tải rồi dọn tham số khỏi thanh địa chỉ.
(function () {
  var params = new URLSearchParams(location.search);
  var soon = params.get('soon');
  var box = document.getElementById('soon');
  if (!soon || !box) return;
  var en = document.documentElement.lang === 'en';
  var text = {
    ios: en
      ? 'The iPhone version is not published yet. Until then, open the web version served by your computer after running "wujoagent serve".'
      : 'Bản iPhone chưa được phát hành. Trong lúc đó, bạn dùng được bản web do chính máy tính của bạn phục vụ sau khi chạy "wujoagent serve".',
    android: en
      ? 'The Android APK is not published yet. Until then, open the web version served by your computer after running "wujoagent serve".'
      : 'File APK cho Android chưa được phát hành. Trong lúc đó, bạn dùng được bản web do chính máy tính của bạn phục vụ sau khi chạy "wujoagent serve".',
  }[soon];
  if (!text) return;
  box.textContent = text;
  box.classList.add('show');
  params.delete('soon');
  var query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
})();
