# Kế hoạch Triển khai Muse Batch Manager (AI Video Batch Production & Flow Studio)

Xây dựng hệ thống quản lý tạo video AI hàng loạt (Muse Batch Manager) kèm module canvas trực quan (Flow Studio), quản lý đa tài khoản (Account Pool), kho ảnh tham chiếu (Reference Library), điều phối hàng đợi (Dispatcher đa luồng FIFO) và lưu trữ bền vững với cơ sở dữ liệu PostgreSQL.

### User Review & Critical Decisions

> [!IMPORTANT]
> Tóm tắt các quyết định đã xác nhận từ khảo sát và yêu cầu kỹ thuật:
> - **Cơ sở dữ liệu**: PostgreSQL cơ sở dữ liệu quan hệ doanh nghiệp (quản lý schema qua Drizzle ORM, lưu trữ toàn bộ dữ liệu Accounts, RefImages, Video Jobs, Studio Cards, Batch Settings, Error Logs, Progress Logs).
> - **Phong cách giao diện**: Giao diện Sáng hiện đại, tối ưu làm việc văn phòng chuyên nghiệp (Clean High-Density Office UI), tuân thủ tỷ lệ màu 60-30-10, thẻ phẳng viền hairline, không pill enclosures thừa.
> - **Typography**: Font Oswald cho toàn bộ tiêu đề (cùng cấp kích thước đồng nhất), font Roboto cho toàn bộ nội dung văn bản theo chỉ đạo.
> - **Cơ chế xử lý tạo video backend**: Mô hình Session API của nền tảng tạo video kết hợp Dispatcher cuốn chiếu FIFO đa luồng thật, gán job cho các tài khoản Online khả dụng, tự động phục hồi session, retry N lần và xử lý timeout X phút.
> - **Bảo mật tuyệt đối**: Thông tin đăng nhập/token được mã hóa at rest; không hiển thị plaintext trên giao diện hay API response (định danh che một phần); không log nhạy cảm; xóa tài khoản hủy luôn credential mã hóa.
> - **Khả năng chia sẻ**: Đường dẫn URL phân tách rõ ràng cho từng tính năng (`/batch`, `/studio`, `/accounts`, `/library`, `/progress`) giúp người dùng có thể bookmark hoặc gửi link trực tiếp tới đúng tính năng mà không bị reset state.
> - **Tài liệu & Tiến độ**: Cập nhật hồ sơ tài liệu kiến trúc, lỗi gặp phải (Error Log), kỹ năng (Skill Registry) và bảng tiến độ công việc để các agent luôn nắm rõ. Không có code chú thích thừa.

---

### 1. Overview & Core Concept

- **Mục tiêu sản phẩm**: Giải quyết bài toán sản xuất hàng chục tới hàng trăm video ngắn cho campaign quảng cáo hoặc series nhân vật. Loại bỏ thao tác thủ công bằng cách gom toàn bộ vào hàng đợi tự động chạy đa luồng qua pool tài khoản và canvas kéo thả trực quan.
- **Hai module chính**:
  1. **Batch Manager ("Hàng đợi")**: Soạn batch prompt, tự động nhận diện `@tag` gắn ảnh tham chiếu, badge đếm prompt trực tiếp (debounce ~200ms), cài đặt thời lượng (5s/10s/15s), tỉ lệ (9:16, 16:9, 1:1), luồng/tài khoản, dải "Đang chạy trực tiếp" ghim trên danh sách video, phát video inline và tải MP4.
  2. **Flow Studio ("Studio kéo thả")**: Canvas nền chấm (dot grid), các thẻ video image-to-video kéo thả tự do, hỗ trợ zoom, nút "Vừa khung", tích hợp cùng cơ chế dispatcher và Account Pool của hệ thống.
- **Đối tượng người dùng**: Nhà sản xuất video quảng cáo, đội ngũ sáng tạo series nội dung có nhân vật cố định, người dùng tạo video quy mô lớn.
- **Nguyên tắc cốt lõi**:
  - Dán là chạy (tùy chọn toggle với bộ đếm thông minh).
  - Xem trước rồi mới tải (video phát inline ngay tại dòng).
  - Mọi thứ đang chạy phải nhìn thấy đồng thời (dải Live Running Strip).
  - Không hardcode dữ liệu: 100% dữ liệu thực hiện đầy đủ Xem / Thêm / Sửa / Xóa liên kết cơ sở dữ liệu.

