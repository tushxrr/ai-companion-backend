const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Mock authMiddleware before requiring app
jest.mock('../authMiddleware', () => {
    return (req, res, next) => {
        req.user = { uid: 'test-user-id' };
        next();
    };
});

// Mock GoogleGenerativeAI
jest.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: jest.fn().mockImplementation(() => {
            return {
                getGenerativeModel: jest.fn().mockReturnValue({
                    generateContent: jest.fn().mockResolvedValue({
                        response: {
                            text: () => 'Mocked response'
                        }
                    }),
                    generateContentStream: jest.fn().mockResolvedValue({
                        stream: [
                            { text: () => 'Mocked ' },
                            { text: () => 'stream ' },
                            { text: () => 'response' }
                        ]
                    })
                })
            };
        })
    };
});

const app = require('../index');
const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

describe('API Endpoints', () => {
    it('GET / should return health check', async () => {
        const res = await request(app).get('/');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('status', 'healthy');
    });

    it('GET /api/health should return ok', async () => {
        const res = await request(app).get('/api/health');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('ok', true);
    });
});

describe('Authenticated API Endpoints', () => {
    let conversationId;

    it('GET /api/conversations should return empty array initially', async () => {
        const res = await request(app).get('/api/conversations');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toEqual([]);
    });

    it('POST /api/messages should create a new conversation and message', async () => {
        const res = await request(app)
            .post('/api/messages')
            .send({ message: 'Hello AI' });
        
        expect(res.statusCode).toEqual(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        
        // The response is a stream, so we need to parse the chunks
        const chunks = res.text.split('\n\n').filter(Boolean);
        expect(chunks.length).toBeGreaterThan(0);
        
        // The last chunk should contain the conversationId
        const lastChunk = chunks[chunks.length - 1];
        const data = JSON.parse(lastChunk.replace('data: ', ''));
        expect(data).toHaveProperty('conversationId');
        expect(data).toHaveProperty('messageId');
        
        conversationId = data.conversationId;
    });

    it('GET /api/conversations should return the created conversation', async () => {
        const res = await request(app).get('/api/conversations');
        expect(res.statusCode).toEqual(200);
        expect(res.body.length).toEqual(1);
        expect(res.body[0]._id).toEqual(conversationId);
        expect(res.body[0].title).toEqual('Hello AI');
    });

    it('GET /api/conversations/:id should return messages for the conversation', async () => {
        const res = await request(app).get(`/api/conversations/${conversationId}`);
        expect(res.statusCode).toEqual(200);
        expect(res.body.length).toEqual(2); // 1 user message, 1 AI message
        expect(res.body[0].sender).toEqual('user');
        expect(res.body[0].content).toEqual('Hello AI');
        expect(res.body[1].sender).toEqual('ai');
        expect(res.body[1].content).toEqual('Mocked stream response');
    });

    it('PUT /api/conversations/:id should rename the conversation', async () => {
        const res = await request(app)
            .put(`/api/conversations/${conversationId}`)
            .send({ title: 'New Title' });
        
        expect(res.statusCode).toEqual(200);
        expect(res.body.title).toEqual('New Title');
    });

    it('POST /api/summarize should return a summary', async () => {
        const res = await request(app)
            .post('/api/summarize')
            .send({ conversationText: 'User: Hello\nAI: Hi there!' });
        
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('structured');
    });

    it('POST /api/enhance-prompt should return an enhanced prompt', async () => {
        const res = await request(app)
            .post('/api/enhance-prompt')
            .send({ prompt: 'write a poem' });
        
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('enhancedPrompt');
    });

    it('DELETE /api/conversations/:id should delete the conversation', async () => {
        const res = await request(app).delete(`/api/conversations/${conversationId}`);
        expect(res.statusCode).toEqual(200);
        
        const getRes = await request(app).get('/api/conversations');
        expect(getRes.body.length).toEqual(0);
    });
});
