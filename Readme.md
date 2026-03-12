# 📡 Telegram Scheduler Bot

Send scheduled messages to your Telegram channels & groups automatically.

---

## ⚡ Setup (5 minutes)

### 1. Get a Bot Token
1. Open Telegram → search **@BotFather**
2. Send `/newbot` and follow the steps
3. Copy the token you receive

### 2. Add Bot to Your Channel/Group
- For **channels**: Go to channel → Admins → Add your bot as admin (needs "Post Messages" permission)
- For **groups**: Add the bot to the group → make it admin

### 3. Get Your Chat ID
- For channels: use `@your_channel_username` directly
- For groups/private channels: use [@userinfobot](https://t.me/userinfobot) — forward a message from your group to it

### 4. Configure the Bot
Open `index.js` and edit the `SCHEDULES` array:

```js
const SCHEDULES = [
  {
    name: "Morning Promo",         // any name you want
    chatId: "@your_channel",       // channel username or numeric group ID
    message: "Your message here",  // supports Markdown formatting
    intervalMinutes: 60,           // send every 60 minutes
  },
];
```

### 5. Install & Run
```bash
npm install
npm start
```

---

## 🎮 Bot Commands
Send these in a private chat with your bot:

| Command | Action |
|---|---|
| `/status` | See all active schedules |
| `/stop Morning Promo` | Stop a specific schedule |
| `/restart Morning Promo` | Restart a stopped schedule |
| `/ping` | Check if bot is alive |

---

## 📝 Message Formatting (Markdown)
```
*bold text*
_italic text_
`code`
[link text](https://example.com)
```

---

## 🚀 Run 24/7 (Deploy)
Use **Railway**, **Render**, or **a VPS** to keep it running always.
- Railway: https://railway.app (free tier available)
- Just push this folder and set `BOT_TOKEN` as an environment variable