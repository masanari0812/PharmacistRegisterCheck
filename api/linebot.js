import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { messagingApi } from "@line/bot-sdk";
import { RegisterCheck, hasSpaceBetweenNames } from "../src/common.js";

const { MessagingApiClient } = messagingApi;

dotenv.config();

const INTERVAL =
    parseInt(process.env.LINE_INTERVAL_SEC) * 1000 || 60 * 60 * 1000;
const SAVE_RESPONSE =
    process.env.LINE_SAVE_RESPONSE_MODE != undefined ? process.env.LINE : true;

// Supabaseクライアントの初期化
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new MessagingApiClient(config);

// メッセージ処理
async function parseMessage(userId, message) {
    let name = message;

    if (hasSpaceBetweenNames(message)) {
        if (message.startsWith("+")) {
            const name = message.substring(1);
            await addName(userId, name);
        } else if (message.startsWith("-")) {
            const name = message.substring(1);
            await removeName(userId, name);
        } else {
            if (message.includes(`/`)) {
                const result = message.split("/");
                await sendRegisterStatusMessage(userId, result[0], result[1]);
                console.log(`${result[0]}さん::${result[1]}`);
            } else {
                await sendRegisterStatusMessage(userId, message);
            }
        }
    } else {
        await sendMessage(
            userId,
            `苗字と名前の間にスペースがありません->${name}`
        );
    }
}

// LINEメッセージ送信
async function sendMessage(userId, message) {
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

// 名前追加・ユーザー登録の共通関数
async function addName(userId, name) {
    try {
        // ユーザーの存在確認と作成
        const { data: user, error: userError } = await supabase
            .from("users")
            .upsert({ user_id: userId })
            .select()
            .single();

        if (userError) throw userError;

        // 名前の追加
        const { error: nameError } = await supabase.from("names").upsert({
            user_id: user.id,
            name: name,
            time_stamp: new Date().toISOString(),
        });

        if (nameError) throw nameError;

        await sendMessage(userId, `${name}を登録しました`);
    } catch (err) {
        console.error("Error adding name:", err);
        await sendMessage(userId, "登録に失敗しました");
    }
}

async function removeName(userId, name) {
    try {
        // ユーザーIDの取得
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id")
            .eq("user_id", userId)
            .single();

        if (userError) throw userError;

        // 名前の削除
        const { error: deleteError } = await supabase
            .from("names")
            .delete()
            .eq("user_id", user.id)
            .eq("name", name);

        if (deleteError) throw deleteError;

        await sendMessage(userId, `${name}を削除しました`);

        // ユーザーの名前が全て削除されたか確認
        const { data: remainingNames, error: countError } = await supabase
            .from("names")
            .select("id")
            .eq("user_id", user.id);

        if (countError) throw countError;

        if (remainingNames.length === 0) {
            // ユーザーの削除
            const { error: userDeleteError } = await supabase
                .from("users")
                .delete()
                .eq("id", user.id);

            if (userDeleteError) throw userDeleteError;
            await sendMessage(userId, `登録されている名前を全て削除しました`);
        }
    } catch (err) {
        console.error("Error removing name:", err);
        await sendMessage(userId, "削除に失敗しました");
    }
}

// 登録状況メッセージ送信関数
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
    try {
        const { data: users, error: usersError } = await supabase.from("users")
            .select(`
                user_id,
                names (
                    name
                )
            `);

        if (usersError) throw usersError;

        for (const user of users) {
            if (!user.names || user.names.length === 0) continue;
            for (const nameObj of user.names) {
                await sendRegisterStatusMessage(user.user_id, nameObj.name);
            }
        }
    } catch (err) {
        console.error("Error in periodic check:", err);
    }
}

// Serverless Functions用のエンドポイント
export default async function handler(req, res) {
    if (req.method === "POST" && req.url === "/webhook") {
        const events = req.body.events || [];
        for (const ev of events) {
            if (ev.type === "message" && ev.message.type === "text") {
                const userId = ev.source.userId;
                const message = ev.message.text.trim();
                console.log(`${userId}::${message}`);
                try {
                    await parseMessage(userId, message);
                } catch (err) {
                    console.error("parseMessage error:", err);
                    await sendMessage(userId, "登録に失敗しました");
                }
            }
        }
        res.status(200).end();
    } else if (req.method === "GET" && req.url === "/cron") {
        try {
            await periodicRegisterCheck();
            res.status(200).end();
        } catch (err) {
            console.error("Cron error:", err);
            res.status(500).end();
        }
    } else if (req.method === "GET" && req.url === "/test") {
        console.log("connect_check");
        res.status(200).send(`
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <meta charset="UTF-8">
                <title>LINE Bot 接続確認</title>
            </head>
            <body>
                <h1>LINE Bot 接続確認</h1>
                <p>このページはLINE Botの接続テスト用です。</p>
            </body>
            </html>
        `);
    } else {
        res.status(404).send(`
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <meta charset="UTF-8">
                <title>404 Not Found</title>
            </head>
            <body>
                <h1>404 Not Found</h1>
                <p>お探しのページは見つかりませんでした。</p>
            </body>
            </html>
        `);
    }
}