---

### 2. User Experience & Visual Design

- **Typography & Font**:
  - Tiêu đề, brand wordmark, tab labels: **Oswald** (Google Fonts).
  - Toàn bộ nội dung body, bảng, tham số, form: **Roboto** (Google Fonts).
  - Thông số kỹ thuật, Task ID, đồng hồ giây, tỷ lệ: Monospace Tabular figures (`tabular-nums`).
- **Bố cục giao diện (Office Modern Clean)**:
  - **Header chính**:
    - Khu vực 1 (Trái): Brand wordmark "MUSE BATCH MANAGER".
    - Khu vực 2 (Giữa): Điều hướng phân tách chức năng: `Hàng đợi (Batch)` · `Studio kéo thả (Flow)` · `Kho ảnh (@tag)` · `Tài khoản (Pool)` · `Tiến độ & Nhật ký`.
    - Khu vực 3 (Phải): Bộ đếm tổng quan trực tiếp: Đang chạy, Chờ, Xong và trạng thái kết nối Online của hệ thống.
  - **Panel Kho ảnh tham chiếu (Reference Library)**: Cố định tiện dụng, hiển thị số ảnh hiện có, nút to rõ "+ Thêm ảnh tham chiếu", danh sách thumbnail gắn tag `@tag` và thao tác xóa nhanh. Hỗ trợ upload nhiều file cùng lúc (tối đa 8MB/file, lọc PNG/JPG/WebP, tự sinh tag sạch, cảnh báo trùng tag).
  - **Trang Hàng đợi (Batch Manager)**:
    - Cột trái: Form soạn thảo prompt lớn, chế độ tách prompt (Mỗi dòng / Mỗi đoạn / Toàn bộ), badge đếm trực tiếp số prompt, gợi ý gõ `@`, chip xác nhận ảnh đã gắn, cảnh báo đỏ tag thiếu, toggle "Dán là chạy", cài đặt thời lượng/tỉ lệ/luồng, nút hành động "Thêm vào hàng đợi" và "Chạy hàng đợi".
    - Cột phải: Dải "Đang chạy trực tiếp" (Live running strip) hiển thị đồng thời các job đang xử lý với thanh tiến độ %, thời gian chạy tính bằng giây (nhảy mỗi giây), kế tiếp là bảng danh sách video gọn 1 dòng với filter tabs, ô tìm kiếm, phân trang và player nhúng inline.
  - **Trang Flow Studio (Canvas kéo thả)**:
    - Bề mặt nền chấm (dot grid) vô cực, thẻ image-to-video trực quan với ảnh nguồn, ô prompt riêng có gợi ý `@tag`, player nhúng khi hoàn thành, thanh công cụ zoom (- / + / %), nút "Vừa khung" và nút "Tạo tất cả".

---

### 3. Key Product Decisions & Trade-Offs

- **Quyết định 1: Cơ sở dữ liệu quan hệ PostgreSQL với Drizzle ORM**
  - *Giải pháp*: Xây dựng đầy đủ bảng dữ liệu trong PostgreSQL (`accounts`, `ref_images`, `video_jobs`, `studio_cards`, `batch_settings`, `error_logs`, `project_progress`).
  - *Lý do*: Đáp ứng chính xác lựa chọn của người dùng về cơ sở dữ liệu doanh nghiệp, đảm bảo tính toàn vẹn dữ liệu quan hệ giữa jobs, accounts và tags, hỗ trợ transactions khi gán job và cập nhật trạng thái đa luồng.
- **Quyết định 2: Bộ điều phối Dispatcher FIFO đa luồng cuốn chiếu**
  - *Giải pháp*: Dispatcher backend xử lý hàng đợi FIFO, tính toán số luồng hiệu dụng: `min(luồng cấu hình, tổng slot trống tài khoản Online)`. Khi một job kết thúc (hoàn thành, lỗi, hoặc timeout), slot trống ngay lập tức được lấp đầy bằng job tiếp theo.
  - *Xử lý lỗi và mất kết nối*: Job bị lỗi tự động retry tối đa N lần (mặc định 2). Job treo quá X phút tự động timeout và đưa về chờ. Tài khoản bị ngắt kết nối hoặc tắt giữa chừng sẽ chuyển toàn bộ job đang xử lý về "Chờ" để gán cho tài khoản khác, không làm mất job.
