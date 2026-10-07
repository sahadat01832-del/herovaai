# 🤖 ContentBot Dashboard

> Premium AI Control Panel & WhatsApp Business Automation Platform.  
> Built with **Next.js 14**, **Tailwind CSS**, **Node.js/Express**, **Socket.IO**, and **MongoDB**.

---

## ✨ Features Overview

### 1. 🔐 Admin Control Center
- **Full System Visibility**: Monitor total registered clients, active WhatsApp bots, and conversation statistics.
- **User Management**: Add, update, disable, or delete client accounts. Assign custom **ContentBot Agent API Keys** to users.
- **Global Chat Inspection**: View and monitor all conversations happening in real time between clients/public users and the AI.

### 2. 💬 Dual-Mode Chat (Local LLM & ContentBot API)
- **Local LLM via LM Studio**: Run local models hosted on your PC (`http://localhost:1234/v1`).
- **ContentBot API Key Integration**: Switch anytime to your existing ContentBot service using your agent keys.
- **LAN & Wi-Fi Ready**: Both you and devices on the same Wi-Fi network can access the web application.

### 3. 📱 WhatsApp DM Automation
- **Free & Open-Source Engine**: Powered by `@wppconnect-team/wppconnect`.
- **Instant QR Pairing**: Connect any WhatsApp number by scanning the live dynamic QR code directly in the dashboard.
- **AI Auto-Reply**: Incoming WhatsApp messages can be automatically answered by the AI on behalf of the owner.
- **Live Message Log & Manual DM**: View incoming messages and send manual replies straight from the browser.

### 4. 🧠 Business AI Memory & Context
- **Owner & Business Profile**: Define Owner Name, Company Name, Industry, and Services.
- **Persona & Tone Controls**: Set the AI's communication style (Professional, Friendly, Casual, Formal, Enthusiastic).
- **Custom Knowledge Base**: Add, edit, and delete specific memory items (e.g., pricing, opening hours, return policies, FAQs).
- **Auto-Injection**: The AI automatically uses this memory in both the dashboard chat and WhatsApp auto-replies.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** (v18+)
- **LM Studio** installed on your PC (start the local server on port `1234`)
- Optional: MongoDB (if not running, the backend includes an automated In-Memory MongoDB fallback)

### 2. One-Command Launch
In the root directory, simply run:

```bash
chmod +x start.sh
./start.sh
```

Or run services independently:

#### Backend:
```bash
cd backend
npm start
# Runs on http://0.0.0.0:5000
```

#### Frontend:
```bash
cd frontend
npm run dev
# Runs on http://0.0.0.0:3000
```

---

## 🔑 Default Admin Account

When you start the server for the first time, an administrator account is seeded automatically:

- **Email**: `admin@contentbot.local`
- **Password**: `Admin@123456`

*(You can change your password anytime under Settings).*

---

## 🌐 Local & LAN Wi-Fi Access

To access the dashboard from other devices (phones, laptops) on the same Wi-Fi network:

1. Find your PC's local IP address:
   ```bash
   hostname -I
   # Example: 192.168.1.15
   ```
2. Open on any device on the same Wi-Fi:
   ```
   http://192.168.1.15:3000
   ```

---

## 📁 Project Structure

```
contentbot-dashboard/
├── backend/
│   ├── src/
│   │   ├── config/passport.js       # JWT & Google OAuth auth strategies
│   │   ├── middleware/auth.js       # Token validation & Admin guard
│   │   ├── models/                  # User, Conversation, AIMemory, WhatsAppSession
│   │   ├── routes/                  # auth, admin, chat, memory, whatsapp, user
│   │   ├── services/
│   │   │   ├── socketService.js     # Real-time WebSocket events & rooms
│   │   │   └── wppConnectService.js # WhatsApp session management & AI replies
│   │   ├── utils/seed.js            # Initial admin seeder
│   │   └── index.js                 # Express server & MongoDB lifecycle
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── dashboard/
│   │   │   │   ├── admin/           # Users overview & chat inspector
│   │   │   │   ├── chat/            # Public chat with LM Studio / ContentBot
│   │   │   │   ├── memory/          # Business AI Memory manager
│   │   │   │   ├── whatsapp/        # WhatsApp QR & automation controls
│   │   │   │   ├── settings/        # API key & profile controls
│   │   │   │   ├── layout.tsx       # Glassmorphism sidebar & topbar
│   │   │   │   └── page.tsx         # Dashboard analytics & cards
│   │   │   ├── login/page.tsx       # Auth login (Email/PW + Google)
│   │   │   ├── register/page.tsx    # User registration
│   │   │   └── globals.css          # Dark glassmorphism styles & animations
│   │   ├── contexts/AuthContext.tsx # Global Auth context
│   │   └── lib/                     # api.ts, auth.ts
│   ├── tailwind.config.ts
│   └── package.json
├── start.sh                         # Master launch script
└── README.md
```
