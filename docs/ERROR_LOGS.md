# Nhật ký Sửa lỗi (Error Logs) - Muse Batch Manager

Ghi chép đầy đủ các lỗi phát sinh trong quá trình phát triển, nguyên nhân và phương án khắc phục để không bị tái lập.

| ID Lỗi | Thời gian | Mô tả Lỗi | Nguyên nhân | Phương án Xử lý | Trạng thái |
|---|---|---|---|---|---|
| ERR-001 | 2026-10-19 | TargetFile không phải path tuyệt đối trong write_to_file | Truyền relative path thay vì `/app/applet/...` hoặc `/...` | Đã chuẩn hóa toàn bộ đường dẫn gọi tool dạng absolute path bắt đầu bằng `/` | Đã xử lý |
| ERR-002 | 2026-10-19 | Cần import tĩnh firebase-applet-config.json trong ESM | Dùng fs/require động bị thất bại trong ES Module | Đã dùng static import `import firebaseConfig from '../../firebase-applet-config.json'` | Đã xử lý |
| ERR-003 | 2026-10-20 | "Mã hóa" credential chỉ là base64 cắt ngắn, API/UI trả về chuỗi này | Chưa dùng thuật toán mã hóa thật | AES-256-GCM, khóa riêng, API không trả credential | Đã xử lý |
| ERR-004 | 2026-10-20 | Dispatcher bỏ qua `maxSlots`, dùng `số tài khoản × 2`, chia vòng tròn | Logic giả lập | Tính slot trống từng tài khoản, gán trong transaction `SKIP LOCKED` | Đã xử lý |
| ERR-005 | 2026-10-20 | `PUT /api/settings` không lưu gì | Bảng `app_settings` không có dòng id=1 | Seed khi khởi động, PUT nhận từng trường và kiểm tra giá trị | Đã xử lý |
| ERR-006 | 2026-10-20 | Job tạo video giả: % tăng theo đồng hồ, luôn gắn video mẫu | Chưa có worker thật | Tách provider adapter; progress chỉ lấy từ nền tảng | Đã xử lý (Veo/Kling chưa test API thật) |
| ERR-007 | 2026-10-20 | Nhãn cỡ `text-2xs` hiển thị to bất thường | Tailwind v4 chưa định nghĩa `--text-2xs` | Khai báo trong `@theme` | Đã xử lý |
| ERR-008 | 2026-10-21 | Một lần health check lỗi (timeout, rớt mạng) đưa tài khoản Offline và gửi lại mọi job đang chạy sang khóa khác (trả tiền 2 lần) | `checkAccountHealth` coi mọi thất bại là mất kết nối | Chỉ `AUTH_FAILED` hoặc lỗi vĩnh viễn mới Offline ngay; lỗi khác phải liên tiếp 3 lần; một lần thành công xóa bộ đếm | Đã xử lý (W1-A) |
| ERR-009 | 2026-10-21 | Kling poll gặp mạng/5xx/429/JSON hỏng thì job bị đặt về Chờ và gửi lại (tạo trùng video có phí) | `pollJob` đưa mọi lỗi vào `failOrRetry` | Lỗi poll tạm thời giữ nguyên job; chỉ coi là lỗi sau 10 lần liên tiếp; `AUTH_FAILED` khi poll kết thúc job kèm cảnh báo "video có thể đã được tạo" thay vì gửi lại | Đã xử lý (W1-A) |
| ERR-010 | 2026-10-21 | Sau restart/deploy, job đang gửi dở (chưa có `external_id`) đứng yên 15 phút | Chỉ timeout mới xếp lại | `startDispatcher` xếp lại ngay các job `running` không có `external_id` (không tính retry, mã `SERVER_RESTART`) | Đã xử lý (W1-A) |
| ERR-011 | 2026-10-21 | Veo 429 `RESOURCE_EXHAUSTED` do thiếu hạn mức/thanh toán bị báo chung chung "vượt giới hạn tốc độ", hệ thống xoay hết các khóa cùng dự án; regex `/rate/` khớp nhầm chữ "generate" | `toProviderError` coi mọi 429 là `RATE_LIMITED` | Phân loại `QUOTA_EXHAUSTED` (không retry, tài khoản vào cooldown 30 phút kèm lý do hiện ở `/admin`) và `RATE_LIMITED` (nghỉ 60 giây); thêm `MODEL_UNAVAILABLE`; thông báo có `status` của Google đã loại khóa | Đã xử lý (W1-A). Việc của anh: bật thanh toán cho dự án Google |
| ERR-012 | 2026-10-21 | Kling image-to-video không có tham số `aspect_ratio` nhưng UI cho chọn 16:9/9:16/1:1 | Tỉ lệ i2v lấy theo ảnh đầu vào | `validate()` đọc kích thước ảnh, từ chối rõ ràng khi tỉ lệ chọn không khớp ảnh hoặc ảnh dưới 300×300 | Đã xử lý (W1-A) |