- **Quyết định 3: Bảo mật thông tin tài khoản (Credential Security)**
  - *Giải pháp*: Mã hóa AES-256 at rest các access token / credentials phiên làm việc. Tuyệt đối không trả về thông tin mật ở API hay hiển thị plaintext ở UI (định danh che dạng `usr_***4812`). Xóa tài khoản sẽ xóa sạch khóa và token.
- **Quyết định 4: Định tuyến URL độc lập**
  - *Giải pháp*: Sử dụng URL query/hash params dạng `?view=batch`, `?view=studio`, `?view=accounts`, `?view=library`, `?view=progress` giúp người dùng có thể bookmark hoặc gửi link trực tiếp tới đúng tính năng mà không bị reset state.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MUSE BATCH MANAGER CLIENT                             │
│                                                                                 │
│  ┌─────────────────────────┐  ┌──────────────────────────────────────────────┐  │
│  │   Top Bar & Breadcrumbs │  │  Reference Library Panel (Header persistent) │  │
│  └───────────┬─────────────┘  └──────────────────────┬───────────────────────┘  │
│              │                                       │                          │
│  ┌───────────▼─────────────┐          ┌──────────────▼───────────────────────┐  │
│  │ Module 1: Batch Manager │          │       Module 2: Flow Studio          │  │
│  │ - Prompt Editor + @Tag  │          │ - Dot-Grid Interactive Canvas        │  │
│  │ - Live Running Strip    │          │ - Draggable Image-to-Video Cards     │  │
│  │ - Video Queue 1-Row List│          │ - Zoom & Fit-to-Frame Controls       │  │
│  └───────────┬─────────────┘          └──────────────┬───────────────────────┘  │
└──────────────┼───────────────────────────────────────┼──────────────────────────┘
               │ HTTP REST / Polling every 2s          │
┌──────────────▼───────────────────────────────────────▼──────────────────────────┐
│                         NODE.JS / EXPRESS BACKEND                               │
│                                                                                 │
│  ┌────────────────────────┐  ┌───────────────────────┐  ┌────────────────────┐  │
│  │ Account Pool & Session │  │   Queue Dispatcher    │  │ Media Processor &  │  │
│  │ - Token AES Encrypt    │  │ - FIFO Allocation     │  │ Session Worker     │  │
│  │ - Health-check probes  │  │ - Concurrency Control │  │ - Multi-thread run │  │
│  │ - Online/Offline State │  │ - Retry & Timeout (X) │  │ - Video / Frame MP4│  │
│  └───────────┬────────────┘  └───────────┬───────────┘  └───────────┬────────┘  │
└──────────────┼───────────────────────────┼──────────────────────────┼───────────┘
               │                           │                          │
