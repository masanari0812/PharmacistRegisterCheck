import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { Low, JSONFile } from "lowdb";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

dotenv.config();

const app = express();
const PORT = process.env.LINE_PORT || 3000;

// ESモジュールでの __dirname 相当
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// lowdbの初期化
const dbFile = join(__dirname, "../data/linebot.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function initDB() {
    await db.read();
    db.data = db.data || { users: [] };
    await db.write();
}

// ユーザー登録（例: 名前とuserIdを保存）
export async function addUser(name, userId) {
    await initDB();
    let user = db.data.users.find((u) => u.userId === userId);
    if (!user) {
        user = { userId, name, messages: [] };
        db.data.users.push(user);
    } else {
        user.name = name; // 名前を更新
    }
    await db.write();
}

// メッセージ保存
export async function saveLineMessage(userId, message) {
    await initDB();
    let user = db.data.users.find((u) => u.userId === userId);
    if (!user) {
        user = { userId, name: "", messages: [] };
        db.data.users.push(user);
    }
    user.messages.push({
        text: message,
        timestamp: new Date().toISOString(),
    });
    await db.write();
}

// ユーザー登録＋メッセージ保存をまとめた関数
async function registerAndSaveMessage(name, userId) {
    await addUser(name, userId);
    await saveLineMessage(userId, name);
}

// LINEメッセージ送信
export async function sendMessage(userId, message) {
    const url = "https://api.line.me/v2/bot/message/push";
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    };
    const body = {
        to: userId,
        messages: [
            {
                type: "text",
                text: message,
            },
        ],
    };

    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error("LINE sendMessage error:", res.status, errText);
        throw new Error(`LINE sendMessage failed: ${res.status}`);
    }
}

// LINE Webhook エンドポイント
app.post("/webhook", express.json(), async (req, res) => {
    const events = req.body.events || [];
    for (const ev of events) {
        if (ev.type === "message" && ev.message.type === "text") {
            const name = ev.message.text.trim();
            const userId = ev.source.userId;
            try {
                await registerAndSaveMessage(name, userId);
                await sendMessage(userId, "登録できました");
            } catch (e) {
                console.error("registerAndSaveMessage error:", e);
                await sendMessage(userId, "登録に失敗しました");
            }
        }
    }
    res.sendStatus(200);
});

// サーバ起動
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
