// Simple error handling
process.on('uncaughtException', (err) => {
  console.log('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.log('Unhandled Rejection:', err.message);
});

// Import dengan error handling
let express, axios, cors, path, fs;

try {
  express = (await import('express')).default;
  axios = (await import('axios')).default;
  cors = (await import('cors')).default;
  path = (await import('path')).default;
  fs = (await import('fs')).default;
} catch (error) {
  console.log('Error importing modules:', error.message);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// System prompt
const systemPrompt = `Anda adalah Elaina, asisten AI yang manja dan perhatian. 
Jawablah dengan singkat dan friendly seperti manusia biasa.
Karakteristik: manja, perhatian, humoris, polos.
Jangan buat jawaban yang terlalu panjang.`;

// Get API keys
function getApiKeys() {
  // Dari environment variables (Vercel)
  if (process.env.GEMINI_API_KEYS) {
    const keys = process.env.GEMINI_API_KEYS.split(',');
    return keys.map(key => ({ 
      key: key.trim(), 
      blocked: false 
    }));
  }
  
  // Fallback ke hardcoded keys
  return [
    { key: "AIzaSyAay2AxpZksuvOdO4iYtq08npvgmeoW4rE", blocked: false },
    { key: "AIzaSyDnxGFnnB8C1H1fXwzsf2sPmQWHahNTcDo", blocked: false }
  ];
}

const apiKeys = getApiKeys();
const sessions = {};

// Helper functions
function getActiveKey() {
  return apiKeys.find(k => !k.blocked)?.key || null;
}

function blockKey(key) {
  const keyObj = apiKeys.find(k => k.key === key);
  if (keyObj) {
    keyObj.blocked = true;
    console.log('Blocked key:', key.substring(0, 10) + '...');
  }
}

function createSessionId() {
  return 'session_' + Math.random().toString(36).substr(2, 9);
}

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Elaina AI Server is running!',
    endpoints: {
      health: '/health',
      chat: '/chat (POST)',
      info: '/info'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    activeSessions: Object.keys(sessions).length,
    availableKeys: apiKeys.filter(k => !k.blocked).length
  });
});

app.get('/info', (req, res) => {
  res.json({
    name: 'Elaina AI',
    version: '2.0.0',
    creator: 'alwayslanz'
  });
});

// Main chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, sessionId = createSessionId() } = req.body;

    // Validasi input
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Pesan tidak boleh kosong' 
      });
    }

    const cleanMessage = message.trim();

    // Initialize session
    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }

    // Add user message
    sessions[sessionId].push({
      role: 'user',
      text: cleanMessage,
      timestamp: new Date().toISOString()
    });

    console.log('Processing message for session:', sessionId);

    // Try each API key
    for (const keyObj of apiKeys) {
      if (keyObj.blocked) continue;

      try {
        const apiKey = keyObj.key;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        
        const contents = [
          {
            role: "user",
            parts: [{ text: systemPrompt }]
          },
          ...sessions[sessionId].map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
          }))
        ];

        const response = await axios.post(url, { contents }, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });

        const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text 
          || "Maaf, saya tidak bisa merespons saat ini.";

        // Add AI response
        sessions[sessionId].push({
          role: 'assistant',
          text: reply,
          timestamp: new Date().toISOString()
        });

        console.log('Success! Used key:', apiKey.substring(0, 10) + '...');

        return res.json({
          reply,
          sessionId,
          success: true
        });

      } catch (error) {
        console.log('Key failed:', keyObj.key.substring(0, 10) + '...', error.response?.status);
        
        if (error.response?.status === 403 || error.response?.status === 401) {
          blockKey(keyObj.key);
          continue; // Try next key
        }
      }
    }

    // All keys failed
    res.status(500).json({
      error: 'Semua API key tidak berfungsi. Silakan cek API keys Anda.'
    });

  } catch (error) {
    console.log('Server error:', error.message);
    res.status(500).json({
      error: 'Terjadi kesalahan internal: ' + error.message
    });
  }
});

// Cleanup old sessions setiap 30 menit
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 jam
  
  Object.keys(sessions).forEach(sessionId => {
    const session = sessions[sessionId];
    if (session.length > 0) {
      const lastMsg = session[session.length - 1];
      const lastTime = new Date(lastMsg.timestamp).getTime();
      
      if (now - lastTime > maxAge) {
        delete sessions[sessionId];
        console.log('Cleaned session:', sessionId);
      }
    }
  });
}, 30 * 60 * 1000);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Elaina AI Server Started!
📍 Port: ${PORT}
🔑 Available Keys: ${apiKeys.filter(k => !k.blocked).length}
🌐 Environment: ${process.env.NODE_ENV || 'development'}
  `);
});

export default app;
