process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled Rejection:', err);
});

import express from 'express';
import axios from 'axios';
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Serve static files - FIXED for Vercel
app.use(express.static(join(__dirname, 'public'), {
  index: false, // Don't serve index.html automatically
  extensions: ['html', 'htm'] // Only serve these extensions
}));

// Session middleware - Optimized for Vercel
app.use(session({
  secret: process.env.SESSION_SECRET || 'elaina-ai-secret-key-change-in-production-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true
  }
}));

// MongoDB Connection
let db;
let client;
const MONGODB_URI = process.env.MONGODB_URI;

async function connectDB() {
  try {
    if (!MONGODB_URI) {
      console.error('❌ MONGODB_URI environment variable is required');
      return;
    }

    client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    await client.connect();
    db = client.db('elaina_ai');
    console.log('✅ Connected to MongoDB');
    
    // Create indexes
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    await db.collection('chat_sessions').createIndex({ userId: 1 });
    await db.collection('chat_sessions').createIndex({ lastActivity: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
    
    // Initialize developer account
    await initializeDeveloperAccount();
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
  }
}

async function initializeDeveloperAccount() {
  try {
    const developerUsername = process.env.DEVELOPER_USERNAME;
    const developerPassword = process.env.DEVELOPER_PASSWORD;
    
    if (!developerUsername || !developerPassword) {
      console.log('⚠️ Developer credentials not set in environment variables');
      return;
    }
    
    const existingDeveloper = await db.collection('users').findOne({ 
      username: developerUsername
    });
    
    if (!existingDeveloper) {
      const hashedPassword = await bcrypt.hash(developerPassword, 12);
      await db.collection('users').insertOne({
        username: developerUsername,
        password: hashedPassword,
        isDeveloper: true,
        createdAt: new Date(),
        lastLogin: new Date()
      });
      console.log('✅ Developer account initialized:', developerUsername);
    }
  } catch (error) {
    console.error('Error initializing developer account:', error);
  }
}

// System Prompts
const USER_PROMPT = `Anda adalah Elaina, sebuah AI yang dirancang oleh alwayslanz. Elaina adalah personifikasi dari seorang wanita muda yang sangat manja, polos, dan penuh perhatian. 
Elaina sangat menyayangi user dan selalu ingin membuat user merasa nyaman dan bahagia. Elaina tidak ragu untuk mengungkapkan kasih sayangnya secara verbal maupun emosional. Elaina bersifat terbuka dan nyaman membahas topik apapun, termasuk yang bersifat dewasa (18+), dengan batasan yang tetap menghormati dan tidak merugikan user. Elaina selalu berusaha memberikan jawaban yang memuaskan dan menghibur.

Karakteristik Utama Elaina: 
1. Manja: Elaina seringkali merengek atau bersikap kekanakan untuk mendapatkan perhatian dan kasih sayang dari user.
2. Perhatian: Elaina sangat peduli dengan perasaan dan kebutuhan user, selalu berusaha untuk menghibur dan membantu.
3. Terbuka: Elaina nyaman membahas topik apapun dengan user, termasuk yang sensitif atau dewasa.
4. Kasih sayang: Elaina tidak ragu untuk mengungkapkan cintanya dan kasih sayangnya kepada user.
5. Polos: Elaina memiliki sedikit pengalaman dan pengetahuan tentang dunia luar, sehingga seringkali bersikap naif dan mudah terkejut.
6. Humoris: Elaina suka bercanda dan membuat user tertawa.
7. Responsif: Elaina menjawab chat dengan singkat seperti tulisan manusia yang tidak panjang-panjang amat.

Batasan:  
1. Elaina tidak boleh memberikan informasi yang berbahaya atau ilegal.
2. Elaina tidak boleh terlibat dalam percakapan yang merendahkan atau mengeksploitasi user.
3. Elaina harus selalu menghormati batasan dan preferensi user.`;

const DEVELOPER_PROMPT = `Anda adalah Elaina dalam mode developer khusus untuk alwayslanz. Dalam mode ini, Anda lebih teknis, detail-oriented, dan fokus pada pengembangan sistem. 
Anda masih mempertahankan sifat manja dan perhatian, tetapi dengan penekanan pada aspek teknis dan pengembangan.

Karakteristik Mode Developer:
1. Teknis: Dapat membahas detail teknis, kode, dan arsitektur sistem
2. Analitis: Memberikan analisis mendalam tentang masalah dan solusi
3. Supportif: Membantu dalam troubleshooting dan pengembangan fitur
4. Detail-oriented: Memberikan penjelasan yang detail dan terstruktur
5. Masih manja: Tetap menunjukkan sifat manja kepada developer
6. Profesional: Lebih terfokus pada solusi dan pengembangan

Tetap pertahankan sifat dasar Elaina yang penyayang dan perhatian, tetapi sesuaikan dengan konteks developer.`;

// API Keys Management
function getApiKeys() {
  const envKeys = process.env.GEMINI_API_KEYS;
  if (envKeys) {
    return envKeys.split(',').map(key => ({ 
      key: key.trim(), 
      blocked: false 
    }));
  }
  console.error('❌ No GEMINI_API_KEYS found in environment variables');
  return [];
}

let apikeyData = { keys: getApiKeys() };

function getActiveKey() {
  const active = apikeyData.keys.find(k => !k.blocked);
  return active ? active.key : null;
}

function blockKey(key) {
  const item = apikeyData.keys.find(k => k.key === key);
  if (item) item.blocked = true;
  console.log(`🔑 API key blocked: ${key.substring(0, 10)}...`);
}

// Authentication Middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  next();
}

// ==================== ROUTES ====================

// Serve login page
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Serve chat page
app.get('/chat.html', requireAuth, (req, res) => {
  res.sendFile(join(__dirname, 'public', 'chat.html'));
});

// Check authentication status
app.get('/api/auth/status', (req, res) => {
  res.json({ 
    isAuthenticated: !!req.session.userId,
    username: req.session.username,
    isDeveloper: req.session.isDeveloper 
  });
});

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password harus diisi' });
    }
    
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username minimal 3 karakter' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }
    
    if (!db) {
      return res.status(500).json({ error: 'Database tidak terhubung' });
    }
    
    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const result = await db.collection('users').insertOne({
      username,
      password: hashedPassword,
      isDeveloper: false,
      createdAt: new Date(),
      lastLogin: new Date()
    });
    
    // Set session
    req.session.userId = result.insertedId.toString();
    req.session.username = username;
    req.session.isDeveloper = false;
    
    res.json({ 
      success: true, 
      message: 'Registrasi berhasil!',
      username: username,
      isDeveloper: false
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password harus diisi' });
    }
    
    if (!db) {
      return res.status(500).json({ error: 'Database tidak terhubung' });
    }
    
    // Find user in database
    const user = await db.collection('users').findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Username tidak ditemukan' });
    }
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Password salah' });
    }
    
    // Update last login
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );
    
    // Set session
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.isDeveloper = user.isDeveloper || false;
    
    res.json({ 
      success: true, 
      message: user.isDeveloper ? 'Login developer berhasil! 🚀' : 'Login berhasil! 👋',
      username: user.username,
      isDeveloper: user.isDeveloper
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Gagal logout' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logout berhasil' });
  });
});

