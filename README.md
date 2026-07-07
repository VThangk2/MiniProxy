# UCX MiniMax Worker Proxy

Cloudflare Worker TypeScript proxy cho UCX/ABP AI Management gọi MiniMax qua OpenAI-compatible API mà không lộ `MINIMAX_API_KEY` cho UCX.

URL workers.dev hiện tại:

```text
https://ucx-ai-proxy.public-thangk2.workers.dev
```

```text
UCX / ABP AI Management
  -> Authorization: Bearer <UCX_PROXY_KEY>
Cloudflare Worker /v1
  -> Authorization: Bearer <MINIMAX_API_KEY>
MiniMax OpenAI-compatible API
```

## Tính năng

- `GET /health`
- `GET /v1/models` và fallback `GET /models`
- `POST /v1/chat/completions` và fallback `POST /chat/completions`
- `OPTIONS` CORS preflight
- Auth bằng `UCX_PROXY_KEY`
- MiniMax key chỉ đọc từ Cloudflare Secret `MINIMAX_API_KEY`
- Durable Object `RateLimiter` giới hạn theo phút và ngày
- Validate JSON, model, messages, input size, temperature, `max_tokens`
- Clamp `max_tokens` xuống `MAX_TOKENS_LIMIT`
- Streaming SSE pass-through khi `stream=true`
- Timeout upstream theo `UPSTREAM_TIMEOUT_MS`
- Logging có kiểm soát, không log full secret hoặc full body mặc định

## Cài đặt

Yêu cầu Node.js `>=22.0.0` cho Wrangler hiện tại.

```bash
npm install
```

## Login Cloudflare

```bash
npx wrangler login
```

## Chạy local

Tạo file `.dev.vars` local từ mẫu, sau đó điền key thật. Không commit file này.

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev
```

PowerShell:

```powershell
Copy-Item .dev.vars.example .dev.vars
npx wrangler dev
```

## Set Secret Trên Cloudflare

```bash
npx wrangler secret put MINIMAX_API_KEY
npx wrangler secret put UCX_PROXY_KEY
```

Không hardcode secret trong source. Không nhập `MINIMAX_API_KEY` vào UCX/ABP.

## Deploy

```bash
npx wrangler deploy
```

## Xem Log

```bash
npx wrangler tail
```

Log mặc định gồm `requestId`, `time`, `path`, `method`, IP đã mask, model, stream, status, latency, upstream status, error code và usage nếu response non-stream có usage.

Không bật `LOG_REQUEST_BODY=true` với dữ liệu khách hàng thật. Khi bật debug, Worker chỉ log preview rút gọn, không log toàn bộ nội dung hội thoại.

## Rotate Key

Rotate MiniMax key:

```bash
npx wrangler secret put MINIMAX_API_KEY
```

Rotate UCX proxy key:

```bash
npx wrangler secret put UCX_PROXY_KEY
```

Nếu đổi `UCX_PROXY_KEY`, cập nhật lại API Key trong UCX/ABP AI Management.

## Biến Cấu Hình

Các biến nằm trong `wrangler.jsonc`:

```text
MINIMAX_BASE_URL=https://api.minimax.io/v1
RATE_LIMIT_PER_MINUTE=30
DAILY_REQUEST_LIMIT=500
MAX_INPUT_CHARS=10000
MAX_TOKENS_LIMIT=2048
ALLOWED_MODELS=MiniMax-M2.7
UPSTREAM_TIMEOUT_MS=60000
LOG_LEVEL=info
LOG_REQUEST_BODY=false
CORS_ORIGIN=*
UCX_ALLOWED_IPS=
```

Nếu `UCX_ALLOWED_IPS` rỗng, Worker bỏ qua kiểm tra IP. Nếu có giá trị như `1.2.3.4,5.6.7.8`, Worker kiểm tra `CF-Connecting-IP`.

## Curl Test

Đặt biến trước khi test:

```bash
export WORKER_URL="https://ucx-ai-proxy.public-thangk2.workers.dev"
export UCX_PROXY_KEY="<UCX_PROXY_KEY>"
```

PowerShell:

```powershell
$env:WORKER_URL="https://ucx-ai-proxy.public-thangk2.workers.dev"
$env:UCX_PROXY_KEY="<UCX_PROXY_KEY>"
```

### Health

```bash
curl "$WORKER_URL/health"
```

Kỳ vọng:

```json
{
  "status": "ok",
  "service": "ucx-minimax-proxy",
  "time": "..."
}
```

### Models

```bash
curl "$WORKER_URL/v1/models" \
  -H "Authorization: Bearer $UCX_PROXY_KEY"
```

### Unauthorized

```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [
      {
        "role": "user",
        "content": "Xin chao"
      }
    ]
  }'
