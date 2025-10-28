// DOM Elements
const appContainer = document.getElementById('appContainer');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const typingIndicator = document.getElementById('typingIndicator');
const themeToggle = document.getElementById('themeToggle');
const musicToggle = document.getElementById('musicToggle');
const contactToggle = document.getElementById('contactToggle');
const historyToggle = document.getElementById('historyToggle');
const logoutButton = document.getElementById('logoutButton');
const userGreeting = document.getElementById('userGreeting');
const developerBadge = document.getElementById('developerBadge');

// Panel elements
const historyPanel = document.getElementById('historyPanel');
const closeHistory = document.getElementById('closeHistory');
const historyContent = document.getElementById('historyContent');
const musicPlayer = document.getElementById('musicPlayer');
const playPauseMusic = document.getElementById('playPauseMusic');
const prevMusic = document.getElementById('prevMusic');
const nextMusic = document.getElementById('nextMusic');
const musicProgressBar = document.getElementById('musicProgressBar');
const musicTitle = document.getElementById('musicTitle');
const contactPanel = document.getElementById('contactPanel');
const closeContact = document.getElementById('closeContact');
const overlay = document.getElementById('overlay');

// State variables
let currentTheme = localStorage.getItem('theme') || 'light';
let isMusicPlaying = false;
let currentMusicIndex = 0;
let currentSessionId = null;
let isDeveloper = false;

// Music playlist
const musicPlaylist = [
    {
        title: "Lofi Study Beats",
        url: "https://files.catbox.moe/9m8y9f.mp3"
    },
    {
        title: "Chill Vibes",
        url: "https://files.catbox.moe/x7j2p0.mp3"
    },
    {
        title: "Relaxing Piano",
        url: "https://files.catbox.moe/6b3p9s.mp3"
    }
];

const audio = new Audio();

// Initialize the application
async function initApp() {
    await checkAuth();
    initTheme();
    await loadChatHistory();
    setupEventListeners();
    autoResizeTextarea();
}

// Check authentication
async function checkAuth() {
    try {
        const response = await fetch('/api/check-auth');
        const data = await response.json();
        
        if (data.authenticated) {
            showApp(data.user);
        } else {
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login.html';
    }
}

// Show main app
function showApp(user) {
    userGreeting.textContent = `Halo, ${user.username}!`;
    isDeveloper = user.isDeveloper;
    
    if (isDeveloper) {
        developerBadge.style.display = 'block';
    }
    
    appContainer.style.display = 'flex';
}

// Initialize theme
function initTheme() {
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
        themeToggle.innerHTML = '☀️';
    } else {
        document.body.classList.remove('dark-mode');
        themeToggle.innerHTML = '🌙';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Message input and sending
    messageInput.addEventListener('input', autoResizeTextarea);
    messageInput.addEventListener('keypress', handleKeyPress);
    sendButton.addEventListener('click', sendMessage);
    
    // Theme toggle
    themeToggle.addEventListener('click', toggleTheme);
    
    // Music player
    musicToggle.addEventListener('click', toggleMusicPlayer);
    playPauseMusic.addEventListener('click', toggleMusic);
    prevMusic.addEventListener('click', playPreviousMusic);
    nextMusic.addEventListener('click', playNextMusic);
    
    // Panels
    contactToggle.addEventListener('click', () => togglePanel(contactPanel));
    historyToggle.addEventListener('click', () => togglePanel(historyPanel));
    closeHistory.addEventListener('click', () => togglePanel(historyPanel));
    closeContact.addEventListener('click', () => togglePanel(contactPanel));
    overlay.addEventListener('click', closeAllPanels);
    
    // Logout
    logoutButton.addEventListener('click', logout);
    
    // Audio events
    audio.addEventListener('timeupdate', updateMusicProgress);
    audio.addEventListener('ended', playNextMusic);
    audio.addEventListener('loadedmetadata', () => {
        musicTitle.textContent = musicPlaylist[currentMusicIndex].title;
    });
    
    // Prevent zoom on double tap
    document.addEventListener('dblclick', (e) => {
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });

    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            e.preventDefault();
        }
        lastTouchEnd = now;
    }, false);
}

// Auto-resize textarea
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// Handle Enter key press
function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

