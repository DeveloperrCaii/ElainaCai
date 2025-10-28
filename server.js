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
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Simple CORS - work untuk semua environment
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files dari folder 'main'
app.use(express.static(path.join(__dirname, 'main')));

// System prompt untuk Elaina AI
const paylo = `
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

// Function untuk get API keys
const getApiKeys = () => {
  // Priority 1: Environment Variables (Vercel)
  if (process.env.GEMINI_API_KEYS) {
    const keys = process.env.GEMINI_API_KEYS.split(',');
    return keys.map(key => ({ 
      key: key.trim(), 
      blocked: false 
    }));
  }
  
  // Priority 2: Fallback file (Development)
  try {
    const APIKEY_FILE = path.join(__dirname, 'apikey.json');
    if (fs.existsSync(APIKEY_FILE)) {
      const apikeyData = JSON.parse(fs.readFileSync(APIKEY_FILE, 'utf-8'));
      return apikeyData.keys || [];
    }
  } catch (err) {
    console.error('Error loading API keys from file:', err.message);
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
  if (item) {
    item.blocked = true;
    console.log(`🔑 API key diblokir: ${key.substring(0, 10)}...`);
  }
}

const sessions = {};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Elaina AI Server is running',
    timestamp: new Date().toISOString(),
    activeSessions: Object.keys(sessions).length,
    availableKeys: apikeyData.keys.filter(k => !k.blocked).length
  });
});

// API info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Elaina AI Assistant',
    version: '1.0.0',
    developer: 'alwayslanz',
    model: 'gemini-2.0-flash'
  });
});

const GEMINI_MODEL = "gemini-2.0-flash";

// Main chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    // Validation
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Pesan tidak boleh kosong" });
    }
    
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID diperlukan" });
    }
    
    // Initialize session jika belum ada
    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }
    
    // Add user message to session
    sessions[sessionId].push({ 
      role: 'user', 
      text: message.trim(),
      timestamp: new Date().toISOString()
    });

    console.log(`💬 Processing message from session: ${sessionId}`);
    
    let retryCount = 0;
    const maxRetries = apikeyData.keys.length;
    
    while (retryCount < maxRetries) {
      const apiKey = getActiveKey();
      
      if (!apiKey) {
        return res.status(500).json({ error: "Tidak ada API key yang tersedia" });
      }
      
      try {
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        
        const systemInstruction = {
          role: "user",
          parts: [{ text: paylo }]
        };

        // Prepare conversation history
        const contents = [
          systemInstruction,
          ...sessions[sessionId].map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
          }))
        ];

        console.log('🔄 Sending request to Gemini API...');
        
        const response = await axios.post(
          GEMINI_API_URL, 
          { contents }, 
          {
            headers: { 
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            timeout: 30000 // 30 seconds timeout
          }
        );

        const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text 
          || "Maaf, saya tidak bisa merespons saat ini. Silakan coba lagi.";

        // Add AI response to session
        sessions[sessionId].push({ 
          role: 'assistant', 
          text: reply,
          timestamp: new Date().toISOString()
        });

        console.log('✅ Successfully got response from Gemini');
        
        return res.json({ 
          reply,
          sessionId,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('❌ Gemini API Error:', error.response?.status, error.message);
        
        // Block key jika error 403/401
        if (error.response?.status === 403 || error.response?.status === 401) {
          blockKey(apiKey);
          retryCount++;
          
          const remainingKeys = apikeyData.keys.filter(k => !k.blocked).length;
          console.log(`🔄 Retrying with next key... (${remainingKeys} keys remaining)`);
          
          if (remainingKeys === 0) {
            return res.status(500).json({ 
              error: "Semua API key tidak valid. Silakan periksa API keys Anda." 
            });
          }
          continue; // Coba dengan key berikutnya
        }
        
        // Handle other errors
        if (error.code === 'ECONNABORTED') {
          return res.status(408).json({ error: "Timeout: Server terlalu lama merespons" });
        }
        
        if (error.response?.status >= 500) {
          return res.status(502).json({ error: "Server Gemini sedang mengalami masalah" });
        }
        
        // Unknown error
        return res.status(500).json({ 
          error: "Terjadi kesalahan: " + (error.message || 'Unknown error')
        });
      }
    }
    
    // Jika semua retry gagal
    return res.status(500).json({ 
      error: "Gagal memproses permintaan setelah beberapa percobaan" 
    });

  } catch (error) {
    console.error('💥 Server Error:', error);
    return res.status(500).json({ 
      error: "Terjadi kesalahan internal server" 
    });
  }
});

// Cleanup old sessions (optional)
setInterval(() => {
  const now = Date.now();
  const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour
  
  Object.keys(sessions).forEach(sessionId => {
    const session = sessions[sessionId];
    if (session.length > 0) {
      const lastActivity = new Date(session[session.length - 1].timestamp).getTime();
      if (now - lastActivity > SESSION_TIMEOUT) {
        delete sessions[sessionId];
        console.log(`🧹 Cleaned up old session: ${sessionId}`);
      }
    }
  });
}, 30 * 60 * 1000); // Run every 30 minutes

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint tidak ditemukan',
    availableEndpoints: ['GET /', 'GET /health', 'GET /api/info', 'POST /chat']
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🔥 Unhandled Error:', error);
  res.status(500).json({ 
    error: 'Terjadi kesalahan internal server' 
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Elaina AI Server started successfully!');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 Available API keys: ${apikeyData.keys.filter(k => !k.blocked).length}`);
  console.log(`💻 Server URL: http://localhost:${PORT}`);
});