┌──────────────▼───────────────────────────▼──────────────────────────▼───────────┐
│                      POSTGRESQL DATABASE (via Drizzle ORM)                      │
│                                                                                 │
│  • accounts (id, name, masked_id, encrypted_token, status, slots, health)       │
│  • ref_images (id, tag, filename, url, size, created_at)                        │
│  • video_jobs (id, prompt, ref_tags, status, progress, duration, ratio, video)  │
│  • studio_cards (id, pos_x, pos_y, image_url, prompt, status, video_url)       │
│  • system_settings (concurrency, retry_limit, timeout_minutes, paste_trigger)   │
│  • error_logs (id, task_id, original_code, message_vi, created_at)              │
│  • project_tasks (id, name, status, notes, updated_at)                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Thiết kế Bảng Cơ sở dữ liệu (PostgreSQL Schema):
1. **`accounts`**: `id`, `name`, `masked_identifier`, `encrypted_credential`, `is_enabled`, `session_status` ('online' | 'offline'), `current_running_jobs`, `max_slots`, `last_health_check`, `health_reason`, `created_at`.
2. **`ref_images`**: `id`, `tag` (UNIQUE), `filename`, `data_url` / `file_path`, `mime_type`, `file_size`, `created_at`.
3. **`video_jobs`**: `id` (`task_xxxxxxxx`), `prompt`, `ref_tags` (JSON array), `status` ('pending' | 'running' | 'completed' | 'failed' | 'stopped'), `progress` (0-100), `duration` (5 | 10 | 15), `aspect_ratio` ('9:16' | '16:9' | '1:1'), `account_id`, `attempts`, `error_code`, `error_message`, `video_url`, `thumbnail_url`, `created_at`, `started_at`, `finished_at`, `elapsed_seconds`.
4. **`studio_cards`**: `id`, `pos_x`, `pos_y`, `input_image_url`, `prompt`, `status`, `job_id`, `video_url`, `created_at`.
5. **`app_settings`**: `id`, `concurrency_limit`, `max_retries`, `timeout_minutes`, `auto_enqueue_on_paste`, `updated_at`.
6. **`system_logs`**: `id`, `category`, `message`, `details`, `created_at`.
7. **`project_progress`**: `id`, `feature`, `status` ('done' | 'doing' | 'todo'), `acceptance_id`, `notes`.

---

### 5. Kế hoạch Các bước Thực hiện (Execution Phases)

- **Bước 1: Khởi tạo Cấu trúc & Tài liệu Dự án**:
  - Tải font Oswald & Roboto trong `index.html`.
  - Thiết lập hồ sơ kỹ thuật `docs/ARCHITECTURE.md`, `docs/ERROR_LOGS.md`, `docs/SKILLS_REGISTRY.md` và `docs/PROGRESS.md`.
- **Bước 2: Thiết lập Backend, Database Drizzle & API Hợp đồng**:
  - Cấu hình server Express (`server.ts`), kết nối cơ sở dữ liệu PostgreSQL / Drizzle ORM theo đúng skill `cloudsql-setup`.
  - Triển khai toàn bộ API contract theo Mục 8 của spec:
    - Accounts: `addAccount`, `removeAccount`, `listAccounts`, `setAccountEnabled`, `accountHealth`.
    - Reference Library: `uploadRefImages`, `listRefImages`, `getRefImage`, `deleteRefImage`.
    - Queue & Jobs: `enqueueBatch`, `listJobs`, `processQueue`, `stopAll`, `retryJob`, `deleteJob`, `clearFinished`, `getState`.
    - Studio: `addStudioCard`, `updateStudioCard`, `generateAllStudio`.
  - Triển khai Worker Session API Engine & Dispatcher đa luồng FIFO với cơ chế phục hồi và retry.
- **Bước 3: Xây dựng Giao diện Batch Manager & Kho ảnh tham chiếu**:
  - Reference Library Panel tại Header với tính năng upload hàng loạt, tự sinh tag sạch, cảnh báo trùng tag.
  - Batch Prompt Editor với auto-detect `@tag`, dropdown autocomplete nổi tại con trỏ, badge đếm prompt trực tiếp (debounce ~200ms), toggle "Dán là chạy".
  - Dải "Đang chạy trực tiếp" (Live Running Strip) hiển thị đồng thời toàn bộ job đang xử lý, cập nhật mỗi giây.
  - Bảng danh sách job 1 dòng với video thumbnail click-to-play inline, bộ lọc trạng thái, tìm kiếm, phân trang và nút tải MP4.
- **Bước 4: Xây dựng Giao diện Flow Studio (Canvas kéo thả)**:
  - Canvas nền chấm (dot grid), thẻ video draggable, controls zoom & fit to frame.
  - Tích hợp chung với dispatcher và Account Pool.
- **Bước 5: Trang Quản lý Account Pool, Nhật ký Lỗi & Bảng Tiến độ**:
  - Giao diện thêm/xóa/bật/tắt tài khoản, che credential, kiểm tra sức khỏe phiên.
  - Bảng thống kê tiến độ công việc và nhật ký xử lý lỗi trực quan cho người dùng.
- **Bước 6: Kiểm thử Nghiệm thu Toàn diện (AC-01 đến AC-12)** & Tối ưu hóa Build.
