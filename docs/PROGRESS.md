# Bảng Thống kê Tiến độ Dự án Muse Batch Manager

Cập nhật sau đợt rà soát spec v1.0 ↔ code. Cột "Mức xác nhận" cho biết đã được kiểm thử tới đâu, không chỉ "đã viết code".

| STT | Hạng mục | Trạng thái | Mức xác nhận |
|---|---|---|---|
| 1 | Khởi tạo dự án, font, tài liệu | ĐÃ HOÀN THÀNH | Build + chạy được |
| 2 | Schema PostgreSQL, tự migrate + seed `app_settings` khi khởi động | ĐÃ HOÀN THÀNH | Chạy thật trên Postgres 16 |
| 3 | Mã hóa credential AES-256-GCM, không trả credential ra API/UI | ĐÃ HOÀN THÀNH | Kiểm tra trực tiếp DB + API + UI (AC-12) |
| 4 | Dispatcher: slot theo từng tài khoản, FIFO, `SKIP LOCKED`, chống tick chồng | ĐÃ HOÀN THÀNH | E2E: 3 tài khoản × 1 slot + 6 luồng → đúng 3 job song song (ví dụ 2.6) |
| 5 | Retry N lần, timeout theo "không có tiến độ mới", gán lại khi mất tài khoản | ĐÃ HOÀN THÀNH | E2E (AC-08, AC-09) với provider mô phỏng |
| 6 | Health check định kỳ 60s + khi thêm/bật tài khoản | ĐÃ HOÀN THÀNH | Chạy thật với provider mô phỏng; Veo/Kling dùng gọi API thật |
| 7 | Kiến trúc Provider (Veo, Kling, Flow, Mô phỏng) + kiểm tra capability | ĐÃ HOÀN THÀNH | E2E với provider mô phỏng |
| 8 | Provider Mô phỏng (demo) | ĐÃ HOÀN THÀNH | E2E. Không tạo video thật |
| 9 | Provider Kling API | CHƯA KIỂM CHỨNG VỚI API THẬT | Test với server Kling giả lập (JWT, text2video/image2video, poll) |
| 10 | Provider Veo (Gemini API) | CHƯA KIỂM CHỨNG VỚI API THẬT | Chỉ biên dịch + đối chiếu kiểu SDK; cần API key thật |
| 11 | Provider Google Flow (phiên trình duyệt) | CHƯA LÀM | Bị chặn có chủ đích, không có API chính thức |
| 12 | Resolve `@tag` → ảnh khi tạo job (snapshot), chặn tag thiếu ở server | ĐÃ HOÀN THÀNH | E2E + UI (AC-02, AC-03) |
| 13 | Kiểm tra định dạng/dung lượng ảnh phía server (magic bytes) | ĐÃ HOÀN THÀNH | E2E |
| 14 | Batch Manager: badge đếm, @mention có phím ↑↓/Enter/Esc, dán-là-chạy + Hoàn tác, lưu toggle | ĐÃ HOÀN THÀNH | Playwright trên Chromium (AC-01..07, AC-10) |
| 15 | Dải Đang chạy trực tiếp, danh sách 1 dòng, xem trước rồi tải | ĐÃ HOÀN THÀNH | Playwright. Thumbnail tạo bằng ffmpeg nếu máy có |
| 16 | Flow Studio dùng chung provider/thời lượng/tỉ lệ, gửi ảnh đầu vào | ĐÃ HOÀN THÀNH | E2E (AC-11); chưa test kéo-thả bằng UI tự động |
| 17 | Account Pool: chọn nền tảng, cấu hình slot | ĐÃ HOÀN THÀNH | Playwright + E2E |
| 18 | Đăng nhập bằng VAWAY ID (form nhúng + SSO hai chiều), `LOGIN_MODE=admin`, fail-closed | ĐÃ HOÀN THÀNH 21/10/2026 | Harness 19 ca với id thật (chữ ký, kiểm admin, cookie giả/hết hạn, mã giả, signout). Chưa thử đăng nhập bằng trình duyệt thật |
| 19 | Định tuyến URL `?view=...` | ĐÃ HOÀN THÀNH | Playwright |
| 20 | ADM-A: backend `/api/admin/*` (phân quyền `SUPERADMIN_VAIDS`, khóa API, cấu hình provider, thông số, thống kê, nhật ký kiểm toán) | ĐÃ HOÀN THÀNH, CHỜ REVIEW | `npm test` 19 ca (AD-01..08) với Postgres thật + kiểm thử đột biến (làm hỏng có chủ đích 4 chỗ, test bắt được cả 4); chạy tay trên server thật có/không có `SUPERADMIN_VAIDS`. Chưa thêm khóa Veo/Kling thật |

## Giới hạn đã biết
- Chỉ chạy 1 instance server cho mỗi database (trạng thái tạm dừng và poll nằm trong bộ nhớ).
- Veo không có % tiến độ và không hủy được thao tác: job hiện 5% rồi nhảy 100% khi xong. Kling cũng không có %.
- Video lưu tại `.data/videos` trên đĩa của server (cần volume bền vững khi triển khai).
