#!/usr/bin/env bash
# Chạy MỘT LẦN bằng root trên VPS: bash bootstrap-root.sh "<nội dung public key deploy>"
# Biến tùy chọn: APP_USER, APP_DOMAIN, APP_PORT, DB_NAME, DB_USER, CERTBOT_EMAIL
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Cần chạy bằng root." >&2
  exit 1
fi

DEPLOY_PUBKEY="${1:-}"
if [ -z "$DEPLOY_PUBKEY" ]; then
  echo "Thiếu public key deploy. Cách dùng: bash bootstrap-root.sh \"ssh-ed25519 AAAA... github-deploy\"" >&2
  exit 1
fi

APP_USER="${APP_USER:-video.vaway.vn}"
APP_DOMAIN="${APP_DOMAIN:-video.vaway.vn}"
APP_PORT="${APP_PORT:-3100}"
DB_NAME="${DB_NAME:-video_vaway}"
DB_USER="${DB_USER:-video_vaway}"
HOME_DIR="/home/${APP_USER}"
APP_UID=""

export DEBIAN_FRONTEND=noninteractive

if ss -ltn 2>/dev/null | grep -q "127.0.0.1:${APP_PORT}\b\|:${APP_PORT}\b"; then
  if [ ! -f "${HOME_DIR}/app.env" ]; then
    echo "Cổng ${APP_PORT} đang được dùng bởi dịch vụ khác. Chạy lại với APP_PORT=<cổng khác>." >&2
    exit 1
  fi
fi

echo "==> Cài gói cần thiết"
apt-get update -y
apt-get install -y nginx postgresql ffmpeg rsync curl ca-certificates certbot python3-certbot-nginx openssl

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Cài Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Tạo user ${APP_USER} (không sudo)"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
fi
for group in sudo wheel admin; do
  if getent group "$group" >/dev/null 2>&1; then
    gpasswd -d "$APP_USER" "$group" >/dev/null 2>&1 || true
  fi
done
APP_UID="$(id -u "$APP_USER")"
chmod 750 "$HOME_DIR"

echo "==> Cấp quyền SSH cho deploy key"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "${HOME_DIR}/.ssh"
touch "${HOME_DIR}/.ssh/authorized_keys"
if ! grep -qF "$DEPLOY_PUBKEY" "${HOME_DIR}/.ssh/authorized_keys"; then
  echo "$DEPLOY_PUBKEY" >> "${HOME_DIR}/.ssh/authorized_keys"
fi
chown "$APP_USER:$APP_USER" "${HOME_DIR}/.ssh/authorized_keys"
chmod 600 "${HOME_DIR}/.ssh/authorized_keys"

echo "==> Thư mục ứng dụng"
for dir in releases data; do
  install -d -m 750 -o "$APP_USER" -g "$APP_USER" "${HOME_DIR}/${dir}"
done

echo "==> Postgres"
systemctl enable --now postgresql
ENV_FILE="${HOME_DIR}/app.env"
if [ -f "$ENV_FILE" ]; then
  echo "app.env đã có, giữ nguyên các bí mật hiện tại."
  DB_PASSWORD="$(grep '^SQL_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
else
  DB_PASSWORD="$(openssl rand -hex 24)"
fi

if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\"" | grep -q 1; then
  su postgres -c "psql -c \"CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}'\""
else
  su postgres -c "psql -c \"ALTER ROLE ${DB_USER} PASSWORD '${DB_PASSWORD}'\""
fi
if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\"" | grep -q 1; then
  su postgres -c "psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}\""
fi

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<ENVEOF
NODE_ENV=production
PORT=${APP_PORT}
SQL_HOST=127.0.0.1
SQL_USER=${DB_USER}
SQL_PASSWORD=${DB_PASSWORD}
SQL_DB_NAME=${DB_NAME}
CREDENTIAL_KEY=$(openssl rand -hex 32)
APP_ACCESS_TOKEN=$(openssl rand -hex 16)
ENABLE_MOCK_PROVIDER=false
ENVEOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  GENERATED_ENV=1
else
  GENERATED_ENV=0
fi

echo "==> systemd --user"
loginctl enable-linger "$APP_USER"
systemctl start "user@${APP_UID}.service"
install -d -m 755 -o "$APP_USER" -g "$APP_USER" "${HOME_DIR}/.config" "${HOME_DIR}/.config/systemd" "${HOME_DIR}/.config/systemd/user"

echo "==> nginx"
sed "s/__PORT__/${APP_PORT}/" "$(dirname "$0")/nginx-video.vaway.vn.conf" > "/etc/nginx/sites-available/${APP_DOMAIN}.conf"
ln -sf "/etc/nginx/sites-available/${APP_DOMAIN}.conf" "/etc/nginx/sites-enabled/${APP_DOMAIN}.conf"
nginx -t
systemctl reload nginx

echo "==> SSL (Let's Encrypt)"
if [ -n "${CERTBOT_EMAIL:-}" ]; then
  certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
else
  certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

echo
echo "Hoàn tất bootstrap."
echo "User: ${APP_USER} (không có sudo) | Cổng nội bộ: ${APP_PORT} | DB: ${DB_NAME}"
if [ "$GENERATED_ENV" = "1" ]; then
  echo "Mã đăng nhập web (APP_ACCESS_TOKEN) nằm trong ${ENV_FILE}. Xem bằng: grep APP_ACCESS_TOKEN ${ENV_FILE}"
fi
echo "Tiếp theo: thêm GitHub Secrets rồi chạy workflow Deploy."
