import express from "express";
import dotenv from "dotenv";
import { Low, JSONFile } from "lowdb";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { messagingApi, middleware } from "@line/bot-sdk";
import { RegisterCheck } from "./common.js";

const { MessagingApiClient } = messagingApi;

dotenv.config();

const app = express();
const PORT = process.env.LINE_PORT || 3000;
const INTERVAL =
    parseInt(process.env.LINE_INTERVAL_SEC) * 1000 || 60 * 60 * 1000;

// ESモジュールでの __dirname 相当
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// lowdbの初期化
const dbFile = join(__dirname, "../data/linebot.json");
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new MessagingApiClient(config);
app.use("/linebot", middleware(config));
app.use(express.json());

async function initDB() {
    await db.read();
    db.data = db.data || { users: [] };
    // 既存データの移行（name→names配列）
    for (const user of db.data.users) {
        if (!user.names && user.name) {
            user.names = [
                {
                    name: user.name,
                    timeStamp: user.timeStamp || new Date().toISOString(),
                },
            ];
            delete user.name;
            delete user.timeStamp;
        }
    }
    await db.write();
}

// ユーザー登録（例:userIdをdb保存）
export async function addUser(name, userId) {
    await initDB();
    let user = db.data.users.find((u) => u.userId === userId);
    const now = new Date().toISOString();
    if (!user) {
        user = { userId, names: [{ name, timeStamp: now }] };
        db.data.users.push(user);
    } else {
        if (!user.names) user.names = [];
        if (!user.names.some((n) => n.name === name)) {
            user.names.push({ name, timeStamp: now });
        } else {
            user.names = user.names.map((n) =>
                n.name === name ? { ...n, timeStamp: now } : n
            );
        }
    }
    await db.write();
}

// メッセージ処理
export async function parseMessage(userId, message) {
    await initDB();
    let user = db.data.users.find((u) => u.userId === userId);

    const name = message;
    // 苗字と名前の間に空白が含まれているか
    const regex = /(?<=\S)[\u0020\u3000]+(?=\S)/;
    if (regex.test(name)) {
        const now = new Date().toISOString();
        if (!user) {
            user = {
                userId: userId,
                names: [{ name, timeStamp: now }],
            };
            db.data.users.push(user);
        } else {
            if (!user.names) user.names = [];
            if (!user.names.some((n) => n.name === name)) {
                user.names.push({ name, timeStamp: now });
            } else {
                user.names = user.names.map((n) =>
                    n.name === name ? { ...n, timeStamp: now } : n
                );
            }
        }
        sendMessage(user.userId, `${name}を登録しました`);
    } else {
        sendMessage(userId, `文字と文字の間にスペースがありません->${name}`);
    }

    await db.write();
}

// ユーザー登録＋メッセージ保存をまとめた関数
async function registerAndSaveMessage(userId, message) {
    await parseMessage(userId, message);
}

// LINEメッセージ送信
export async function sendMessage(userId, message) {
    try {
        await client.pushMessage({
            to: userId,
            messages: [{ type: "text", text: message }],
        });
        console.log(`sent->${userId}:${message}`);
    } catch (err) {
        console.error(`fail->${userId}:${message}`, err);
    }
}

// 定期チェック関数
async function periodicRegisterCheck() {
    await initDB();
    let users = db.data.users || [];
    for (const user of [...users]) {
        if (!user.names || user.names.length === 0) continue;
        for (const nameObj of [...user.names]) {
            const isRegistered = await RegisterCheck(nameObj.name);
            if (isRegistered) {
                await sendMessage(
                    user.userId,
                    `${nameObj.name}さんは登録されています。データベースから削除します。`
                );
                // 名前だけ削除
                user.names = user.names.filter((n) => n.name !== nameObj.name);
                await db.write();
            } else {
                await sendMessage(
                    user.userId,
                    `${nameObj.name}さんは登録されていません`
                );
            }
        }
        // 名前リストが空になったらユーザー自体も削除
        if (user.names.length === 0) {
            db.data.users = db.data.users.filter(
                (u) => u.userId !== user.userId
            );
            await db.write();
        }
    }
}

// 10分ごとに実行（600000ミリ秒）

// LINE Webhook エンドポイント
app.post("/linebot", express.json(), async (req, res) => {
    const events = req.body.events || [];
    for (const ev of events) {
        if (ev.type === "message" && ev.message.type === "text") {
            const userId = ev.source.userId;
            const message = ev.message.text.trim();
            try {
                await parseMessage(userId, message);
            } catch (err) {
                console.error("parseMessage error:", err);
                await sendMessage(userId, "登録に失敗しました");
            }
        }
    }
    res.sendStatus(200);
});

setInterval(periodicRegisterCheck, INTERVAL);

// サーバ起動
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
