require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// Validate env
// ─────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null;

if (!BOT_TOKEN) {
  console.error("[FATAL] BOT_TOKEN is missing in .env");
  process.exit(1);
}
if (!OWNER_ID) {
  console.warn("[WARN] OWNER_ID not set in .env — all users can control this bot!");
}

// ─────────────────────────────────────────────
// Defaults (override via commands)
// ─────────────────────────────────────────────
const DEFAULT_MESSAGE = `📢 *Broadcast Message*\n\nThis is an automatic message.\nDM the bot and use /setmessage to change it.`;
const DEFAULT_INTERVAL_MINUTES = 60;
const STATE_FILE = path.join(__dirname, "state.json");

// ─────────────────────────────────────────────
// State — persisted to state.json
// ─────────────────────────────────────────────
let broadcastMessage = DEFAULT_MESSAGE;
let broadcastIntervalMs = DEFAULT_INTERVAL_MINUTES * 60 * 1000;
// activeChannels in memory: { chatId -> { title, intervalId } }
const activeChannels = {};

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data.message) broadcastMessage = data.message;
    if (data.intervalMs) broadcastIntervalMs = data.intervalMs;
    // Channels are restarted below after bot is ready
    return data.channels || {};
  } catch (e) {
    console.error("[WARN] Could not load state.json:", e.message);
    return {};
  }
}

function saveState() {
  const data = {
    message: broadcastMessage,
    intervalMs: broadcastIntervalMs,
    channels: Object.entries(activeChannels).reduce((acc, [id, { title }]) => {
      acc[id] = { title };
      return acc;
    }, {}),
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[WARN] Could not save state.json:", e.message);
  }
}

// ─────────────────────────────────────────────
// Bot init
// ─────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    params: {
      allowed_updates: ["message", "my_chat_member", "channel_post"],
    },
  },
});

// ─────────────────────────────────────────────
// Broadcast helpers
// ─────────────────────────────────────────────
function startBroadcast(chatId, title, sendImmediately = true) {
  // Clear any existing interval for this chat first
  if (activeChannels[chatId]) {
    clearInterval(activeChannels[chatId].intervalId);
  }

  if (sendImmediately) sendToChannel(chatId, title);

  const intervalId = setInterval(() => sendToChannel(chatId, title), broadcastIntervalMs);
  activeChannels[chatId] = { title, intervalId };
  saveState();
}

function stopBroadcast(chatId) {
  if (activeChannels[chatId]) {
    clearInterval(activeChannels[chatId].intervalId);
    delete activeChannels[chatId];
    saveState();
  }
}