// Send message function
async function sendMessage() {
    const message = messageInput.value.trim();
    
    if (!message) return;
    
    // Add user message to chat
    addMessageToChat(message, 'user');
    messageInput.value = '';
    autoResizeTextarea();
    sendButton.disabled = true;
    
    // Show typing indicator
    showTypingIndicator();
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                message,
                sessionId: currentSessionId 
            })
        });
        
        const data = await response.json();
        
        if (data.reply) {
            addMessageToChat(data.reply, 'assistant');
            if (data.sessionId) {
                currentSessionId = data.sessionId;
            }
        } else {
            addMessageToChat('Maaf, terjadi kesalahan. Silakan coba lagi.', 'assistant');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        addMessageToChat('Maaf, terjadi kesalahan koneksi. Silakan coba lagi.', 'assistant');
    } finally {
        hideTypingIndicator();
        sendButton.disabled = false;
        messageInput.focus();
    }
}

// Add message to chat
function addMessageToChat(message, sender) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}-message`;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    // Process message for code blocks and formatting
    const processedMessage = processMessage(message);
    bubble.innerHTML = processedMessage;
    
    const timeElement = document.createElement('div');
    timeElement.className = 'message-time';
    timeElement.textContent = getCurrentTime();
    
    messageElement.appendChild(bubble);
    messageElement.appendChild(timeElement);
    
    chatMessages.appendChild(messageElement);
    scrollToBottom();
    
    // Add copy functionality to code blocks
    if (sender === 'assistant') {
        setTimeout(() => {
            addCopyButtonsToCodeBlocks();
        }, 100);
    }
}

// Process message for code blocks and formatting
function processMessage(message) {
    // Handle code blocks
    let processed = message.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
        const lang = language || 'text';
        return `
            <div class="code-block">
                <div class="code-header">
                    <span class="code-language">${lang}</span>
                    <button class="copy-button" onclick="copyCode(this)">
                        <span>📋</span> Salin
                    </button>
                </div>
                <div class="code-content">${escapeHtml(code.trim())}</div>
            </div>
        `;
    });
    
    // Handle inline code
    processed = processed.replace(/`([^`]+)`/g, '<code style="background: var(--border-color); padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-family: monospace;">$1</code>');
    
    // Handle line breaks
    processed = processed.replace(/\n/g, '<br>');
    
    return processed;
}

// Escape HTML for code blocks
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Add copy buttons to code blocks
function addCopyButtonsToCodeBlocks() {
    document.querySelectorAll('.code-block').forEach(block => {
        const copyButton = block.querySelector('.copy-button');
        const codeContent = block.querySelector('.code-content').textContent;
        
        copyButton.addEventListener('click', function() {
            copyCodeToClipboard(codeContent, this);
        });
    });
}

