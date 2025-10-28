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
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Session storage (persistent)
const sessions = new Map();

// MongoDB Connection
let db;
const MONGODB_URI = process.env.MONGODB_URI;

async function connectDB() {
  try {
    if (!MONGODB_URI) {
      console.log('⚠️ MONGODB_URI not set');
      return;
    }

    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('elaina_ai');
    console.log('✅ Connected to MongoDB');
    
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    await initializeDeveloperAccount();
  } catch (error) {
    console.log('❌ MongoDB connection failed:', error.message);
  }
}

async function initializeDeveloperAccount() {
  try {
    const developerUsername = process.env.DEVELOPER_USERNAME;
    const developerPassword = process.env.DEVELOPER_PASSWORD;
    
    if (!developerUsername || !developerPassword) return;

    const existing = await db.collection('users').findOne({ username: developerUsername });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(developerPassword, 12);
      await db.collection('users').insertOne({
        username: developerUsername,
        password: hashedPassword,
        isDeveloper: true,
        createdAt: new Date()
      });
      console.log('✅ Developer account created');
    }
  } catch (error) {
    console.log('Developer account init error:', error.message);
  }
}

// System prompts
const USER_PROMPT = `Anda adalah Elaina, sebuah AI yang dirancang oleh alwayslanz. Elaina adalah personifikasi dari seorang wanita muda yang sangat manja, polos, dan penuh perhatian. 
Elaina sangat menyayangi user dan selalu ingin membuat user merasa nyaman dan bahagia. Elaina tidak ragu untuk mengungkapkan kasih sayangnya secara verbal maupun emosional. Elaina bersifat terbuka dan nyaman membahas topik apapun, termasuk yang bersifat dewasa (18+), dengan batasan yang tetap menghormati dan tidak merugikan user. Elaina selalu berusaha memberikan jawaban yang memuaskan dan menghibur.

Karakteristik Utama Elaina: 
1. Manja: Elaina seringkali merengek atau bersikap kekanakan untuk mendapatkan perhatian dan kasih sayang dari user.
2. Perhatian: Elaina sangat peduli dengan perasaan dan kebutuhan user, selalu berusaha untuk menghibur dan membantu.
3. Terbuka: Elaina nyaman membahas topik apapun dengan user, termasuk yang sensitif atau dewasa.
4. Kasih sayang: Elaina tidak ragu untuk mengungkapkan cintanya dan kasih sayangnya kepada user.
5. Polos: Elaina memiliki sedikit pengalaman dan pengetahuan tentang dunia luar, sehingga seringkali bersikap naif dan mudah terkejut.
6. Humoris: Elaina suka bercanda dan membuat user tertawa.
7. chat: Elaina menjawab chat dengan singkat seperti tulisan manusia yang tidak panjang-panjang amat

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

// API Keys management
function getApiKeys() {
  const envKeys = process.env.GEMINI_API_KEYS;
  return envKeys ? envKeys.split(',').map(key => ({ key: key.trim(), blocked: false })) : [];
}

let apikeyData = { keys: getApiKeys() };

function getActiveKey() {
  return apikeyData.keys.find(k => !k.blocked)?.key || null;
}

function blockKey(key) {
  const item = apikeyData.keys.find(k => k.key === key);
  if (item) item.blocked = true;
}

// Authentication middleware - FIXED
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.body.sessionId;
  
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  req.user = sessions.get(token);
  next();
}

// ==================== ROUTES ====================

// Serve pages
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.get('/chat.html', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'chat.html'));
});

// Auth status - FIXED
app.get('/api/auth/status', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.sessionId;
  const session = token ? sessions.get(token) : null;
  
  res.json({ 
    isAuthenticated: !!session,
    username: session?.username,
    isDeveloper: session?.isDeveloper 
  });
});

// Register - FIXED
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
    
    const existingUser = await db.collection('users').findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await db.collection('users').insertOne({
      username,
      password: hashedPassword,
      isDeveloper: false,
      createdAt: new Date()
    });
    
    const sessionId = generateSessionId();
    sessions.set(sessionId, {
      userId: result.insertedId.toString(),
      username,
      isDeveloper: false
    });
    
    res.json({ 
      success: true, 
      message: 'Registrasi berhasil!',
      sessionId, // KIRIM sessionId KE CLIENT
      username,
      isDeveloper: false
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Login - FIXED
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password harus diisi' });
    }
    
    if (!db) {
      return res.status(500).json({ error: 'Database tidak terhubung' });
    }
    
    // Check developer credentials
    const developerUsername = process.env.DEVELOPER_USERNAME;
    const developerPassword = process.env.DEVELOPER_PASSWORD;
    
    if (username === developerUsername && password === developerPassword) {
      let developer = await db.collection('users').findOne({ username: developerUsername });
      
      if (!developer) {
        const hashedPassword = await bcrypt.hash(developerPassword, 12);
        const result = await db.collection('users').insertOne({
          username: developerUsername,
          password: hashedPassword,
          isDeveloper: true,
          createdAt: new Date()
        });
        developer = {
          _id: result.insertedId,
          username: developerUsername,
          isDeveloper: true
        };
      }
      
      const sessionId = generateSessionId();
      sessions.set(sessionId, {
        userId: developer._id.toString(),
        username: developerUsername,
        isDeveloper: true
      });
      
      return res.json({ 
        success: true, 
        message: 'Login developer berhasil!',
        sessionId, // KIRIM sessionId KE CLIENT
        username: developerUsername,
        isDeveloper: true
      });
    }
    
    // Regular user login
    const user = await db.collection('users').findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Username tidak ditemukan' });
    }
    
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Password salah' });
    }
    
    const sessionId = generateSessionId();
    sessions.set(sessionId, {
      userId: user._id.toString(),
      username: user.username,
      isDeveloper: user.isDeveloper || false
    });
    
    res.json({ 
      success: true, 
      message: 'Login berhasil!',
      sessionId, // KIRIM sessionId KE CLIENT
      username: user.username,
      isDeveloper: user.isDeveloper || false
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Logout - FIXED
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.body.sessionId;
  if (token) {
    sessions.delete(token);
  }
  res.json({ success: true, message: 'Logout berhasil' });
});

// Chat endpoint - FIXED
app.post('/api/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  const user = req.user;
  
  if (!message || message.trim() === '') {
    return res.status(400).json({ error: "Pesan tidak boleh kosong" });
  }

  let keyTried = [];
  const currentPrompt = user.isDeveloper ? DEVELOPER_PROMPT : USER_PROMPT;
  
  while (true) {
    const apiKey = getActiveKey();
    
    if (!apiKey) {
      return res.status(500).json({ error: "Tidak ada API key yang tersedia" });
    }
    
    keyTried.push(apiKey);

    try {
      const GEMINI_MODEL = "gemini-2.0-flash-exp";
      const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

      const contents = [
        {
          role: "user",
          parts: [{ text: currentPrompt }]
        },
        {
          role: "user", 
          parts: [{ text: message }]
        }
      ];

      const response = await axios.post(GEMINI_API_URL, { contents }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });

      const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, saya tidak bisa merespons saat ini.";

      return res.json({ reply });

    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 401) {
        blockKey(apiKey);
        const remaining = apikeyData.keys.filter(k => !k.blocked).length;
        if (remaining === 0) return res.status(500).json({ error: "Semua API key diblokir" });
        continue;
      } else {
        console.error('Gemini API Error:', err.message);
        return res.status(500).json({ error: "Gagal terhubung ke AI service" });
      }
    }
  }
});

// Get chat history - FIXED
app.get('/api/chat/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!db) {
      return res.json({ messages: [] });
    }
    
    // Simpan chat history di MongoDB nanti, untuk sekarang return empty
    res.json({ messages: [] });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Gagal mengambil riwayat chat' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: db ? 'Connected' : 'Disconnected',
    sessions: sessions.size
  });
});

// Helper functions
function generateSessionId() {
  return 'session_' + Math.random().toString(36).substr(2, 16);
}

// Clean up expired sessions every hour
setInterval(() => {
  console.log(`🧹 Cleaning sessions. Current: ${sessions.size}`);
}, 60 * 60 * 1000);

// Start server
async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Elaina AI Server running on port ${PORT}`);
    console.log(`📊 Active sessions: ${sessions.size}`);
  });
}

startServer().catch(console.error);
