# Báo cáo kiểm thử – PDF Edit 1.0.0

- **Thời gian kiểm thử:** 26/10/2026, 12:56 – 14:56 (UTC), 2 giờ liên tục.
- **Bản kiểm thử:** nhánh `ccr-7624b48b-jacnbj`, các commit từ `cebad24` đến bản cuối.
- **Môi trường:**
  - Electron 44.6.0 (Chromium 152), Node.js 22, Linux + Xvfb, Playwright (điều khiển ứng dụng Electron thật).
  - Bộ cài Windows: build NSIS bằng electron-builder 26.17 trên Linux (Wine 9) và trên runner `windows-latest` của GitHub Actions; cài thử im lặng (`/S`) trên Wine (Windows 10 build 19043).
  - Công cụ đối chiếu kết quả: poppler (`pdftotext`, `pdfinfo`, `pdffonts`, `pdfimages`, `pdftoppm`), pdf-lib.

## 1. Phạm vi và phương pháp

| Loại | Nội dung | Số lượng |
|---|---|---|
| Unit test (`npm test`) | Lõi PDF: phân tích content stream, xóa glyph, sửa ảnh, dựng trang, chú thích, biểu mẫu, mã hóa AES/RC4 | 23 |
| E2E test (`npm run test:e2e`) | Điều khiển giao diện thật như người dùng: mở/tab/mật khẩu, sửa văn bản, chú thích, quản lý trang, gộp file, hình mờ/đầu-chân trang/Bates, tìm & biên tập, mã hóa, biểu mẫu, chuyển đổi, in, đóng ứng dụng khi chưa lưu, quyền hạn PDF | 67 (8 tệp) |
| Kiểm thử khám phá | 24 kịch bản tự viết (ảnh trong chế độ sửa, trang xoay, cắt trang, che trắng, dấu trang, thuộc tính, nén, chèn/thay trang, file hỏng/cụt, tài liệu 300 trang, tệp đính kèm, gộp file có mật khẩu, PDF từ ảnh, HTML, điều hướng bàn phím, đa tài liệu, sao chép giữa tài liệu, kiểu chữ, đổi ngôn ngữ/giao diện tối, bảng & danh sách từ LibreOffice, chữ ký vẽ tay, tẩy, liên kết nội bộ, tìm kiếm tiếng Việt) – mỗi kết quả lưu ra đều được mở lại bằng poppler/pdf-lib và xem ảnh chụp màn hình | 24 |
| CI | GitHub Actions: unit + E2E trên Ubuntu, build bộ cài trên Windows | mỗi lần push |

**Kết quả cuối:** 23/23 unit test và 67/67 E2E test đạt; CI xanh (cả job build bộ cài trên Windows).

## 2. Lỗi phát hiện và đã sửa

| # | Mức độ | Lỗi | Cách sửa | Test hồi quy |
|---|---|---|---|---|
| 1 | Nghiêm trọng (bảo mật) | Lưu lại một file đã đặt mật khẩu mở (mật khẩu mở = mật khẩu quyền, mặc định khi chỉ đặt mật khẩu mở) làm **mất mật khẩu mở** – ai cũng mở được bản lưu | Bản lưu của file mã hóa luôn yêu cầu mật khẩu đã dùng để mở, giữ nguyên quyền hạn; file chỉ có mật khẩu quyền vẫn được mã hóa | `05` "saving the reopened file keeps its open password" |
| 2 | Nghiêm trọng (bảo mật) | pdf.js 6 trả quyền hạn dạng `Set` → tài liệu cấm sửa không bị khóa chỉnh sửa, bản lưu **mất hạn chế** (ví dụ cấm in thành cho in) | Chuẩn hóa quyền hạn về mảng | `08` (2 test) |
| 3 | Cao | Ô checkbox/radio **không hiển thị dấu tích** (pdf.js 6 cần `annotationCanvasMap`) | Truyền canvas trạng thái cho lớp biểu mẫu, vẽ lại các canvas riêng còn lại lên trang, CSS dự phòng cho trang đang sửa | `06` "filled values survive re-rendering" |
| 4 | Cao | Giá trị đã điền vào ô văn bản **hiện lại giá trị cũ** sau khi trang vẽ lại (zoom, sửa trang) | Đồng bộ `formattedValue` trong annotationStorage | `06` |
| 5 | Cao | **Mất ký tự khi đang gõ** nếu trang vẽ lại giữa chừng (ô soạn thảo bị tách khỏi DOM, mất focus và tự xác nhận) | Giữ nguyên ô soạn thảo khi vẽ lại lớp đối tượng | `02` "typing continues when the page re-renders" |
| 6 | Trung bình | Lỗi `sendWithPromise` (gọi pdf.js sau khi đóng tab) | Hủy hàng đợi vẽ, kiểm tra tài liệu đã đóng | `01` "no errors were logged" |
| 7 | Trung bình | Sửa một đoạn văn làm **mất màu/kiểu của dòng khác kiểu** liền kề (gộp đoạn sai) | Chỉ gộp các dòng cùng phông và màu thành đoạn | `02` "lines with a different colour…" |
| 8 | Trung bình | Các **ô của bảng bị gộp thành một khối**; danh sách đánh số bị gộp | Bỏ "khoảng trắng giả" của pdf.js, nhận diện đường kẻ cột, dòng bắt đầu bằng ký hiệu danh sách là đoạn mới | Khám phá (bảng LibreOffice) |
| 9 | Trung bình | Nối thêm chữ vào cuối một dòng → **xuống hàng đè lên dòng dưới** | Dòng đơn mở rộng theo chiều ngang khi gõ (như dòng gốc) | `02` "saves the edited text" |
| 10 | Trung bình (giao diện) | Icon **phóng to hàng trăm pixel** ở vùng kéo-thả trang chủ và bảng tệp đính kèm | Kích thước mặc định cho icon | Khám phá (ảnh chụp) |
| 11 | Thấp | Thêm/sửa văn bản tạo 2 bước hoàn tác (hoàn tác 1 lần không mất hộp chữ) | Gộp thành 1 bước | `02` "undo and redo a text edit" |
| 12 | Thấp | Bảng thuộc tính không hiện lựa chọn "Theo đoạn/Theo dòng" khi vào chế độ sửa | Cập nhật bảng thuộc tính khi bật chế độ sửa | `02` "line mode…" |
| 13 | Thấp | Ctrl+S / Ctrl+P không hoạt động khi con trỏ ở ô tìm kiếm, số trang, ô thuộc tính | Cho phím tắt Ctrl đi qua, xác nhận giá trị ô trước khi lưu | Khám phá |
| 14 | Thấp | Thông báo (toast) trùng lặp chồng lên nhau | Thay thông báo trùng | Khám phá |
| 15 | Thấp | Nhãn chưa Việt hóa: "watermark", "header & footer" | Nhãn tiếng Việt | Khám phá |
| 16 | Thấp | Con dấu: dòng phụ (ngày) quá to, chạm viền | Bố cục chung cho xem trước và file lưu | `03` |
| 17 | Thấp | Trang chủ: 5 thẻ + 1 thẻ lẻ hàng dưới | 6 thẻ một hàng (3 khi cửa sổ hẹp) | Khám phá |
| 18 | Thấp | Sửa chữ ngay sau khi mở ứng dụng chưa so khớp phông hệ thống | Chờ danh sách phông hệ thống | `02` |
| 19 | Thấp | `session.dirty` trả về `undefined` thay vì `false` | Trả về boolean | `01` |
| 20 | Thấp | Nút "Tô sáng trường" (ẩn nền xanh của ô biểu mẫu) không có tác dụng | Tắt biến nền/bộ lọc của pdf.js | `06` "the field highlight…" |
| 21 | Hạ tầng test | Unit test LibreOffice lỗi khi máy không có LibreOffice (CI) | Bỏ qua có điều kiện | CI |

