## AI Companion Backend (Express + MongoDB + Gemini)

Robust Node.js backend powering the AI Companion chat experience: secure Firebase-authenticated conversations, streaming AI responses (SSE) with Google Gemini, prompt enhancement, summarization, and automatic conversation titling.

### ✨ Feature Summary
- Firebase ID token authentication middleware (`authMiddleware.js`)
- Conversation & Message persistence (MongoDB + Mongoose)
- Server‑Sent Events streaming endpoint for chat (`POST /api/messages`)
- Prompt enhancement endpoint (`POST /api/enhance-prompt`) with meta‑prompt + normalization
- AI summarization (`POST /api/summarize`)
- Automatic short title generation (`POST /api/conversations/:id/generate-title`)
- CRUD: list / fetch / rename / delete conversations
- Defensive CORS + explicit preflight handling
- Graceful Gemini model initialization + fallback errors when API key missing
- Input validation (length checks, required fields) + structured error responses

### 📁 Structure
```
ai-companion-backend/
├── index.js                 # Express server & routes
├── authMiddleware.js        # Firebase token verification
├── models/
│   ├── conversation.model.js
│   └── message.model.js
├── package.json
└── README.md
```

### 🧩 Data Models
Conversation:
```js
{ _id, user_id: String, title: String, createdAt, updatedAt }
```
Message:
```js
{ _id, conversation_id: ObjectId, sender: 'user'|'ai', content: String, createdAt, updatedAt }
```

### 🔐 Authentication
All `/api/*` routes (except `/` and `/api/health`) require a valid Firebase ID token in `Authorization: Bearer <token>`.

### 🔌 Endpoints
Health:
```
GET /            -> { message, status, timestamp, version }
GET /api/health  -> { ok, ts }
```

Conversations:
```
GET    /api/conversations                 # List (user scoped)
GET    /api/conversations/:id             # Messages for conversation
PUT    /api/conversations/:id             # Rename { title }
DELETE /api/conversations/:id             # Delete convo + messages
POST   /api/conversations/:id/generate-title # Auto 3–5 word title
```

Chat (Streaming):
```
POST /api/messages
Body: { message: string, conversation_id?: string }
Stream: data: { "text": "<token>" }
Final event: data: { "conversationId": "..", "messageId": ".." }
```

Summarization:
```
POST /api/summarize
Body: { conversationText }
Resp: { summary }
```

Prompt Enhancement:
```
POST /api/enhance-prompt
Body: { prompt }
Resp: { enhancedPrompt, requestId }
Validation: 1–4000 chars
```

### 🧠 Gemini Usage
- Standard generation for enhance / summarize / title
- `generateContentStream` for incremental chat tokens
- `safeGeminiText()` helper extracts text across SDK shapes
- `normalizeEnhancedPrompt()` removes boilerplate / wrapping quotes

### ⚙️ Environment Variables (.env)
```
GEMINI_API_KEY=your_gemini_key
MONGO_URI=mongodb+srv://...
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
Only `GEMINI_API_KEY` & `MONGO_URI` are strictly required for core functionality; Firebase creds required for auth.

### 🚀 Run Locally
```bash
npm install
npm start  # or: node index.js
# Server: http://localhost:3001
```

### 🔄 Streaming Contract (Frontend Expectations)
1. Client posts user message
2. SSE stream emits `text` tokens
3. Final event includes persisted `conversationId` & `messageId`
4. Client replaces temporary AI placeholder with final object

### 🛡️ Error Handling Patterns
| Case | Response |
|------|----------|
| Missing Gemini key | 500 { error: "AI model not initialized" } |
| Missing prompt (enhance) | 400 { error: 'No prompt provided.' } |
| Oversized prompt | 413 { error: 'Prompt too long...' } |
| Not found conversation | 404 { error: 'Conversation not found' } |

### ✅ Implemented Safeguards
- Strict user scoping on conversation/message access
- Prompt length caps
- Graceful stream error injection (`{ error: 'stream_failed' }` token)
- Defensive extraction of Gemini responses

### 🧪 (Planned / Missing) Test Coverage
Currently absent (recommended Jest + supertest):
- Auth middleware (valid/invalid/expired token)
- Streaming endpoint (token sequence & final event)
- Prompt enhancement normalization cases
- Title generation fallback when insufficient messages

### 🧱 Roadmap / Gaps
- Rate limiting (per user & global) → mitigate abuse
- Structured logging (pino/winston) with log levels
- Input sanitization on store (currently frontend only)
- Security headers (helmet)
- Request tracing / correlation IDs
- Retry / backoff for transient Mongo errors
- Comprehensive unit + integration tests
- CI pipeline & lint/test gates
- Optional: switch to `text/event-stream` `id:` fields for resume

### 📜 License
MIT (see root project license if present)

### 🙌 Contributions
PRs welcome for testing, security hardening, and performance instrumentation.