```

Kỳ vọng trả `401`.

### Authorized Non-Stream

```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Authorization: Bearer $UCX_PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [
      {
        "role": "user",
        "content": "Xin chao, tra loi ngan gon bang tieng Viet"
      }
    ],
    "temperature": 0.3,
    "max_tokens": 512,
    "stream": false
  }'
```

### Streaming

```bash
curl -N -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Authorization: Bearer $UCX_PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M2.7",
    "messages": [
      {
        "role": "user",
        "content": "Viet 5 gach dau dong ve loi ich cua agent assistant"
      }
    ],
    "temperature": 0.3,
    "max_tokens": 512,
    "stream": true
  }'
```

Khuyến nghị test UCX với `stream=false` trước. Sau khi non-stream ổn định, mới bật streaming và xác nhận UCX/ABP đọc SSE đúng như kỳ vọng.

### Sai Model

```bash
curl -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Authorization: Bearer $UCX_PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "invalid-model",
    "messages": [
      {
        "role": "user",
        "content": "Xin chao"
      }
    ]
  }'
```

Kỳ vọng trả `403`:

```json
{
  "error": {
    "message": "Forbidden model",
    "type": "forbidden_error",
    "code": "forbidden_model"
  }
}
```

### Rate Limit

Tạm giảm `RATE_LIMIT_PER_MINUTE` trong `wrangler.jsonc` xuống `3`, deploy lại, rồi chạy:

```bash
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$WORKER_URL/v1/chat/completions" \
    -H "Authorization: Bearer $UCX_PROXY_KEY" \
    -H "Content-Type: application/json" \
    --data @test/sample-chat-request.json
done
```

Kỳ vọng request vượt ngưỡng trả `429`:

```json
{
  "error": {
    "message": "Rate limit exceeded",
    "type": "rate_limit_error",
    "code": "rate_limit_exceeded"
  }
}
```

## Cấu Hình UCX/ABP AI Management

```text
Provider type: OpenAI-compatible
Base URL: https://ucx-ai-proxy.public-thangk2.workers.dev/v1
API Key: <UCX_PROXY_KEY>
Model: MiniMax-M2.7
Temperature: 0.3
Max tokens: 512 hoặc 1024
Streaming: Off trước để test, On sau khi xác nhận UCX hỗ trợ
```

Lưu ý:

```text
Không nhập MINIMAX_API_KEY vào UCX/ABP.
Chỉ nhập UCX_PROXY_KEY.
Base URL phải là https://ucx-ai-proxy.public-thangk2.workers.dev/v1.
Không nhập full path /v1/chat/completions.
```

## Error Format

Worker trả lỗi gần OpenAI-compatible:

```json
{
  "error": {
    "message": "...",
    "type": "...",
    "code": "..."
  }
}
```

Các lỗi chính: `invalid_json`, `invalid_request`, `unauthorized`, `forbidden_model`, `forbidden_ip`, `not_found`, `method_not_allowed`, `input_too_large`, `rate_limit_exceeded`, `upstream_error`, `upstream_timeout`, `internal_error`.

## Bảo Mật

- Không hardcode secret.
- Không commit `.dev.vars`.
- Không log full `Authorization`.
- Không log full request body mặc định.
- Có thể rotate `UCX_PROXY_KEY` và `MINIMAX_API_KEY`.
- Có IP allowlist bằng `UCX_ALLOWED_IPS`.
- Có rate limit theo phút/ngày bằng Durable Objects.
- Có `MAX_INPUT_CHARS` và `MAX_TOKENS_LIMIT`.

## Giới Hạn Và Ghi Chú Cloudflare

- Durable Objects có thể phát sinh chi phí theo usage/storage tùy plan. Kiểm tra quota và billing Cloudflare trước khi dùng production.
- Project dùng SQLite-backed Durable Objects với `new_sqlite_classes`.
- Rate limit hiện đếm request đã authenticate. Request bị `429` vẫn được tính là attempt để giảm abuse.
- Streaming pass-through phụ thuộc MiniMax endpoint trả SSE đúng chuẩn và UCX/ABP client đọc SSE ổn định.

## Checklist Nghiệm Thu

```text
[ ] UCX/ABP không nhìn thấy MiniMax key
[ ] Authorization UCX_PROXY_KEY hoạt động
[ ] /health OK
[ ] /v1/models OK
[ ] /v1/chat/completions non-stream OK
[ ] /v1/chat/completions stream pass-through OK hoặc có ghi rõ cần test thêm
[ ] Sai key trả 401
[ ] Sai model trả 400/403
[ ] Request quá lớn trả 413
[ ] Vượt rate limit trả 429
[ ] Upstream MiniMax lỗi được trả rõ ràng
[ ] Timeout trả 504
[ ] Không log secret
[ ] Không hardcode secret
[ ] README đủ lệnh deploy
[ ] README đủ hướng dẫn cấu hình UCX/ABP
[ ] Base URL đúng là https://<worker-domain>/v1
```
