# Triển khai video.vaway.vn

Mô hình: GitHub Actions build → `rsync` qua SSH vào `/home/video.vaway.vn/releases/<commit>` → `systemd --user` chạy app → nginx proxy `video.vaway.vn` về `127.0.0.1:3100`. User `video.vaway.vn` **không có sudo**; chỉ bước bootstrap (một lần) cần root.

```
/home/video.vaway.vn/
  app.env            bí mật chạy app (quyền 600), không nằm trong git
  data/              video đã tạo (được nối vào mỗi release thành .data)
  releases/<sha>/    mã nguồn từng lần deploy (giữ 3 bản gần nhất)
  current -> releases/<sha>
```

## 1. Tạo deploy key (trên máy anh, một lần)
```bash
ssh-keygen -t ed25519 -f deploy_key -C "github-deploy" -N ""
```
`deploy_key.pub` đưa cho bước 2. `deploy_key` (private) đưa vào GitHub Secret ở bước 3. Không commit file này.

## 2. Bootstrap VPS (root, một lần)
Copy thư mục `deploy/` lên VPS rồi:
```bash
sudo bash bootstrap-root.sh "$(cat deploy_key.pub)"
# tuỳ chọn: APP_PORT=3101 CERTBOT_EMAIL=you@mail.com sudo -E bash bootstrap-root.sh "..."
```
Script (chạy lại nhiều lần vẫn an toàn) sẽ: cài nginx/Postgres/Node 22/ffmpeg/certbot nếu thiếu, tạo user không sudo, bật `linger` cho systemd --user, tạo database + role riêng, sinh `app.env` (mật khẩu DB, `CREDENTIAL_KEY`, `APP_ACCESS_TOKEN`), tạo vhost nginx và cấp SSL.

Xem mã đăng nhập web: `sudo grep APP_ACCESS_TOKEN /home/video.vaway.vn/app.env`.

**Sao lưu `CREDENTIAL_KEY` ở nơi an toàn.** Mất khóa này thì mọi credential tài khoản đã lưu không giải mã được nữa.

## 3. GitHub Secrets
Repo → Settings → Secrets and variables → Actions:

| Secret | Giá trị |
|---|---|
| `VPS_HOST` | IP đầy đủ của VPS |
| `VPS_USER` | `video.vaway.vn` |
| `VPS_SSH_KEY` | nội dung file `deploy_key` (private) |
| `VPS_KNOWN_HOSTS` | kết quả `ssh-keyscan -H <IP VPS>` (chạy từ máy anh, đối chiếu fingerprint) |
| `VPS_PORT` | (tuỳ chọn) cổng SSH nếu khác 22 |

## 4. Deploy
- Merge vào `main` → workflow **Deploy** tự chạy. Có thể bấm tay ở tab Actions → Deploy → Run workflow.
- Các nhánh khác và PR chỉ chạy **CI** (`tsc` + build).
- Workflow tự kiểm tra `https://video.vaway.vn/api/auth/status`; nếu app không lên, script trên VPS tự quay về bản trước.

## Vận hành (đăng nhập bằng user ứng dụng)
```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user status muse
journalctl --user -u muse -f
```
Rollback tay:
```bash
ls -1t ~/releases
ln -sfn ~/releases/<sha-cũ> ~/current && systemctl --user restart muse
```

## Lưu ý
- Trên production provider "Mô phỏng" bị tắt (`ENABLE_MOCK_PROVIDER=false`). Thêm tài khoản Veo (Gemini API key) hoặc Kling (`accessKey:secretKey`) ở tab Tài khoản.
- Chỉ chạy 1 instance cho mỗi database.
- Sao lưu định kỳ database `video_vaway` và thư mục `~/data`.
