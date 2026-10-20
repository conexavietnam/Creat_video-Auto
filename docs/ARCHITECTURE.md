# Muse Batch Manager - Kiến trúc Hệ thống (System Architecture)

## 1. Tổng quan Kiến trúc
Muse Batch Manager được thiết kế theo mô hình Full-Stack React + Node.js/Express tích hợp cơ sở dữ liệu quan hệ PostgreSQL (quản lý qua Drizzle ORM).

## 2. Các Bảng Cơ sở dữ liệu (Database Schema)
- `accounts`: Quản lý danh sách tài khoản video generation, lưu mã hóa credentials (at rest AES-256), trạng thái Online/Offline, sức khỏe phiên, số slot chạy tối đa.
- `ref_images`: Kho ảnh tham chiếu, lưu trữ tag duy nhất (@tag), tên file, thumbnail/base64/URL, kích thước và loại MIME.
- `video_jobs`: Quản lý danh sách job video trong hàng đợi, câu prompt gốc, refTags gắn kèm, trạng thái (Chờ, Đang chạy, Hoàn thành, Thất bại, Đã dừng), tiến độ %, số lần thử lại (retry), mã lỗi, video URL & thumbnail MP4.
- `studio_cards`: Danh sách các thẻ image-to-video trên canvas Flow Studio, lưu tọa độ (x, y), ảnh nguồn, prompt, trạng thái và kết quả video.
- `app_settings`: Lưu tham số cấu hình hệ thống: số luồng song song, số lần retry tối đa (N), thời gian timeout (X phút), tự động thêm khi paste.
- `system_logs`: Nhật ký xử lý hệ thống và ghi nhận lỗi.
- `project_progress`: Bảng thống kê tiến độ thực hiện tính năng cho team.

## 3. Bộ điều phối Dispatcher & Multi-threading
- Luồng chạy FIFO: Lấy job "Chờ" cũ nhất.
- Số luồng hiệu dụng: min(số luồng cấu hình, tổng slot khả dụng của tài khoản Online + Enabled).
- Tự động gán cuốn chiếu ngay khi có slot trống.
- Tự động retry tối đa N lần nếu job lỗi; sau N lần ghi nhận lỗi và dừng job.
- Tự động đánh dấu timeout nếu job đang chạy quá X phút mà không cập nhật tiến độ.
- Khi tài khoản bị Offline/tắt giữa chừng, các job đang gán cho tài khoản đó lập tức được chuyển về trạng thái "Chờ" để gán cho tài khoản khác.

## 4. Bảo mật & Định tuyến URL
- Mọi token / credential được mã hóa bằng AES-256 trước khi lưu database. Không trả lại plaintext trên UI/API.
- Phân tách đường dẫn theo URL query params: `?view=batch`, `?view=studio`, `?view=accounts`, `?view=library`, `?view=progress` giúp người dùng chia sẻ trực tiếp link tính năng.
