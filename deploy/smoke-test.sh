#!/usr/bin/env bash
# Kiểm tra nhanh site đang chạy: bash smoke-test.sh [URL]
# Có APP_ACCESS_TOKEN trong môi trường thì kiểm tra thêm phần sau đăng nhập.
# Chỉ gửi request đọc, không tạo/xóa dữ liệu.
set -uo pipefail

BASE="${1:-https://video.vaway.vn}"
BASE="${BASE%/}"
PASS=0
FAIL=0
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

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

REQUIRED=false
echo "$status" | grep -q '"required":true' && REQUIRED=true
if [ "$REQUIRED" = true ]; then
  check "Workspace yêu cầu mã truy cập" ok
  c="$(code "$BASE/api/accounts")"
  [ "$c" = "401" ] && check "/api/accounts bị chặn khi chưa đăng nhập (401)" ok || check "/api/accounts bị chặn khi chưa đăng nhập (401)" bad "nhận $c"
  c="$(code "$BASE/media/khong-co.mp4")"
  [ "$c" = "401" ] && check "/media bị chặn khi chưa đăng nhập (401)" ok || check "/media bị chặn khi chưa đăng nhập (401)" bad "nhận $c"
else
  check "Workspace yêu cầu mã truy cập" bad "APP_ACCESS_TOKEN chưa được đặt, ai cũng vào được"
fi

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

if [ -n "${APP_ACCESS_TOKEN:-}" ]; then
  login="$(curl -sS -m 20 -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"token\":\"$APP_ACCESS_TOKEN\"}" 2>/dev/null || true)"
  if echo "$login" | grep -q '"success":true'; then
    check "Đăng nhập bằng APP_ACCESS_TOKEN" ok

    providers="$(body -b "$JAR" "$BASE/api/providers")"
    echo "$providers" | grep -q '"id":"veo","label":"[^"]*","kind":"api_key","credentialHint":"[^"]*","available":true' \
      && check "Provider Veo khả dụng" ok || check "Provider Veo khả dụng" bad "${providers:0:100}"
    echo "$providers" | grep -q '"id":"kling","label":"[^"]*","kind":"api_key","credentialHint":"[^"]*","available":true' \
      && check "Provider Kling khả dụng" ok || check "Provider Kling khả dụng" bad "${providers:0:100}"
    echo "$providers" | grep -q '"id":"mock","label":"[^"]*","kind":"demo","credentialHint":"[^"]*","available":false' \
      && check "Provider Mô phỏng đã tắt trên production" ok || check "Provider Mô phỏng đã tắt trên production" bad "nên đặt ENABLE_MOCK_PROVIDER=false"

    state="$(body -b "$JAR" "$BASE/api/state")"
    echo "$state" | grep -q '"counts"' && check "/api/state đọc được" ok || check "/api/state đọc được" bad "${state:0:100}"
    echo "$state" | grep -q '"isDispatcherActive":true' && check "Dispatcher đang hoạt động" ok || check "Dispatcher đang hoạt động" bad "isDispatcherActive không phải true"

    settings="$(body -b "$JAR" "$BASE/api/settings")"
    echo "$settings" | grep -q '"concurrencyLimit"' && check "Cài đặt hệ thống đã được seed" ok || check "Cài đặt hệ thống đã được seed" bad "${settings:0:100}"
  else
    check "Đăng nhập bằng APP_ACCESS_TOKEN" bad "${login:0:80}"
  fi
else
  echo "SKIP  Phần sau đăng nhập (đặt APP_ACCESS_TOKEN để kiểm tra thêm)"
fi

echo
echo "$PASS đạt, $FAIL lỗi"
[ "$FAIL" -eq 0 ]