// Copy code to clipboard
async function copyCodeToClipboard(code, button) {
    try {
        await navigator.clipboard.writeText(code);
        
        const originalText = button.innerHTML;
        button.innerHTML = '<span>✅</span> Tersalin!';
        button.classList.add('copied');
        
        setTimeout(() => {
            button.innerHTML = originalText;
            button.classList.remove('copied');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy code:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = code;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        const originalText = button.innerHTML;
        button.innerHTML = '<span>✅</span> Tersalin!';
        button.classList.add('copied');
        
        setTimeout(() => {
            button.innerHTML = originalText;
            button.classList.remove('copied');
        }, 2000);
    }
}

// Show typing indicator
function showTypingIndicator() {
    typingIndicator.style.display = 'block';
    scrollToBottom();
}

// Hide typing indicator
function hideTypingIndicator() {
    typingIndicator.style.display = 'none';
}

// Scroll to bottom of chat
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Get current time
function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString('id-ID', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

// Load chat history
async function loadChatHistory(sessionId = null) {
    try {
        const url = sessionId ? `/api/chat-history?sessionId=${sessionId}` : '/api/chat-history';
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.chats && data.chats.length > 0) {
            displayChatHistory(data.chats);
            if (!sessionId) {
                currentSessionId = data.chats[0].sessionId;
            }
        } else {
            showWelcomeMessage();
        }
    } catch (error) {
        console.error('Error loading chat history:', error);
        showWelcomeMessage();
    }
}

// Display chat history
function displayChatHistory(chats) {
    chatMessages.innerHTML = '';
    
    chats.forEach(chat => {
        addMessageToChat(chat.message, chat.role);
    });
    
    scrollToBottom();
}

// Show welcome message
function showWelcomeMessage() {
    chatMessages.innerHTML = `
        <div class="welcome-message">
            <div class="welcome-title">Halo! Saya Elaina 🤍</div>
            <p>Saya di sini untuk membantu Anda. Silakan tanyakan apa saja!</p>
        </div>
    `;
}

// Toggle theme
function toggleTheme() {
    if (currentTheme === 'light') {
        currentTheme = 'dark';
        document.body.classList.add('dark-mode');
        themeToggle.innerHTML = '☀️';
    } else {
        currentTheme = 'light';
        document.body.classList.remove('dark-mode');
        themeToggle.innerHTML = '🌙';
    }
    localStorage.setItem('theme', currentTheme);
}

// Toggle music player
function toggleMusicPlayer() {
    musicPlayer.classList.toggle('active');
    if (musicPlayer.classList.contains('active') && !isMusicPlaying) {
        loadCurrentMusic();
    }
}

// Toggle music play/pause
function toggleMusic() {
    if (isMusicPlaying) {
        audio.pause();
        playPauseMusic.innerHTML = '▶️';
    } else {
        audio.play().catch(e => console.log('Audio play failed:', e));
        playPauseMusic.innerHTML = '⏸️';
    }
    isMusicPlaying = !isMusicPlaying;
}

// Play previous music
function playPreviousMusic() {
    currentMusicIndex = (currentMusicIndex - 1 + musicPlaylist.length) % musicPlaylist.length;
    loadCurrentMusic();
    if (isMusicPlaying) {
        audio.play().catch(e => console.log('Audio play failed:', e));
    }
}

// Play next music
function playNextMusic() {
    currentMusicIndex = (currentMusicIndex + 1) % musicPlaylist.length;
    loadCurrentMusic();
    if (isMusicPlaying) {
        audio.play().catch(e => console.log('Audio play failed:', e));
    }
}

// Load current music
function loadCurrentMusic() {
    const music = musicPlaylist[currentMusicIndex];
    audio.src = music.url;
    musicTitle.textContent = music.title;
    audio.load();
}

// Update music progress
function updateMusicProgress() {
    if (audio.duration) {
        const progress = (audio.currentTime / audio.duration) * 100;
        musicProgressBar.style.width = progress + '%';
    }
}

// Toggle panel visibility
function togglePanel(panel) {
    const isActive = panel.classList.contains('active');
    closeAllPanels();
    
    if (!isActive) {
        panel.classList.add('active');
        overlay.classList.add('active');
        
        if (panel === historyPanel) {
            loadSessions();
        }
    }
}

// Close all panels
function closeAllPanels() {
    historyPanel.classList.remove('active');
    contactPanel.classList.remove('active');
    overlay.classList.remove('active');
}

// Load sessions
async function loadSessions() {
    try {
        const response = await fetch('/api/sessions');
        const data = await response.json();
        
        if (data.sessions) {
            displaySessions(data.sessions);
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
    }
}

// Display sessions
function displaySessions(sessions) {
    historyContent.innerHTML = '';
    
    if (sessions.length === 0) {
        historyContent.innerHTML = '<div style="text-align: center; color: var(--text-light); padding: 2rem;">Belum ada riwayat chat</div>';
        return;
    }
    
    sessions.forEach(session => {
        const sessionElement = document.createElement('div');
        sessionElement.className = `session-item ${session._id === currentSessionId ? 'active' : ''}`;
        
        const date = new Date(session.lastMessage).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        sessionElement.innerHTML = `
            <div>Percakapan</div>
            <div class="session-date">${date}</div>
            <div style="font-size: 0.75rem; color: var(--text-light);">${session.messageCount} pesan</div>
        `;
        
        sessionElement.addEventListener('click', () => {
            loadChatHistory(session._id);
            hideHistoryPanel();
        });
        
        historyContent.appendChild(sessionElement);
    });
}

// Logout function
async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login.html';
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);

// Export functions for global access
window.copyCode = function(button) {
    const codeBlock = button.closest('.code-block');
    const codeContent = codeBlock.querySelector('.code-content').textContent;
    copyCodeToClipboard(codeContent, button);
};