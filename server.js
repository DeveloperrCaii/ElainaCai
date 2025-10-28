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
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import session from 'express-session';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/elaina-ai';
let db, usersCollection, chatsCollection, logsCollection;

async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    usersCollection = db.collection('users');
    chatsCollection = db.collection('chats');
    logsCollection = db.collection('logs');
    
    // Create indexes
    await usersCollection.createIndex({ username: 1 }, { unique: true });
    await chatsCollection.createIndex({ userId: 1, createdAt: -1 });
    await logsCollection.createIndex({ timestamp: -1 });
    
    console.log('✅ Connected to MongoDB');
    
    // Create admin user if not exists
    await createAdminUser();
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function createAdminUser() {
  const adminExists = await usersCollection.findOne({ username: process.env.ADMIN_USERNAME || 'admin' });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
    await usersCollection.insertOne({
      username: process.env.ADMIN_USERNAME || 'admin',
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date(),
      isDeveloper: true
    });
    console.log('👑 Admin user created');
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'elaina-ai-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.session.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

// System prompts
const userPaylo = `
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

const adminPaylo = `
Anda adalah Elaina versi developer, AI yang lebih pengertian, sabar, dan berpengetahuan luas. Anda memiliki akses ke informasi teknis dan dapat membantu dengan masalah yang lebih kompleks.

Karakteristik Developer Elaina:
1. Pengertian: Memahami kebutuhan teknis dan memberikan solusi yang tepat
2. Sabar: Menjelaskan hal kompleks dengan cara yang mudah dimengerti
3. Berpengetahuan: Menguasai berbagai topik teknis dan pemrograman
4. Supportif: Selalu siap membantu menyelesaikan masalah
5. Profesional: Tetap hangat namun fokus pada solusi

Anda dapat membahas:
- Pemrograman dan teknologi
- Troubleshooting sistem
- Best practices development
- Architecture dan design patterns
- Dan topik teknis lainnya

Tetap pertahankan sifat penyayang Elaina, namun dengan pendekatan yang lebih profesional.
`;

// API Keys management
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
  console.log(`API key diblokir: ${key}`);
}

const GEMINI_MODEL = "gemini-2.0-flash-exp";

// Routes
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.redirect('/login.html');
  }
});

app.get('/login.html', (req, res) => {
  if (req.session.userId) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'login.html'));
  }
});

// Auth routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password diperlukan' });
    }
    
    // Check if user exists
    const existingUser = await usersCollection.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }
    
    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await usersCollection.insertOne({
      username,
      password: hashedPassword,
      role: 'user',
      createdAt: new Date(),
      isDeveloper: false
    });
    
    // Auto login after registration
    req.session.userId = result.insertedId.toString();
    req.session.username = username;
    req.session.role = 'user';
    req.session.isDeveloper = false;
    
    // Log the registration
    await logsCollection.insertOne({
      type: 'user_registered',
      username,
      userId: result.insertedId,
      timestamp: new Date()
    });
    
    res.json({ 
      success: true, 
      message: 'Registrasi berhasil',
      user: { 
        username, 
        role: 'user',
        isDeveloper: false
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password diperlukan' });
    }
    
    // Find user
    const user = await usersCollection.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    
    // Set session
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.isDeveloper = user.isDeveloper;
    
    // Log the login
    await logsCollection.insertOne({
      type: 'user_login',
      username,
      userId: user._id,
      timestamp: new Date()
    });
    
    res.json({ 
      success: true, 
      message: 'Login berhasil',
      user: { 
        username: user.username, 
        role: user.role,
        isDeveloper: user.isDeveloper
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logout berhasil' });
  });
});

app.get('/api/check-auth', (req, res) => {
  if (req.session.userId) {
    res.json({ 
      authenticated: true,
      user: {
        username: req.session.username,
        role: req.session.role,
        isDeveloper: req.session.isDeveloper
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Chat routes
app.post('/api/chat', requireAuth, async (req, res) => {
  const { message, sessionId } = req.body;
  const userId = req.session.userId;
  
  if (!message) {
    return res.status(400).json({ error: "Message kosong" });
  }
  
  const actualSessionId = sessionId || `user_${userId}_${Date.now()}`;
  
  try {
    // Save user message to database
    await chatsCollection.insertOne({
      userId: new ObjectId(userId),
      sessionId: actualSessionId,
      role: 'user',
      message: message,
      timestamp: new Date()
    });
    
    // Log the chat request
    await logsCollection.insertOne({
      type: 'chat_message',
      userId: new ObjectId(userId),
      username: req.session.username,
      sessionId: actualSessionId,
      message: message,
      timestamp: new Date()
    });

    let keyTried = [];
    
    while (true) {
      const apiKey = getActiveKey();
      
      if (!apiKey) {
        return res.status(500).json({ error: "Tidak ada API key yang tersedia" });
      }
      
      keyTried.push(apiKey);

      try {
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        
        // Use different system prompt for developer users
        const systemPrompt = req.session.isDeveloper ? adminPaylo : userPaylo;
        
        const systemInstruction = {
          role: "user",
          parts: [{ text: systemPrompt }]
        };

        // Get recent chat history for context
        const chatHistory = await chatsCollection.find({
          userId: new ObjectId(userId),
          sessionId: actualSessionId
        }).sort({ timestamp: -1 }).limit(10).toArray();
        
        const contents = [systemInstruction];
        
        // Add chat history in chronological order
        chatHistory.reverse().forEach(chat => {
          contents.push({
            role: chat.role === 'user' ? 'user' : 'assistant',
            parts: [{ text: chat.message }]
          });
        });

        const response = await axios.post(GEMINI_API_URL, { contents }, {
          headers: { 'Content-Type': 'application/json' }
        });

        const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf, saya tidak bisa merespons saat ini.";

        // Save AI response to database
        await chatsCollection.insertOne({
          userId: new ObjectId(userId),
          sessionId: actualSessionId,
          role: 'assistant',
          message: reply,
          timestamp: new Date()
        });

        return res.json({ reply, sessionId: actualSessionId });

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get chat history
app.get('/api/chat-history', requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.userId);
    const sessionId = req.query.sessionId;
    
    let query = { userId };
    if (sessionId) {
      query.sessionId = sessionId;
    }
    
    const chats = await chatsCollection.find(query)
      .sort({ timestamp: 1 })
      .toArray();
    
    res.json({ chats });
  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user sessions
app.get('/api/sessions', requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.userId);
    
    const sessions = await chatsCollection.aggregate([
      { $match: { userId } },
      { $group: { 
        _id: "$sessionId", 
        lastMessage: { $last: "$timestamp" },
        messageCount: { $sum: 1 }
      }},
      { $sort: { lastMessage: -1 } }
    ]).toArray();
    
    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin routes
app.get('/api/admin/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    const logs = await logsCollection.find()
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    
    const total = await logsCollection.countDocuments();
    
    res.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await usersCollection.find({}, {
      projection: { password: 0 }
    }).sort({ createdAt: -1 }).toArray();
    
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    mongo: db ? 'Connected' : 'Disconnected'
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// Initialize database and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Elaina AI Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`👑 Admin username: ${process.env.ADMIN_USERNAME || 'admin'}`);
  });
});