# Status — Muse Batch Manager (video.vaway.vn)

## Đang làm (in progress)
- Không có task nào đang chạy.
- Sóng 1 (W1-A, W1-B) vẫn chờ dispatch (xem `docs/plans/active/2026-10-21-song-1-hardening.md`). W1-A sửa `dispatcher.ts` và `providers/*`, ADM-A đã sửa nhẹ `providers/index.ts`, `veo.ts`, `kling.ts` (đã vào `main`): W1-A phải làm trên `main` mới nhất.

## Chưa làm (pending / queued)
- W1-A — dispatcher/provider không gửi lại job đang chạy (tránh trả tiền 2 lần) — KHÓ / Sonnet 5.
- W1-B — kho ảnh nhẹ, chống bấm đúp Studio, xóa file Firebase thừa (phần đăng nhập đã xong) — TRUNG BÌNH.
- Chặn Veo thật: cả 4 khóa trả 429 `RESOURCE_EXHAUSTED` (dự án Google chưa có hạn mức/thanh toán Veo) — anh bật thanh toán cho từng dự án rồi thử lại; W1-A thêm phân loại lỗi `QUOTA_EXHAUSTED` (phần 4b).
- Giai đoạn 2: thử 1 prompt thật Veo/Kling — chờ API key và anh đồng ý chi phí.
- Sao lưu `CREDENTIAL_KEY` và `~/data` ra ngoài VPS — việc của anh.
- Task Flow (phiên trình duyệt) — chưa làm có chủ đích, không có API chính thức.

## Đã xong (done)
- 2026-10-21 — ADM-A + ADM-B (`/admin`: Nhà cung cấp, Thông số, Thống kê, Nhật ký; chỉ `SUPERADMIN_VAIDS=1`) đã review, merge và deploy; `npm test` 19/19 trên VPS; vá lỗi múi giờ UTC khi review. Chi tiết: `docs/REVIEW_2026-10-21.md`, `docs/ARCHITECTURE.md` mục 7.
- 2026-10-20 — Deploy tay lên VPS .48, nginx + SSL, systemd --user cổng 3100, 5 GitHub Secrets. Chi tiết: `deploy/README.md`.
- 2026-10-21 — Đăng nhập chuyển sang VAWAY ID (app id 979215161807, LOGIN_MODE=admin, admin: vaid 1), đã deploy; cờ SSO `sso_auto/sso_logout/sso_smooth` bật (probe 120 s/300 s), đã xóa `APP_ACCESS_TOKEN` khỏi `app.env` (bản sao lưu ở `/root/app.env.video.before-vaid-20261021` trên VPS .48). Chờ anh thử đăng nhập thật bằng trình duyệt. Chi tiết: `docs/ARCHITECTURE.md` mục 5.
- 2026-10-21 — Review nhánh agent, merge vào `main`; smoke test site thật 7/7 đạt (chưa có token). Chi tiết: `docs/REVIEW_2026-10-21.md`.
