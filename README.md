# PDF Edit

Trình chỉnh sửa PDF cho Windows 10 trở lên, lấy cảm hứng từ Wondershare PDFelement: sửa trực tiếp văn bản và hình ảnh trong PDF, chú thích, quản lý trang, gộp/tách file, bảo mật, biểu mẫu và chuyển đổi. Giao diện tiếng Việt (có tiếng Anh).

## Tính năng

**Chỉnh sửa nội dung**
- Sửa văn bản có sẵn theo đoạn hoặc theo dòng (giữ phông, cỡ chữ, màu; hỗ trợ tiếng Việt), thêm hộp văn bản mới.
- Chọn, di chuyển, đổi kích thước, xoá, thay thế ảnh có sẵn; thêm ảnh mới.
- Liên kết (web/trang), che trắng (whiteout), cắt trang (crop).
- Hình mờ (watermark), nền, đầu trang/chân trang, đánh số Bates.

**Chú thích**
- Tô sáng, gạch chân, gạch ngang, gạch sóng; ghi chú (sticky note), hộp văn bản.
- Bút vẽ, tẩy, hình chữ nhật, elip, đường thẳng, mũi tên, đường gấp khúc, đa giác.
- Con dấu (mẫu sẵn, tuỳ chỉnh, ảnh), chữ ký (vẽ, gõ, ảnh).
- Bảng bình luận; chọn/di chuyển/xoá chú thích có sẵn trong file.

**Trang**
- Chế độ sắp xếp trang dạng lưới: kéo thả, xoay, xoá, nhân bản, đảo ngược, chọn chẵn/lẻ/ngang/dọc.
- Chèn trang trắng, chèn từ PDF/ảnh, thay thế trang, trích xuất, tách file (theo số trang, khoảng trang, dấu trang).

**Gộp file và tạo mới**
- Gộp nhiều PDF và ảnh, chọn khoảng trang cho từng file, sắp xếp thứ tự, tự tạo dấu trang.
- Tạo PDF trắng hoặc từ ảnh.

**Bảo vệ**
- Đặt mật khẩu mở / mật khẩu quyền (AES-256), gỡ bảo mật.
- Biên tập (redaction) xoá thật nội dung: vùng chọn, văn bản chọn, tìm và biên tập.

**Biểu mẫu, chuyển đổi, công cụ**
- Điền biểu mẫu, đặt lại, làm phẳng (flatten).
- Chuyển sang Word (.docx), ảnh (PNG/JPEG), văn bản, HTML.
- Nén, thuộc tính tài liệu, in, tìm kiếm, dấu trang, tệp đính kèm, hoàn tác/làm lại, nhiều tab.

## Cài đặt (Windows 10/11, 64-bit)

Chạy `PDF-Edit-Setup-<phiên bản>-x64.exe`, chọn cài cho người dùng hiện tại hoặc mọi người dùng và thư mục cài đặt. Bộ cài tạo lối tắt trên Desktop/Start Menu và đăng ký mở tệp `.pdf` ("Open with"). Cài đặt im lặng: `PDF-Edit-Setup-<phiên bản>-x64.exe /S`.

## Phát triển

Yêu cầu Node.js 22+.

```bash
npm install
npm start               # build giao diện và chạy ứng dụng
npm test                # unit test (cần poppler-utils cho một số kiểm tra)
npm run test:e2e        # test giao diện end-to-end (Electron + Playwright)
```

### Xuất bộ cài Windows

Trên Windows:

```bash
npm run dist:win        # -> release/PDF-Edit-Setup-<phiên bản>-x64.exe
```

Trên Linux cần Wine (wine64 + wine32): `USE_SYSTEM_WINE=true xvfb-run -a npm run dist:win`.

Workflow GitHub Actions `.github/workflows/build.yml` chạy test và build bộ cài trên Windows cho mỗi lần push.

## Kiến trúc

- `src/main` – tiến trình chính Electron (cửa sổ, hộp thoại, đọc/ghi file, phông hệ thống, giao thức `app://`).
- `src/core` – lõi xử lý PDF: phân tích/thông dịch content stream, xoá văn bản theo glyph, sửa ảnh, dựng trang, chú thích, mã hoá, xuất DOCX.
- `src/renderer` – giao diện (pdf.js để hiển thị, pdf-lib để ghi file), đóng gói bằng esbuild.
- `tests` – unit test, E2E test và bộ sinh file mẫu.

## Giấy phép

MIT. Thành phần bên thứ ba: pdf.js (Apache-2.0), pdf-lib/@cantoo (MIT), fontkit (MIT), fflate (MIT), phông Liberation (SIL OFL 1.1, xem `src/assets/fonts/LICENSE-OFL.txt`).
