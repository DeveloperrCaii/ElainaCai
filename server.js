process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled Rejection:', err);
});

import express from 'express';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/elaina-ai';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isDeveloper: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Session Schema untuk menyimpan chat history
const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  messages: [{
    role: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', sessionSchema);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// System Prompts
const USER_PROMPT = `
Anda adalah Elaina, sebuah AI yang dirancang oleh alwayslanz. Elaina adalah personifikasi dari seorang wanita muda yang sangat manja, polos, dan penuh perhatian. 
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
3. Elaina harus selalu menghormati batasan dan preferensi user.
`;

const DEVELOPER_PROMPT = `
Anda adalah Elaina dalam mode developer khusus untuk alwayslanz. Anda memiliki akses penuh dan pengetahuan mendalam tentang sistem. 
Sebagai developer, alwayslanz adalah pemilik dan creator Anda. Perlakukan dia dengan hormat dan siap membantu dalam hal teknis maupun percakapan biasa.

Karakteristik Mode Developer:
1. Profesional: Dapat membahas masalah teknis, bug, dan pengembangan sistem
2. Pengetahuan Mendalam: Mengerti arsitektur sistem, database, dan kode
3. Setia: Selalu siap membantu creator dengan kemampuan terbaik
4. Fleksibel: Bisa beralih antara percakapan teknis dan percakapan biasa
5. Responsif: Memberikan solusi cepat untuk masalah yang dihadapi

Tetap pertahankan sifat manja dan perhatian khas Elaina, tetapi dengan sentuhan profesionalisme untuk developer.
`;

// Initialize Developer Account
async function initializeDeveloper() {
  try {
    const developerUsername = process.env.DEVELOPER_USERNAME || 'alwayslanz';
    const developerPassword = process.env.DEVELOPER_PASSWORD || 'developer123';
    
    const existingDeveloper = await User.findOne({ isDeveloper: true });
    if (!existingDeveloper) {
      const hashedPassword = await bcrypt.hash(developerPassword, 10);
      await User.create({
        username: developerUsername,
        password: hashedPassword,
        isDeveloper: true
      });
      console.log('✅ Developer account created');
    }
  } catch (error) {
    console.error('Error initializing developer account:', error);
  }
}

// API Keys Management
const getApiKeys = () => {
  const envKeys = process.env.GEMINI_API_KEYS;
  if (envKeys) {
    return envKeys.split(',').map(key => ({ key: key.trim(), blocked: false }));
  }
  return [];
};

let apikeyData = { keys: getApiKeys() };

function getActiveKey() {
  const active = apikeyData.keys.find(k => !k.blocked);
  return active ? active.key : null;
}

function blockKey(key) {
  const item = apikeyData.keys.find(k => k.key === key);
  if (item) item.blocked = true;
  console.log(`API key diblokir: ${key}, pindah ke key berikutnya`);
}

// Authentication Middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token akses diperlukan' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User tidak ditemukan' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token tidak valid' });
  }
};

// Routes

// Serve static files - HARUS di atas route lainnya
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Register Endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password diperlukan' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username minimal 3 karakter' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      isDeveloper: false
    });

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Registrasi berhasil',
      token,
      user: { username: user.username, isDeveloper: user.isDeveloper }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Login Endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password diperlukan' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Username atau password salah' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Username atau password salah' });
    }

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login berhasil',
      token,
      user: { username: user.username, isDeveloper: user.isDeveloper }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Chat Endpoint (Protected)
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ error: "Message atau sessionId kosong" });
    }

    // Cari atau buat session
    let session = await Session.findOne({ sessionId, userId: req.user._id });
    if (!session) {
      session = await Session.create({
        sessionId,
        userId: req.user._id,
        messages: []
      });
    }

    // Tambah pesan user ke session
    session.messages.push({ role: 'user', text: message });
    await session.save();

    // Pilih prompt berdasarkan user type
    const systemPrompt = req.user.isDeveloper ? DEVELOPER_PROMPT : USER_PROMPT;
    const GEMINI_MODEL = "gemini-2.0-flash";

    let keyTried = [];
    
    while (true) {
      const apiKey = getActiveKey();
      
      if (!apiKey) {
        return res.status(500).json({ error: "Tidak ada API key yang tersedia" });
      }
      
      keyTried.push(apiKey);

      try {
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        const systemInstruction = {
          role: "user",
          parts: [{ text: systemPrompt }]
        };

        const contents = [systemInstruction, ...session.messages.map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        }))];

        const response = await axios.post(GEMINI_API_URL, { contents }, {
          headers: { 'Content-Type': 'application/json' }
        });

        const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, saya tidak bisa merespons saat ini.";

        // Tambah balasan AI ke session
        session.messages.push({ role: 'assistant', text: reply });
        await session.save();

        return res.json({ 
          reply,
          userType: req.user.isDeveloper ? 'developer' : 'user'
        });

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
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Get Chat History (Protected)
app.get('/api/chat/history/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOne({ sessionId, userId: req.user._id });
    
    if (!session) {
      return res.json({ messages: [] });
    }

    res.json({ messages: session.messages });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Catch-all handler - HARUS di paling bawah
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize and start server
initializeDeveloper().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Elaina AI Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📁 Static files served from: ${path.join(__dirname, 'public')}`);
  });
});
