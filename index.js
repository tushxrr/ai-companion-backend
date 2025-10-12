// index.js - FINAL ROBUST VERSION

// --- IMPORTS ---
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const Conversation = require('./models/conversation.model.js');
const Message = require('./models/message.model.js');
const authMiddleware = require('./authMiddleware'); // Import the new middleware

// --- INITIAL SETUP ---
const app = express();
const PORT = 3001;

// --- MIDDLEWARE ---
const allowedOrigins = [
    'http://localhost:5173',
    'https://ai-companion-self.vercel.app'
];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Handle preflight requests across all routes
app.options('*', cors(corsOptions));

app.use(express.json());

// --- DATABASE CONNECTION ---
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("FATAL ERROR: MONGO_URI is not defined in your .env file.");
    process.exit(1); // Exit the application if the database string is missing
}
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB connected successfully!"))
    .catch(err => {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    });

// --- GEMINI API SETUP ---
let genAI = null;
let model;
const modelName = 'gemini-flash-latest'; // Use a stable, compatible model

if (process.env.GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        model = genAI.getGenerativeModel({ model: modelName });
        console.log(`✅ Gemini AI model initialized successfully. model=${modelName}`);
    } catch (error) {
        console.error("❌ ERROR initializing Gemini AI. Your API key may be invalid.", error.message);
    }
} else {
    console.error("❌ FATAL ERROR: GEMINI_API_KEY is not defined in your .env file.");
}

// --- HELPERS ---
/**
 * Safely extract text from a Gemini response object.
 */
function safeGeminiText(result) {
    try {
        if (!result) return '';
        if (result.response && typeof result.response.text === 'function') {
            return String(result.response.text() || '').trim();
        }
        // Some SDK versions return { response: { candidates: [...] } }
        if (result.response && Array.isArray(result.response.candidates)) {
            const cand = result.response.candidates.find(c => c.content && Array.isArray(c.content.parts));
            if (cand) {
                return cand.content.parts.map(p => p.text || '').join('').trim();
            }
        }
    } catch (err) {
        console.error('safeGeminiText extraction error:', err);
    }
    return '';
}

/**
 * Light normalization of an enhanced prompt (remove wrapping quotes or leading filler).
 */