function sendToChannel(chatId, title) {
  bot
    .sendMessage(chatId, broadcastMessage, { parse_mode: "Markdown" })
    .then(() => {
      console.log(`[${timestamp()}] Sent → "${title}" (${chatId})`);
    })
    .catch((err) => {
      const code = err.response && err.response.body && err.response.body.error_code;
      console.error(`[${timestamp()}] Failed → "${title}" (${chatId}): ${err.message}`);
      // 403 = bot was kicked/blocked, 400 = chat not found → auto-remove
      if (code === 403 || code === 400) {
        console.log(`[AUTO-REMOVE] Removing "${title}" from active channels.`);
        stopBroadcast(chatId);
      }
    });
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

// ─────────────────────────────────────────────
// Conversation state for /setmessage flow
// awaitingMessage: Set of user IDs waiting to send new message
// ─────────────────────────────────────────────
const awaitingMessage = new Set();

// ─────────────────────────────────────────────
// Owner guard
// ─────────────────────────────────────────────
function isOwner(msg) {
  if (!OWNER_ID) return true; // No restriction if OWNER_ID not configured
  return msg.from && msg.from.id === OWNER_ID;
}

function rejectUnauthorized(msg) {
  bot.sendMessage(msg.chat.id, "⛔ You are not authorized to use this bot.");
}

// ─────────────────────────────────────────────
// Auto-detect: bot added / removed from a channel
// ─────────────────────────────────────────────
bot.on("my_chat_member", (update) => {
  const { chat, new_chat_member } = update;
  const status = new_chat_member.status;
  const chatId = String(chat.id);
  const title = chat.title || chat.username || chatId;

  if (status === "administrator" || status === "member") {
    if (!activeChannels[chatId]) {
      console.log(`[JOINED] "${title}" (${chatId})`);
      startBroadcast(chatId, title);
    }
  } else if (status === "left" || status === "kicked") {
    if (activeChannels[chatId]) {
      stopBroadcast(chatId);
      console.log(`[LEFT] "${title}" (${chatId})`);
    }
  }
});

// ─────────────────────────────────────────────
// Message handler — handles both commands and the setmessage flow
// ─────────────────────────────────────────────
bot.on("message", (msg) => {
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // ── /setmessage two-step flow ──
  if (awaitingMessage.has(chatId)) {
    if (text.startsWith("/")) {
      // User cancelled by sending another command — fall through to command handlers
      awaitingMessage.delete(chatId);
    } else {
      awaitingMessage.delete(chatId);
      broadcastMessage = text;
      saveState();
      bot.sendMessage(
        chatId,
        `✅ *Broadcast message updated!*\n\nPreview:\n\n${broadcastMessage}`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  // ── Commands ──
  if (text === "/start" || text.startsWith("/start ")) {
    bot.sendMessage(
      chatId,
      `👋 *Broadcast Bot*\n\n` +
        `Add me as an *admin* to any channel — I will automatically start broadcasting there.\n\n` +
        `*Commands:*\n` +
        `/channels — list active channels\n` +
        `/setmessage — set broadcast message (supports multiline)\n` +
        `/viewmessage — see current broadcast message\n` +
        `/setinterval <minutes> — change broadcast interval\n` +
        `/sendnow — send to all channels immediately\n` +
        `/stop <chatId> — pause a channel\n` +
        `/ping — check bot is alive`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (text === "/ping") {
    bot.sendMessage(chatId, "🏓 Pong! Bot is alive.");
    return;
  }

  if (text === "/channels") {
    if (!isOwner(msg)) return rejectUnauthorized(msg);
    const keys = Object.keys(activeChannels);
    if (keys.length === 0) {
      bot.sendMessage(chatId, "📭 No active channels. Add me as admin to a channel to start.");
      return;
    }
    const intervalMin = broadcastIntervalMs / 60000;
    const lines = keys.map(
      (id) => `• *${escapeMarkdown(activeChannels[id].title)}* — \`${id}\` — every ${intervalMin}min`
    );
    bot.sendMessage(chatId, `📋 *Active channels (${keys.length}):*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (text === "/setmessage") {
    if (!isOwner(msg)) return rejectUnauthorized(msg);
    awaitingMessage.add(chatId);
    bot.sendMessage(
      chatId,
      `✏️ Send me the new broadcast message now.\n\n_Supports multiline — just send it normally. Send any command to cancel._`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (text === "/viewmessage") {
    if (!isOwner(msg)) return rejectUnauthorized(msg);
    bot.sendMessage(chatId, `📄 *Current broadcast message:*\n\n${broadcastMessage}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (text.startsWith("/setinterval")) {
    if (!isOwner(msg)) return rejectUnauthorized(msg);
    const parts = text.split(" ");
    const minutes = parseInt(parts[1], 10);
    if (!minutes || minutes < 1) {
      bot.sendMessage(chatId, "❌ Usage: `/setinterval <minutes>`\nExample: `/setinterval 30`", {
        parse_mode: "Markdown",
      });
      return;
    }
    broadcastIntervalMs = minutes * 60 * 1000;
    // Restart all active channels with new interval (don't send immediately)
    const snapshot = Object.entries(activeChannels).map(([id, { title }]) => ({ id, title }));
    snapshot.forEach(({ id, title }) => startBroadcast(id, title, false));
    saveState();
    bot.sendMessage(
      chatId,
      `✅ Interval set to *${minutes} minutes*. ${snapshot.length} channel(s) updated.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (text === "/sendnow") {
    if (!isOwner(msg)) return rejectUnauthorized(msg);
    const keys = Object.keys(activeChannels);
    if (keys.length === 0) {
      bot.sendMessage(chatId, "📭 No active channels to send to.");
      return;
    }
    keys.forEach((id) => sendToChannel(id, activeChannels[id].title));
    bot.sendMessage(chatId, `📤 Sending to ${keys.length} channel(s).`);
    return;
  }

  if (text.startsWith("/stop")) {
    if (!isOwner(msg)) return rejectUnauthorized(msg);
    const parts = text.split(" ");
    const targetId = parts[1] && parts[1].trim();
    if (!targetId) {
      bot.sendMessage(chatId, "❌ Usage: `/stop <chatId>`", { parse_mode: "Markdown" });
      return;
    }
    if (activeChannels[targetId]) {
      const title = activeChannels[targetId].title;
      stopBroadcast(targetId);
      bot.sendMessage(chatId, `⏹ Stopped broadcasting to *${escapeMarkdown(title)}*`, {
        parse_mode: "Markdown",
      });
    } else {
      bot.sendMessage(chatId, `❓ No active broadcast for: \`${targetId}\``, {
        parse_mode: "Markdown",
      });
    }
    return;
  }
});

// ─────────────────────────────────────────────
// Polling error recovery
// ─────────────────────────────────────────────
bot.on("polling_error", (err) => {
  console.error(`[POLLING ERROR] ${err.message}`);
});

bot.on("error", (err) => {
  console.error(`[BOT ERROR] ${err.message}`);
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

// ─────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  saveState();
  Object.keys(activeChannels).forEach((id) => clearInterval(activeChannels[id].intervalId));
  bot.stopPolling().then(() => {
    console.log("[DONE] Bot stopped.");
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ─────────────────────────────────────────────
// Startup — restore persisted channels
// ─────────────────────────────────────────────
const savedChannels = loadState();
const savedCount = Object.keys(savedChannels).length;
if (savedCount > 0) {
  console.log(`[RESTORE] Restoring ${savedCount} channel(s) from state.json...`);
  Object.entries(savedChannels).forEach(([chatId, { title }]) => {
    startBroadcast(chatId, title, false); // don't spam on restart
    console.log(`  ↳ Restored "${title}" (${chatId})`);
  });
}

console.log(`[START] Broadcast Bot is running.`);
console.log(`[INFO]  Add the bot as admin to any channel to begin broadcasting.`);
if (OWNER_ID) console.log(`[INFO]  Owner: ${OWNER_ID}`);