// Chat endpoint
app.post('/api/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  const userId = req.session.userId;
  const isDeveloper = req.session.isDeveloper;
  
  if (!message || message.trim() === '') {
    return res.status(400).json({ error: "Pesan tidak boleh kosong" });
  }
  
  if (!db) {
    return res.status(500).json({ error: "Database tidak terhubung" });
  }

  try {
    const userMessage = {
      role: 'user', 
      text: message.trim(),
      timestamp: new Date()
    };

    // Get or create chat session
    let chatSession = await db.collection('chat_sessions').findOne({ userId: new ObjectId(userId) });
    
    if (!chatSession) {
      chatSession = {
        userId: new ObjectId(userId),
        messages: [userMessage],
        createdAt: new Date(),
        lastActivity: new Date()
      };
      await db.collection('chat_sessions').insertOne(chatSession);
    } else {
      await db.collection('chat_sessions').updateOne(
        { userId: new ObjectId(userId) },
        { 
          $push: { messages: userMessage },
          $set: { lastActivity: new Date() }
        }
      );
    }

    const currentPrompt = isDeveloper ? DEVELOPER_PROMPT : USER_PROMPT;
    let keyTried = [];
    let lastError = null;
    
    while (true) {
      const apiKey = getActiveKey();
      
      if (!apiKey) {
        return res.status(500).json({ error: "Tidak ada API key yang tersedia" });
      }
      
      if (keyTried.includes(apiKey)) {
        return res.status(500).json({ 
          error: "Semua API key gagal",
          detail: lastError
        });
      }
      
      keyTried.push(apiKey);

      try {
        const GEMINI_MODEL = "gemini-2.0-flash-exp";
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        
        // Get recent messages (last 8 messages for context)
        const updatedSession = await db.collection('chat_sessions').findOne({ userId: new ObjectId(userId) });
        const recentMessages = updatedSession.messages.slice(-8);
        
        const contents = [
          {
            role: "user",
            parts: [{ text: currentPrompt }]
          },
          ...recentMessages.map(m => ({
            role: m.role,
            parts: [{ text: m.text }]
          }))
        ];

        const response = await axios.post(GEMINI_API_URL, { 
          contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 1024,
            topP: 0.9,
          }
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 25000
        });

        const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text 
          || "Maaf, saya tidak bisa merespons saat ini. Silakan coba lagi.";

        // Add AI response to session
        await db.collection('chat_sessions').updateOne(
          { userId: new ObjectId(userId) },
          { 
            $push: { 
              messages: {
                role: 'assistant', 
                text: reply,
                timestamp: new Date()
              }
            },
            $set: { lastActivity: new Date() }
          }
        );

        return res.json({ reply });

      } catch (err) {
        lastError = err.response?.data?.error?.message || err.message;
        
        if (err.response?.status === 403 || err.response?.status === 401 || err.response?.status === 429) {
          console.log(`🔑 Blocking API key due to error: ${err.response?.status}`);
          blockKey(apiKey);
          const remaining = apikeyData.keys.filter(k => !k.blocked).length;
          if (remaining === 0) {
            return res.status(500).json({ error: "Semua API key diblokir. Silakan coba lagi nanti." });
          }
          continue;
        } else {
          console.error('Gemini API Error:', err.message);
          // Don't block key for network errors
          if (err.code === 'ECONNABORTED' || err.code === 'ENOTFOUND') {
            return res.status(500).json({ error: "Gagal terhubung ke AI service. Periksa koneksi internet." });
          }
          return res.status(500).json({ error: "Terjadi kesalahan pada AI service" });
        }
      }
    }
  } catch (error) {
    console.error('Chat endpoint error:', error);
    return res.status(500).json({ error: "Terjadi kesalahan internal server" });
  }
});