Ghi chú: khi chạy thử bộ cài dưới Wine, NSIS báo "ứng dụng đang chạy" do PowerShell giả lập của Wine luôn trả mã 0 – đây là giới hạn của Wine, không phải lỗi bộ cài (đã xác nhận bằng cách tắt PowerShell giả lập: cài đặt thành công).

## 3. Kết quả kiểm tra bộ cài Windows

- `PDF-Edit-Setup-1.0.0-x64.exe` (NSIS, x64, ~119 MB), cài theo người dùng hoặc toàn máy, chọn thư mục cài, tiếng Việt/Anh theo ngôn ngữ hệ thống.
- Chặn cài trên Windows cũ hơn Windows 10 (kiểm tra `AtLeastWin10`): đã thử trên Wine giả lập Windows 7 – bộ cài từ chối, không cài tệp nào.
- Cài im lặng thành công (Wine/Windows 10): có `PDF Edit.exe`, lối tắt Desktop và Start Menu, mục gỡ cài đặt trong "Apps & features", đăng ký mở tệp `.pdf`.
- Build trên GitHub Actions `windows-latest` thành công (artifact `PDF-Edit-Setup-x64`).
- Chưa ký số (code signing): Windows SmartScreen có thể hiện cảnh báo "Unknown publisher" lần đầu chạy → chọn "More info" → "Run anyway".

## 4. Hiệu năng (tài liệu 300 trang, có ảnh)

| Thao tác | Thời gian |
|---|---|
| Mở và hiển thị trang đầu | 1,1 s |
| Nhảy tới trang cuối | 0,1 s |
| Mở chế độ sắp xếp 300 trang | 0,3 s |
| Xoay toàn bộ 300 trang | 0,7 s |
| Lưu | 0,5 s |
| Bộ nhớ (renderer) | ~0,5 GB; heap JS ổn định sau 12 lần mở/đóng |

## 5. Hạn chế đã biết

- Sửa một đoạn có nhiều kiểu chữ trong cùng đoạn (vài từ in đậm/nghiêng) sẽ áp một kiểu chung cho cả đoạn.
- Ô bảng không có đường kẻ và đứng sát nhau có thể được nhận là một khối khi sửa.
- Mở file bằng mật khẩu quyền (owner) rồi lưu: bản lưu dùng chính mật khẩu đó làm mật khẩu mở (không khôi phục được mật khẩu người dùng gốc với AES-256).
- Chuyển sang Word giữ văn bản và hình ảnh theo trang, không tái tạo bố cục phức tạp và giá trị trường biểu mẫu.
- Ứng dụng Electron 44 không chạy được dưới Wine nên kiểm thử chức năng thực hiện trên bản Linux cùng mã nguồn; bộ cài Windows được build và cài thử, chưa chạy giao diện trên Windows thật.
