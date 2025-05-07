import dotenv from "dotenv";
import fetch from "node-fetch";
import { CheckRegister } from "./common.js";

dotenv.config();

const nameToCheck = process.env.CHECK_NAME;
const webhookUrl = process.env.SLACK_WEBHOOK_URL;
const INTERVAL =
    parseInt(process.env.SLACK_INTERVAL_SEC) * 1000 || 60 * 60 * 1000;

if (!nameToCheck) {
    console.error("ERROR: 環境変数 CHECK_NAME が設定されていません");
    process.exit(1);
}
if (!webhookUrl) {
    console.error("ERROR: 環境変数 SLACK_WEBHOOK_URL が設定されていません");
    process.exit(1);
}

console.log(`=== SlackBot Scheduler Started for ${nameToCheck} ===`);

async function checkAndNotify() {
    try {
        console.log(`--- ${nameToCheck} の登録チェック ---`);
        const exists = await CheckRegister(nameToCheck);
        const text = exists
            ? `${nameToCheck}さんは登録されています 🎉`
            : `${nameToCheck}さんは未登録です ⚠️`;
        const message = { text };

        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
        });
        const resText = await res.text(); // Slack Webhookは"text"レスポンス
        console.log("Slack 通知成功:", resText);
    } catch (err) {
        console.error("SlackBot エラー:", err);
    }
}

// 即時実行 & 定期実行
checkAndNotify();
setInterval(checkAndNotify, INTERVAL);
