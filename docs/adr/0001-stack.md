# ADR 0001 — Stack khởi đầu

Trạng thái: chấp nhận (06/11/2026)

- Desktop Electron (Windows trước), renderer React + TypeScript, build bằng Vite; main/preload bundle bằng esbuild.
- Lõi `src/core` là TypeScript thuần, không import React/Electron. UI và AI đều sửa mạch qua cùng command/patch API.
- Schematic vẽ bằng SVG (dễ chọn, dễ xuất ảnh).
- Mô phỏng: ngspice CLI chạy batch trong tiến trình con, thư mục tạm riêng, timeout 30 s, đường dẫn tệp do main process cấp.
  Có bộ giải MNA tích hợp làm dự phòng khi chưa cài ngspice; kết quả luôn ghi nguồn.
- AI: adapter đa nhà cung cấp (Anthropic qua SDK chính thức; OpenAI, Gemini, Ollama, OpenAI-compatible qua HTTP streaming).
  Chạy trong main process ở bản desktop để API key không vào renderer. Patch có baseRevision, được kiểm tra trước, áp dụng nguyên tử.
- contextIsolation bật, nodeIntegration tắt, sandbox bật, IPC theo allowlist.
