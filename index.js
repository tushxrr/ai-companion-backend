// index.js - FINAL ROBUST VERSION

// --- IMPORTS ---
const express = require('express');
const mongoose = require('mongoose');
const cors =require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const Conversation = require('./models/conversation.model.js');
const Message = require('./models/message.model.js');
const authMiddleware = require('./authMiddleware'); // Import the new middleware

// --- INITIAL SETUP ---
const app = express();
const PORT = 3001;

// --- MIDDLEWARE ---
app.use(cors());
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
// **THIS SECTION IS NOW MORE ROBUST**
let model;
if (process.env.GEMINI_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
        console.log("✅ Gemini AI model initialized successfully.");
    } catch (error) {
        console.error("❌ ERROR initializing Gemini AI. Your API key may be invalid.", error.message);
    }
} else {
    console.error("❌ FATAL ERROR: GEMINI_API_KEY is not defined in your .env file.");
    // We don't initialize the model if the key is missing.
    // The routes below will handle this case.
}


// ==========================================================
// --- API ROUTES ---
// ==========================================================
// Protect API routes with Firebase auth middleware
app.use('/api/conversations', authMiddleware);
app.use('/api/messages', authMiddleware);
app.use('/api/summarize', authMiddleware);

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
        const { conversationText } = req.body;
        if (!conversationText) {
            return res.status(400).json({ error: 'No conversation text provided.' });
        }

        const prompt = `Please provide a concise, one-paragraph summary of the following conversation:\n\n${conversationText}`;
        const result = await model.generateContent(prompt);
        const summaryResponse = result.response.text();
        res.json({ summary: summaryResponse });

    } catch (error) {
        console.error("Gemini Summarization Error:", error);
        res.status(500).json({ error: "Failed to create summary." });
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
            res.write(`data: ${JSON.stringify({ error: 'stream_failed' })}\n\n`);
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
