# Đề xuất bổ sung Spec v1.1

Spec v1.0 (17/10/2026) viết tốt: có MUST/SHOULD, vòng đời trạng thái, hợp đồng API, giá trị mặc định, 12 kịch bản nghiệm thu. Khi triển khai, các điểm dưới đây buộc phải tự quyết. Cần chốt vào spec để Frontend, Backend, QA cùng một hợp đồng. Cột "Hiện đang làm" là hành vi đã cài trong code.

## 1. Nền tảng tạo video (thiếu lớn nhất)
Thêm mục **Provider**:
- Mỗi tài khoản và mỗi job gắn một `providerId`. Dispatcher chỉ gán job cho tài khoản cùng provider.
- Mỗi provider khai báo `capabilities`: thời lượng, tỉ lệ, số ảnh tham chiếu tối đa, hỗ trợ image-to-video. UI chỉ cho chọn giá trị hợp lệ, server từ chối giá trị không hợp lệ.
- Hai kiểu kết nối: API key (Veo, Kling) và phiên trình duyệt (Google Flow). Kiểu phiên trình duyệt cần mục riêng về rủi ro điều khoản dịch vụ, captcha và phục hồi session.
- Thời lượng 5/10/15 giây ở mục 4.4 không áp dụng được cho mọi nền tảng (Veo: 4/6/8 giây). Bảng mặc định ở Phụ lục B nên là "mặc định theo provider".

## 2. Điểm mâu thuẫn / mơ hồ
| Vấn đề | Hiện đang làm | Cần quyết |
|---|---|---|
| 6.1 có "Timeout → Chờ lại" nhưng Phụ lục A không có trạng thái Timeout | Timeout là một lỗi (`TIMEOUT`), không phải trạng thái riêng | Giữ như vậy và sửa sơ đồ 6.1 |
| Timeout có tính vào N lần retry không | Có | Xác nhận |
| Retry thủ công có đặt lại bộ đếm | Có, `attempts = 0` | Xác nhận |
| Mất tài khoản giữa chừng có tính retry không | Không | Xác nhận |
| "Không có cập nhật tiến độ" với nền tảng không trả % (Veo, Kling) | Tính từ lúc gửi job hoặc lần đổi `stage` gần nhất | Quy định rõ; 9.1 cấm tự tăng % nên các nền tảng này hiện chỉ có 5% → 100% |
| Lỗi nào được retry | Lỗi mạng, 5xx, rate limit, timeout. Không retry: sai khóa (đưa tài khoản Offline), nội dung bị lọc, tham số sai, ảnh tham chiếu bị xóa | Chốt danh sách |

## 3. Mã lỗi chuẩn (Phụ lục A chỉ có thông báo)
`AUTH_FAILED`, `RATE_LIMITED`, `INVALID_REQUEST`, `CONTENT_FILTERED`, `PROVIDER_ERROR`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `ACCOUNT_DISCONNECTED`, `ACCOUNT_REMOVED`, `REF_MISSING`, `INPUT_IMAGE_INVALID`, `DOWNLOAD_FAILED`. Mỗi mã cần: thông báo tiếng Việt mẫu, có retry hay không.

## 4. Ảnh tham chiếu
- Thứ tự khi vừa có "ảnh dùng chung cho batch" vừa có `@tag`: hiện đặt `@tag` trong prompt trước, ảnh dùng chung cuối cùng.
- Giới hạn số ảnh mỗi job do provider quyết định (Kling 1, Veo 3). Cần nói rõ khi vượt thì chặn lúc thêm vào hàng đợi.
- Xóa ảnh khỏi kho khi job chờ còn dùng: hiện job đó thất bại ngay với `REF_MISSING` (không retry). 3.3 chỉ nói "cảnh báo".
- Studio: ảnh đầu vào là ảnh đầu khung (first frame) hay ảnh tham chiếu? Hiện là ảnh đầu khung; một số provider không cho dùng đồng thời với `@tag`.

## 5. Lưu trữ, bảo mật, vận hành
- 9.3 yêu cầu lưu video bền vững nhưng không nêu nơi lưu và thời hạn. Link của nền tảng thường hết hạn, cần tải về storage riêng (hiện `.data/videos`).
- 9.2 "chỉ chủ sở hữu workspace": spec chưa định nghĩa người dùng/workspace. Hiện chỉ có 1 mã truy cập cho cả hệ thống.
- Giới hạn tối đa số luồng và cách "giảm nhịp" khi rate limit (hiện: tài khoản nghỉ 60 giây, job tính 1 lần retry).
- Số instance server: hiện chỉ hỗ trợ 1 instance cho mỗi database.
- Hành vi khi server khởi động lại giữa lúc job đang chạy (hiện: tiếp tục poll theo `external_id`).
- Hành vi "Dừng tất cả" với nền tảng không hỗ trợ hủy (Veo): job bị đánh dấu Đã dừng nhưng nền tảng vẫn có thể tính phí.
