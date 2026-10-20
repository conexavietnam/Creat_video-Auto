# Status — Muse Batch Manager (video.vaway.vn)

## Đang làm (in progress)
- Chưa có task nào đang chạy. Sóng 1 chờ anh dispatch W1-A và W1-B (xem `docs/plans/active/2026-10-21-song-1-hardening.md`).

## Chưa làm (pending / queued)
- W1-A — dispatcher/provider không gửi lại job đang chạy (tránh trả tiền 2 lần) — KHÓ / Sonnet 5.
- W1-B — kho ảnh nhẹ, chống bấm đúp Studio, xóa file Firebase thừa (phần đăng nhập đã xong) — TRUNG BÌNH.
- ADM-A — backend `/api/admin/*` chỉ cho `SUPERADMIN_VAIDS=1` (info@vaway.vn): cài đặt API Veo/Kling..., thông số, thống kê, nhật ký — KHÓ / Sonnet 5, chạy sau Sóng 1. Xem `docs/plans/active/2026-10-21-admin-console.md`.
- ADM-B — giao diện `/admin` (4 tab) theo hợp đồng API cố định — TRUNG BÌNH / Haiku 4.5, chạy song song ADM-A (dùng dữ liệu giả).
- Giai đoạn 2: thử 1 prompt thật Veo/Kling — chờ API key và anh đồng ý chi phí.
- Sao lưu `CREDENTIAL_KEY` và `~/data` ra ngoài VPS — việc của anh.
- Task Flow (phiên trình duyệt) — chưa làm có chủ đích, không có API chính thức.

## Đã xong (done)
- 2026-10-20 — Deploy tay lên VPS .48, nginx + SSL, systemd --user cổng 3100, 5 GitHub Secrets. Chi tiết: `deploy/README.md`.
- 2026-10-21 — Đăng nhập chuyển sang VAWAY ID (app id 979215161807, LOGIN_MODE=admin, admin: vaid 1), đã deploy; cờ SSO `sso_auto/sso_logout/sso_smooth` bật (probe 120 s/300 s), đã xóa `APP_ACCESS_TOKEN` khỏi `app.env` (bản sao lưu ở `/root/app.env.video.before-vaid-20261021` trên VPS .48). Chờ anh thử đăng nhập thật bằng trình duyệt. Chi tiết: `docs/ARCHITECTURE.md` mục 5.
- 2026-10-21 — Review nhánh agent, merge vào `main`; smoke test site thật 7/7 đạt (chưa có token). Chi tiết: `docs/REVIEW_2026-10-21.md`.
