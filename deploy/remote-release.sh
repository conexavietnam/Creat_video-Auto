#!/usr/bin/env bash
# Chạy trên VPS bởi user ứng dụng (GitHub Actions gọi qua SSH): bash remote-release.sh <release-id>
set -euo pipefail

RELEASE="${1:?thiếu release id}"
cd "$HOME"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

DIR="$HOME/releases/$RELEASE"
test -d "$DIR"

ln -sfn "$HOME/data" "$DIR/.data"

cd "$DIR"
npm ci --omit=dev --no-audit --no-fund

mkdir -p "$HOME/.config/systemd/user"
cp "$DIR/deploy/muse.service" "$HOME/.config/systemd/user/muse.service"
systemctl --user daemon-reload
systemctl --user enable muse.service >/dev/null 2>&1

PREVIOUS="$(readlink "$HOME/current" || true)"
ln -sfn "$DIR" "$HOME/current"
systemctl --user restart muse.service

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$(grep '^PORT=' "$HOME/app.env" | cut -d= -f2)/api/auth/status" >/dev/null 2>&1; then
    ls -1dt "$HOME"/releases/*/ | tail -n +4 | xargs -r rm -rf
    echo "Release $RELEASE đang chạy."
    exit 0
  fi
  sleep 2
done

echo "Ứng dụng không phản hồi sau khi khởi động, quay về bản trước." >&2
journalctl --user -u muse.service -n 40 --no-pager >&2 || true
if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
  ln -sfn "$PREVIOUS" "$HOME/current"
  systemctl --user restart muse.service
fi
exit 1
