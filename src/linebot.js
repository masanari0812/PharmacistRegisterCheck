import express from "express";
import dotenv from "dotenv";
import { Low, JSONFile } from "lowdb";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { messagingApi, middleware } from "@line/bot-sdk";
import { RegisterCheck, hasSpaceBetweenNames } from "./common.js";

const { MessagingApiClient } = messagingApi;

dotenv.config();

const app = express();
const PORT = process.env.LINE_PORT || 3000;
const INTERVAL =
    parseInt(process.env.LINE_INTERVAL_SEC) * 1000 || 60 * 60 * 1000;
// LINEのレスポンスをセーブモードにするか否か(デフォルトはtrue)
const SAVE_RESPONSE =
    process.env.LINE_SAVE_RESPONSE_MODE != undefined ? process.env.LINE : true;

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

// メッセージ処理
export async function parseMessage(userId, message) {
    await initDB();
    let user = db.data.users.find((u) => u.userId === userId);

    let name = message; // ← const から let に変更
    // 苗字と名前の間に空白が含まれているか
    if (hasSpaceBetweenNames(message)) {
        if (message.startsWith("+")) {
            const name = message.substring(1);
            addName(userId, name);
        } else if (message.startsWith("-")) {
            const name = message.substring(1);
            removeName(userId, name);
        } else {
            if (message.includes(`/`)) {
                const result = message.split("/");
                sendRegisterStatusMessage(userId, result[0], result[1]);
                console.log(`${result[0]}さん::${result[1]}`);
            }
            else {
                sendRegisterStatusMessage(userId, message);
            }
        }
    } else {
        sendMessage(userId, `苗字と名前の間にスペースがありません->${name}`);
    }

    await db.write();
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

// db名前追加・ユーザー登録の共通関数
export async function addName(userId, name) {
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
    sendMessage(user.userId, `${name}を登録しました`);
}

async function removeName(userId, name) {
    let user = db.data.users.find((u) => u.userId === userId);
    if (!user) return; // ユーザーがいなければ何もしない

    user.names = user.names.filter((n) => n.name !== name);
    await sendMessage(user.userId, `${name}を削除しました`);

    await db.write();
    if (user.names.length === 0) {
        db.data.users = db.data.users.filter((u) => u.userId !== user.userId);
        await db.write();
        await sendMessage(user.userId, `登録されている名前を全て削除しました`);
    }
}

// 登録状況メッセージ送信関数（ここで登録確認も削除も行う）
async function sendRegisterStatusMessage(userId, name, checkYear = undefined) {
    const isRegistered = await RegisterCheck(name, checkYear);
    if (isRegistered) {
        await sendMessage(
            userId,
            checkYear
                ? `${checkYear}に${name}さんは登録されています。`
                : `今年度、${name}さんは登録されています。`
        );
        if (!checkYear) {
            await removeName(userId, name);
        }
    } else {
        if (!SAVE_RESPONSE || checkYear) {
            await sendMessage(
                userId,
                checkYear
                    ? `${checkYear}に${name}さんは登録されていません。`
                    : `今年度はまだ${name}さんは登録されていません。`
            );
        }
    }
}

// 登録者チェック関数
async function periodicRegisterCheck() {
    console.log("db内の名簿チェック");
    await initDB();
    let users = db.data.users || [];
    for (const user of [...users]) {
        if (!user.names || user.names.length === 0) continue;
        for (const nameObj of [...user.names]) {
            await sendRegisterStatusMessage(user.userId, nameObj.name);
        }
    }
}

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

// Cronエンドポイント
app.get("/cron", async (req, res) => {
    try {
        await periodicRegisterCheck();
        res.sendStatus(200);
    } catch (err) {
        console.error("Cron error:", err);
        res.sendStatus(500);
    }
});

// サーバ起動
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
