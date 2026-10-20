# Sóng 1 — Hardening trước khi nạp API key thật

Nguồn: `docs/REVIEW_2026-10-21.md`. Hai task **sửa file khác nhau, chạy song song được**. Sau đó Claude review, merge, deploy, verify. Không tạo thêm task rời cho từng lỗi.

| Task | Độ khó | Model | Vì sao | Chạy |
|---|---|---|---|---|
| W1-A | KHÓ | Sonnet 5 | Logic dispatcher/retry, chi phí thật nếu sai (trả tiền 2 lần) | Song song với W1-B |
| W1-B | KHÓ | Sonnet 5 | Đăng nhập/bảo mật + đổi hợp đồng API kho ảnh | Song song với W1-A |

## W1-A — Độ tin cậy dispatcher & provider (file: `src/server/dispatcher.ts`, `src/server/providers/*`)

Prompt dán cho agent:

> Repo Creat_video-Auto (Muse Batch Manager). Đọc `docs/REVIEW_2026-10-21.md` mục A, B, D, F. **Chỉ sửa** `src/server/dispatcher.ts`, `src/server/providers/*`, thêm test. Không đụng `server.ts`, `auth.ts`, frontend.
>
> Mục tiêu: không bao giờ gửi lại một job khi nền tảng có thể vẫn đang xử lý nó (tránh trả tiền 2 lần).
> 1. **Health check không đá tài khoản Offline vì lỗi thoáng qua.** Chỉ đặt Offline ngay khi lỗi là `AUTH_FAILED`. Với lỗi khác (timeout, mạng), đếm số lần thất bại liên tiếp theo tài khoản (trong bộ nhớ), chỉ Offline khi ≥3 lần liên tiếp. Chỉ `releaseAccountJobs` khi tài khoản thực sự Offline. Một lần health check thành công thì reset bộ đếm.
> 2. **Khi poll gặp lỗi tạm thời thì coi job vẫn đang chạy**, không `failOrRetry`. Áp dụng cho `kling.poll` và `pollJob` nói chung: lỗi mạng, HTTP 5xx, 429, JSON hỏng → giữ nguyên job, ghi log, thử lại ở lần poll sau. Chỉ kết thúc job khi (a) nền tảng báo rõ thất bại, (b) `AUTH_FAILED`, (c) hết timeout "không có tiến độ mới". Thêm ngưỡng: ≥10 lần poll lỗi liên tiếp thì mới coi là `PROVIDER_ERROR` retryable.
> 3. **Khôi phục khi khởi động:** trong `startDispatcher`, job `running` mà `external_id IS NULL` (submit dở khi server tắt) chuyển ngay về `pending` (không tính vào `attempts`). Job có `external_id` thì tiếp tục poll như hiện tại.
> 4. **Kling image2video và tỉ lệ:** tra tài liệu API Kling hiện hành xem `image2video` có nhận `aspect_ratio` không. Nếu có thì gửi; nếu không thì `validate()` phải báo rõ "Kling image-to-video lấy tỉ lệ theo ảnh đầu vào" và/hoặc `capabilities` phản ánh đúng. Ghi kết luận vào `docs/ARCHITECTURE.md`.
> 5. Thêm test (vitest hoặc node:test, thêm script `npm test`) cho: health 1 lần lỗi mạng không làm job bị giải phóng; poll lỗi mạng không làm job bị gửi lại; 3 lần health lỗi liên tiếp mới Offline; khởi động lại xếp lại job không có `external_id`. Dùng provider giả, không gọi API thật. `npm run lint` và `npm run build` phải qua.
> 6. Cập nhật `docs/ERROR_LOGS.md`, `docs/PROGRESS.md`, `docs/STATUS.md`. Commit nhỏ, không push lên `main`; mở nhánh riêng.

## W1-B — Bảo mật đăng nhập & kho ảnh (file: `src/server/auth.ts`, `server.ts`, frontend kho ảnh/Studio)

Prompt dán cho agent:

> Repo Creat_video-Auto. Đọc `docs/REVIEW_2026-10-21.md` mục C, E, H, I. **Chỉ sửa** `src/server/auth.ts`, `server.ts`, các component hiển thị kho ảnh/Studio, `src/api.ts`, và xóa `firebase-applet-config.json`. Không đụng `src/server/dispatcher.ts`, `src/server/providers/*`.
>
> 1. **Fail-closed:** khi `NODE_ENV=production` mà thiếu `APP_ACCESS_TOKEN` thì server từ chối khởi động (throw rõ ràng bằng tiếng Việt). Chỉ cho phép mở khi `NODE_ENV!=production`.
> 2. **Chống dò mã:** giới hạn đăng nhập sai theo IP (ví dụ 5 lần/15 phút, trả 429 kèm thông báo tiếng Việt), tin `X-Forwarded-For` chỉ khi đứng sau nginx (đặt `app.set('trust proxy', 1)`). So sánh hằng thời gian như hiện tại. Đặt `express.json` giới hạn nhỏ (ví dụ 100kb) riêng cho `/api/auth/*`, giữ 50MB cho các route upload sau bước đăng nhập (đặt `requireAuth` trước `express.json` lớn).
> 3. **Kho ảnh nhẹ:** `GET /api/ref-images` không trả `dataUrl` nữa, chỉ trả `id, tag, filename, mimeType, fileSize, createdAt` và một `thumbUrl`. Thêm `GET /api/ref-images/:tag/image` (sau đăng nhập) trả file ảnh với `Content-Type` đúng và `Cache-Control: private, max-age=3600`. Sửa frontend dùng URL này; đảm bảo dropdown `@`, Studio "chọn từ kho" vẫn chạy. Không đổi cách lưu trong DB ở task này.
> 4. **Chống bấm đúp Studio:** `POST /api/studio/generate-all` chuyển thẻ `idle|failed` sang `generating` bằng một câu `UPDATE ... RETURNING` nguyên tử trước khi tạo job, để hai request đồng thời không tạo trùng job cho cùng thẻ.
> 5. Xóa `firebase-applet-config.json` nếu không có import nào dùng (kiểm tra bằng grep).
> 6. Kiểm tra: `deploy/smoke-test.sh` chạy với server cục bộ ở cả hai chế độ; thêm vào đó kiểm tra "đăng nhập sai 6 lần → 429". `npm run lint` và `npm run build` qua. Cập nhật `docs/PROGRESS.md`, `docs/STATUS.md`. Mở nhánh riêng, không push `main`.

## Sau Sóng 1 (không giao agent)
- Claude review từng nhánh (checkpoint KHÓ), merge, deploy, chạy `smoke-test.sh` có token.
- **Giai đoạn 2:** thử 1 prompt thật trên Veo hoặc Kling để kiểm chứng provider (mục G). Cần API key và anh đồng ý chi phí.
- Anh sao lưu `CREDENTIAL_KEY` và `~/data` ra ngoài VPS (mục J).