function normalizeEnhancedPrompt(text) {
    if (!text) return '';
    let cleaned = text.trim();
    // Remove starting phrases Gemini often adds
    cleaned = cleaned.replace(/^sure[,!\s-]*here(?:'s| is) (?:an |the )?improved prompt:?\s*/i, '');
    // Strip enclosing quotes/backticks if the whole thing is wrapped
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
        cleaned = cleaned.replace(/^```[a-zA-Z0-9]*\n?/, '').replace(/```$/, '').trim();
    }
    return cleaned;
}


// ==========================================================
// --- API ROUTES ---
// ==========================================================

// Root route - Health check
app.get('/', (req, res) => {
    res.json({
        message: 'AI Companion Backend API is running!',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

// Quick AI health check (dev tool): verifies the Gemini API key by making a tiny call.
// Note: keep lightweight; you can remove or protect this in production.
app.get('/api/ai-check', async (req, res) => {
    const start = Date.now();
    if (!model) {
        return res.status(500).json({ ok: false, reason: 'model_not_initialized', hint: 'Check GEMINI_API_KEY in .env' });
    }
    try {
        const result = await model.generateContent('Return the word PONG.');
        const text = safeGeminiText(result);
        const ok = typeof text === 'string' && /pong/i.test(text);
        return res.json({
            ok,
            ms: Date.now() - start,
            sample: (text || '').slice(0, 120),
            model: 'gemini-1.5-flash'
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Protect API routes with Firebase auth middleware
app.use('/api/conversations', authMiddleware);
app.use('/api/messages', authMiddleware);
app.use('/api/summarize', authMiddleware);
app.use('/api/enhance-prompt', authMiddleware);


// GET /api/conversations
app.get('/api/conversations', async (req, res) => {
    try {
    const userId = req.user.uid; // verified user id from auth middleware
        const conversations = await Conversation.find({ user_id: userId }).sort({ updatedAt: -1 });
        res.json(conversations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/conversations/:id
app.get('/api/conversations/:id', async (req, res) => {
    try {
        const conversationId = req.params.id;
        // Ensure the requested conversation belongs to the authenticated user
        const convo = await Conversation.findOne({ _id: conversationId, user_id: req.user.uid });
        if (!convo) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        const messages = await Message.find({ conversation_id: conversationId }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/messages
// NOTE: The non-streaming /api/messages route has been removed & replaced by the streaming version below

// DELETE /api/conversations/:id
app.delete('/api/conversations/:id', async (req, res) => {
    try {
        const conversationId = req.params.id;
        // Verify ownership before delete
        const convo = await Conversation.findOne({ _id: conversationId, user_id: req.user.uid });
        if (!convo) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        await Message.deleteMany({ conversation_id: conversationId });
        await Conversation.findByIdAndDelete(conversationId);
        res.status(200).json({ message: 'Conversation deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/summarize
app.post('/api/summarize', async (req, res) => {
    if (!model) {
        return res.status(500).json({ error: "AI model not initialized. Check server logs for API Key issues." });
    }

    try {
        let { conversationText, mode } = req.body || {};
        if (!conversationText) {
            return res.status(400).json({ error: 'No conversation text provided.' });
        }

        // Trim excessive length (protect tokens). Keep last 18k chars.
        const TRUNCATION_LIMIT = 18000;
        let truncated = false;
        if (conversationText.length > TRUNCATION_LIMIT) {
            conversationText = conversationText.slice(-TRUNCATION_LIMIT);
            truncated = true;
        }

        // Mode selection (future extensibility)
        const summaryMode = (mode || 'structured').toLowerCase();
        // Base structured prompt (Option A+ with sentiment & topics)
        const structuredPrompt = `You are an AI assistant that produces a concise, high-signal structured summary of a multi-turn chat between a User and an Assistant.
OUTPUT REQUIREMENTS:
- Output ONLY valid JSON (no Markdown) following this exact schema:
{
  "summary": ["short bullet", ...],
  "key_points": ["bullet", ...],
  "action_items": ["bullet", ...],
  "open_questions": ["bullet", ...],
  "sentiment": "short tone phrase",
  "topics": ["topic", ...],
  "short_mode": false
}
- Omit empty bullets (use [] for empty arrays). Use lowercase topics (2-6 unique, concise nouns).
- Each bullet <= 18 words, no numbering, no quotes inside strings unless part of original text.
- Do NOT hallucinate. Derive only from the conversation content provided.
- "action_items" only if explicit or strongly implied tasks/goals.
- "open_questions" only for unresolved user questions.
- If total turns < 3 set: summary = [single bullet capturing core intent], other arrays empty, short_mode=true.
- Ensure output is strictly JSON with double quotes and valid escaping.

Conversation:
"""
${conversationText}
"""`;

        // Additional modes (can extend later)
        const prompt = structuredPrompt; // currently only one effective mode

        const result = await model.generateContent(prompt);
        const raw = safeGeminiText(result) || '';

        // Try to extract JSON (some models may wrap with markdown fences)
        let jsonText = raw.trim();
        jsonText = jsonText.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch(parseErr) {
            console.warn('Summarize JSON parse failed, falling back to plaintext:', parseErr.message);
        }

        // Fallback if parsing failed or mandatory fields missing
        const ensureArray = v => Array.isArray(v) ? v : [];
        if (!parsed || !parsed.summary) {
            parsed = {
                summary: raw ? raw.split(/\n+/).slice(0,5).map(l=>l.trim()).filter(Boolean) : [],
                key_points: [],
                action_items: [],
                open_questions: [],
                sentiment: '',
                topics: [],
                short_mode: false,
                fallback: true
            };
        } else {
            parsed.summary = ensureArray(parsed.summary);
            parsed.key_points = ensureArray(parsed.key_points);
            parsed.action_items = ensureArray(parsed.action_items);
            parsed.open_questions = ensureArray(parsed.open_questions);
            parsed.topics = ensureArray(parsed.topics);
            parsed.short_mode = !!parsed.short_mode;
        }

        return res.json({
            structured: parsed,
            summary: parsed.summary && Array.isArray(parsed.summary) ? parsed.summary.join('\n') : '', // legacy field
            truncated,
            raw
        });
    } catch (error) {
        console.error("Gemini Summarization Error:", error);
        res.status(500).json({ error: "Failed to create summary." });
    }
});

// POST /api/enhance-prompt - Enhance a user's prompt using a meta-prompt
app.post('/api/enhance-prompt', async (req, res) => {
    if (!model) {
        return res.status(500).json({ error: "AI model not initialized. Check server logs for API Key issues." });
    }

    try {
        const requestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        const { prompt } = req.body || {};
        const rawPrompt = (prompt || '').toString();
        if (!rawPrompt.trim()) {
            return res.status(400).json({ error: 'No prompt provided.' });
        }
        if (rawPrompt.length > 4000) {
            return res.status(413).json({ error: 'Prompt too long (limit 4000 chars).' });
        }

        const metaPrompt = `You are an expert prompt engineer. Rewrite ONLY the user's text into a higher quality, specific prompt for a large language model.
Rules:
- Preserve intent, do not add external facts.
- Add clarifying constraints (audience, format, style) if helpful.
- Prefer bullet points for multi-part tasks.
- Make the output self-contained and unambiguous.
- Output ONLY the improved prompt (no commentary, no quotes).

User text begins:
<<<
${rawPrompt}
>>>
Improved prompt:`;

        const result = await model.generateContent(metaPrompt);
        const enhancedRaw = safeGeminiText(result);
        const enhancedPrompt = normalizeEnhancedPrompt(enhancedRaw);

        if (!enhancedPrompt) {
            console.warn(`[enhance-prompt][${requestId}] Empty enhancement result.`);
            return res.status(502).json({ error: 'AI returned an empty result.' });
        }

        console.log(`[enhance-prompt][${requestId}] OK length=${enhancedPrompt.length}`);
        return res.json({ enhancedPrompt, requestId });
    } catch (error) {
        console.error('Enhance prompt error:', error);
        return res.status(500).json({ error: 'Failed to enhance prompt.', details: error.message });
    }
});

// PUT /api/conversations/:id - Handle renaming a conversation
app.put('/api/conversations/:id', async (req, res) => {
    try {
        const { title } = req.body; // Get the new title from the request body
        const conversationId = req.params.id;

        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        // Find the conversation by its ID and user, then update its title
        const updatedConversation = await Conversation.findOneAndUpdate(
            { _id: conversationId, user_id: req.user.uid },
            { title: title },
            { new: true }
        );

        if (!updatedConversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        res.json(updatedConversation); // Send the updated conversation back to the frontend
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/conversations/:id/generate-title - Automatically generate a title
app.post('/api/conversations/:id/generate-title', async (req, res) => {
    // Check if the AI model is available
    if (!model) {
        return res.status(500).json({ error: "AI model not initialized." });
    }

    try {
        const conversationId = req.params.id;

        // Ensure the conversation belongs to the user
        const convo = await Conversation.findOne({ _id: conversationId, user_id: req.user.uid });
        if (!convo) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        // Fetch the first 2 messages of the conversation for context
        const messages = await Message.find({ conversation_id: conversationId }).sort({ createdAt: 'asc' }).limit(2);

        if (messages.length < 2) {
            return res.status(400).json({ error: "Not enough messages to generate a title." });
        }

        // Create a prompt for the AI
        const conversationText = messages.map(m => `${m.sender}: ${m.content}`).join('\n');
        const prompt = `Summarize the following conversation with a short, 3-5 word title. Do not use quotes. The conversation is:\n\n${conversationText}`;

        // Call the Gemini API to generate the title
        const result = await model.generateContent(prompt);
        const newTitle = result.response.text().trim();

        // Update the conversation in the database with the new title
        const updatedConversation = await Conversation.findByIdAndUpdate(
            conversationId,
            { title: newTitle },
            { new: true }
        );

        res.json(updatedConversation); // Send the updated conversation back
    } catch (error) {
        console.error("Failed to generate title:", error);
        res.status(500).json({ error: "Failed to generate title." });
    }
});

app.post('/api/messages', async (req, res) => {
    if (!model) {
        return res.status(500).json({ error: "AI model not initialized. Check server logs for API Key issues." });
    }

    let { conversation_id, message } = req.body;
    const userId = req.user.uid; // Use verified user id

    try {
        if (!conversation_id) {
            const newConversation = new Conversation({ user_id: userId, title: message.substring(0, 40) });
            const savedConversation = await newConversation.save();
            conversation_id = savedConversation._id;
        }

        // Persist user message first so history includes it
        const userMessage = new Message({ conversation_id, sender: 'user', content: message });
        await userMessage.save();

        // Optional security: ensure the conversation we append to belongs to this user
        const convo = await Conversation.findOne({ _id: conversation_id, user_id: userId });
        if (!convo) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        // Build recent history (include last 12 messages for more context)
        const history = await Message.find({ conversation_id }).sort({ createdAt: -1 }).limit(12);
        const ordered = history.reverse();
        const historyLines = ordered.map(msg => `${msg.sender === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
        // Construct a single prompt with conversation context + instruction
        const fullPrompt = `${historyLines.join('\n')}\nAssistant:`;

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders && res.flushHeaders();

        let fullResponse = '';
        try {
            const result = await model.generateContentStream(fullPrompt);
            for await (const chunk of result.stream) {
                const token = chunk.text();
                if (!token) continue;
                fullResponse += token;
                res.write(`data: ${JSON.stringify({ text: token })}\n\n`);
            }
        } catch(streamErr) {
            console.error('Streaming error:', streamErr);
            res.write(`data: ${JSON.stringify({ error: 'gemini_api_error', details: streamErr.message })}\n\n`);
            return res.end();
        }

        // Save assistant message AFTER full stream
        const aiMessage = new Message({ conversation_id, sender: 'ai', content: fullResponse });
        await aiMessage.save();
        await Conversation.findByIdAndUpdate(conversation_id, { updatedAt: Date.now() });

    // Final metadata event
        res.write(`data: ${JSON.stringify({ conversationId: conversation_id, messageId: aiMessage._id })}\n\n`);
        res.end();

    } catch (error) {
        console.error("Gemini API Stream Error:", error);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.end();
    }
});


// --- START THE SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
