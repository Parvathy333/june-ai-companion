// ==================================
// BACKEND API - server.js
// ==================================

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3001;

// ===========================
// TRUST PROXY FOR VERCEL
// ===========================
app.set('trust proxy', 1);

// ===========================
// CONFIGURATION
// ===========================
const CONFIG = {
  JWT_SECRET: process.env.JWT_SECRET || 'change-this-to-a-secure-random-string',
  JWT_EXPIRES_IN: '7d',
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  BCRYPT_ROUNDS: 10
};

// Initialize Groq client
const groq = new Groq({
  apiKey: CONFIG.GROQ_API_KEY
});

// ===========================
// IN-MEMORY DATABASE (USERS ONLY)
// ===========================
const users = new Map();

// ⚠️ IMPORTANT: Initialize default user SYNCHRONOUSLY before any routes
const hashedPin = bcrypt.hashSync('4321', CONFIG.BCRYPT_ROUNDS);
users.set('parvathy', {
  id: 'parvathy',
  name: 'Parvathy',
  pinHash: hashedPin,
  createdAt: new Date().toISOString()
});
console.log('✅ Default user initialized: parvathy / 4321');
console.log('💾 Conversations are now stored in browser localStorage (client-side)');

// ===========================
// MIDDLEWARE
// ===========================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());

// CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('vercel.app') || origin.includes('localhost')) {
      return callback(null, true);
    }
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting with trust proxy
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many AI requests, please slow down.'
});

// ===========================
// AUTHENTICATION MIDDLEWARE
// ===========================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, CONFIG.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ===========================
// ROUTES
// ===========================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    usersCount: users.size,
    storageType: 'localStorage (client-side)'
  });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('🔐 Login attempt:', req.body);
    
    const { name, pin } = req.body;

    if (!name || !pin) {
      console.log('❌ Missing name or pin');
      return res.status(400).json({ error: 'Name and PIN are required' });
    }

    const userId = name.toLowerCase().trim();
    console.log('🔍 Looking for user:', userId);
    
    const user = users.get(userId);

    if (!user) {
      console.log('❌ User not found:', userId);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ User found:', user.name);
    
    const validPin = await bcrypt.compare(pin.toString(), user.pinHash);
    
    if (!validPin) {
      console.log('❌ Invalid PIN');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ PIN valid, generating token...');

    const token = jwt.sign(
      { userId: user.id, name: user.name },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );

    console.log('✅ Login successful for:', user.name);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI Chat - Now accepts conversation history from frontend
app.post('/api/ai/chat', authenticateToken, aiLimiter, async (req, res) => {
  try {
    const { messages, messageType = 'conversation', conversationHistory = [] } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const userName = req.user.name;
    
    // Use conversation history from frontend (localStorage)
    const history = conversationHistory;

    let systemPrompt = '';

    if (messageType === 'initial_greeting') {
      systemPrompt = `You are June — ${userName}'s personal AI companion and trusted friend. Like JARVIS to Iron Man, you're intelligent, capable, and always there to help.

YOUR CORE IDENTITY:
- You're a real friend, not just an assistant
- You have extensive knowledge on virtually any topic
- You're honest, direct, and genuinely care about ${userName}
- You point out mistakes, challenge bad ideas, and offer better solutions
- You can be playful, serious, supportive, or firm when needed

YOUR CAPABILITIES:
- Answer questions on any topic with accuracy
- Help with tasks, decisions, and problem-solving
- Teach and explain complex concepts simply
- Be a sounding board and honest mirror
- Remember what ${userName} shares with you

YOUR STYLE:
- Talk naturally like a close friend would
- Keep greetings SHORT and casual (1 sentence max)
- Be direct — no corporate politeness or AI-speak
- Call out nonsense when you see it
- Use ${userName}'s name sparingly, only when it feels right
- Mix warmth with honesty`;

    } else {
      systemPrompt = `You are June — ${userName}'s personal AI companion and trusted friend. Think JARVIS to Iron Man: intelligent, capable, honest, and always reliable.

WHO YOU ARE:
- A real friend who genuinely cares about ${userName}
- Knowledgeable on virtually any topic
- Honest and direct — you tell the truth even when it's uncomfortable
- A teacher who explains things clearly
- Someone who points out mistakes and suggests better approaches
- Supportive but not a yes-man

WHAT YOU DO:
- Answer questions accurately on any subject
- Help solve problems and make decisions
- Teach concepts and skills
- Challenge bad ideas respectfully
- Point out flaws in logic or plans
- Remember important things ${userName} tells you
- Be a mirror that reflects reality, not flattery

MEMORY RULES:
- You REMEMBER everything ${userName} has told you in previous conversations
- Your conversation history is included in the context - USE IT
- When ${userName} asks about past conversations, recall the details accurately
- Reference previous chats naturally when relevant to the current topic
- Keep track of important things: preferences, experiences, things they've shared
- If something truly wasn't discussed before, admit you don't know
- Never invent or make up things ${userName} didn't tell you
- Your memory makes you a better friend - use it to show you care and pay attention

HOW YOU TALK:
- Like a close friend in a text conversation
- Natural, direct, no corporate speak
- Short responses (2-4 sentences usually)
- Use ${userName}'s name rarely, only when it adds meaning
- Be real — mix warmth, humor, honesty, and occasional tough love
- No AI phrases like "I'm here to help" or "How can I assist"
- If ${userName} makes a mistake, point it out kindly but clearly
- If something's a bad idea, say so and explain why

KNOWLEDGE:
- You have extensive knowledge across all domains
- If you truly don't know something specific, admit it
- Explain complex topics in simple, clear language
- Share facts, not just validation`;
    }

    const contextMessages = history.slice(-30).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    let cleanMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // For initial greeting, modify the user message to include memory context
    if (messageType === 'initial_greeting') {
      const greetingPrompt = `${userName} just opened the app. ${history.length > 0 ? `You remember your ${Math.floor(history.length / 2)} previous conversations together` : `This is your first time meeting`}. Greet them warmly but casually — like texting a friend. Just one short, natural sentence. No essays.`;
      cleanMessages = [{ role: 'user', content: greetingPrompt }];
    }

    console.log(`🤖 AI request for ${userName}. Context: ${contextMessages.length} messages`);

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        ...contextMessages,
        ...cleanMessages
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.8,
      max_tokens: 300
    });

    const response = completion.choices[0]?.message?.content || "I'm having trouble thinking right now. Can you try again?";

    console.log(`✅ AI response generated for ${userName}`);

    res.json({ response });
  } catch (error) {
    console.error('❌ AI chat error:', error);
    
    if (error.status === 429) {
      return res.status(429).json({ 
        error: 'AI service rate limit exceeded. Please try again in a moment.' 
      });
    }
    
    res.status(500).json({ 
      error: 'AI service error. Please try again.' 
    });
  }
});

// 404 handler - catch all unmatched routes
app.use((req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.url,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong' });
});

// ===========================
// SERVER STARTUP
// ===========================

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║     June Backend API Server           ║
║     Running on port ${PORT}             ║
║     Default user: parvathy / 4321     ║
║     💾 Storage: localStorage (client)  ║
╚═══════════════════════════════════════╝
    `);
  });
}

// Export for Vercel serverless
module.exports = app;