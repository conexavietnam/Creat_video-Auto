#!/usr/bin/env bash
# Kiểm tra nhanh site đang chạy: bash smoke-test.sh [URL]
# Đăng nhập bằng VAWAY ID (qua trình duyệt) nên script chỉ kiểm phần không cần đăng nhập.
# Chỉ gửi request đọc (và một POST bị từ chối có chủ đích), không tạo/xóa dữ liệu.
set -uo pipefail

BASE="${1:-https://video.vaway.vn}"
BASE="${BASE%/}"
PASS=0
FAIL=0

check() {
  if [ "$2" = "ok" ]; then
    PASS=$((PASS + 1))
    echo "PASS  $1"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL  $1  ($3)"
  fi
}

code() {
  curl -sS -m 20 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || true
}

body() {
  curl -sS -m 20 "$@" 2>/dev/null || true
}

c="$(code "$BASE/")"
[ "$c" = "200" ] && check "Trang chủ trả 200" ok || check "Trang chủ trả 200" bad "nhận $c"

c="$(code "$BASE/?view=studio")"
[ "$c" = "200" ] && check "Đường dẫn ?view=studio trả 200" ok || check "Đường dẫn ?view=studio trả 200" bad "nhận $c"

status="$(body "$BASE/api/auth/status")"
if echo "$status" | grep -q '"success":true'; then
  check "API /api/auth/status trả JSON hợp lệ" ok
else
  check "API /api/auth/status trả JSON hợp lệ" bad "nhận: ${status:0:80}"
fi

echo "$status" | grep -q '"required":true' \
  && check "Workspace yêu cầu đăng nhập" ok || check "Workspace yêu cầu đăng nhập" bad "required không phải true, ai cũng vào được"
echo "$status" | grep -q '"vaid":{"appId":"[0-9]*","loaderUrl":"https://id.vaway.vn/libraries/v3/' \
  && check "Đăng nhập VAWAY ID đã được cấu hình" ok || check "Đăng nhập VAWAY ID đã được cấu hình" bad "thiếu vaid.appId/loaderUrl: ${status:0:120}"
echo "$status" | grep -q '"authenticated":false' \
  && check "Khách chưa đăng nhập không được tính là đã đăng nhập" ok || check "Khách chưa đăng nhập không được tính là đã đăng nhập" bad "${status:0:120}"

c="$(code "$BASE/api/accounts")"
[ "$c" = "401" ] && check "/api/accounts bị chặn khi chưa đăng nhập (401)" ok || check "/api/accounts bị chặn khi chưa đăng nhập (401)" bad "nhận $c"
c="$(code "$BASE/api/ref-images")"
[ "$c" = "401" ] && check "/api/ref-images bị chặn khi chưa đăng nhập (401)" ok || check "/api/ref-images bị chặn khi chưa đăng nhập (401)" bad "nhận $c"
c="$(code "$BASE/media/khong-co.mp4")"
[ "$c" = "401" ] && check "/media bị chặn khi chưa đăng nhập (401)" ok || check "/media bị chặn khi chưa đăng nhập (401)" bad "nhận $c"

c="$(code -X POST "$BASE/api/auth/vaid/code" -H 'Content-Type: application/json' -d '{"code":"x","state":"y"}')"
[ "$c" = "403" ] && check "Endpoint đổi mã từ chối request không cùng nguồn (403)" ok || check "Endpoint đổi mã từ chối request không cùng nguồn (403)" bad "nhận $c"

c="$(code "$BASE/api/auth/vaid?access_verify=khong-hop-le")"
[ "$c" = "302" ] && check "Callback VAID từ chối mã sai (302 về trang chủ)" ok || check "Callback VAID từ chối mã sai (302 về trang chủ)" bad "nhận $c"

case "$BASE" in
  https://*)
    host="${BASE#https://}"
    host="${host%%/*}"
    c="$(code "http://$host/")"
    case "$c" in
      301|302|307|308) check "http:// chuyển hướng sang https://" ok ;;
      *) check "http:// chuyển hướng sang https://" bad "nhận $c" ;;
    esac
    ;;
esac

echo "SKIP  Phần sau đăng nhập: mở $BASE bằng trình duyệt, đăng nhập VAWAY ID rồi kiểm tay"
echo
echo "$PASS đạt, $FAIL lỗi"
[ "$FAIL" -eq 0 ]