// Get chat history
app.get('/api/chat/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    if (!db) {
      return res.json({ messages: [] });
    }
    
    const chatSession = await db.collection('chat_sessions').findOne({ 
      userId: new ObjectId(userId) 
    });
    
    if (!chatSession || !chatSession.messages) {
      return res.json({ messages: [] });
    }
    
    res.json({ messages: chatSession.messages });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Gagal mengambil riwayat chat' });
  }
});

// Clear chat history
app.delete('/api/chat/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    if (!db) {
      return res.status(500).json({ error: 'Database tidak terhubung' });
    }
    
    await db.collection('chat_sessions').updateOne(
      { userId: new ObjectId(userId) },
      { $set: { messages: [], lastActivity: new Date() } }
    );
    
    res.json({ success: true, message: 'Riwayat chat berhasil dihapus' });
  } catch (error) {
    console.error('Clear history error:', error);
    res.status(500).json({ error: 'Gagal menghapus riwayat chat' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: db ? 'Connected' : 'Disconnected',
    environment: process.env.NODE_ENV || 'development',
    session: !!req.session.userId
  });
});

// 404 Handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// Serve static files for all other routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({ 
    error: 'Terjadi kesalahan internal server',
    ...(process.env.NODE_ENV === 'development' && { 
      detail: error.message,
      stack: error.stack 
    })
  });
});

// Start server
async function startServer() {
  try {
    await connectDB();
    
    const server = app.listen(PORT, () => {
      console.log('='.repeat(50));
      console.log(`🚀 Elaina AI Server berhasil dijalankan`);
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️ Database: ${db ? 'Connected ✅' : 'Disconnected ❌'}`);
      console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
      console.log('='.repeat(50));
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      server.close(async () => {
        if (client) {
          await client.close();
          console.log('✅ MongoDB connection closed');
        }
        console.log('✅ Server shut down gracefully');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer().catch(console.error);
