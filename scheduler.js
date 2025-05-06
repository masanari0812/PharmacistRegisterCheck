import fs from "fs";
import iconv from "iconv-lite";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { Low, JSONFile } from "lowdb";
import { Client } from "@line/bot-sdk";

dotenv.config();

// LINE BOTクライアント初期化
const client = new Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

// DB初期化
const adapter = new JSONFile("db.json");
export const db = new Low(adapter);

// DBを初期化する関数
export async function initDB() {
  await db.read();
  db.data ||= { users: [] };
  // DB初期化ログ
  console.log("DB initialized");
}

// ユーザー追加
export async function addUser(name, userId) {
  await initDB();
  db.data.users.push({ name, userId, checked: false });
  await db.write();
  console.log(`addUser: ${name} (${userId})`);
}

// LINEメッセージ送信
export async function sendMessage(userId, text) {
  try {
    await client.pushMessage(userId, { type: "text", text });
    console.log(`Sent to ${userId}: ${text}`);
  } catch (err) {
    console.error("sendMessage error:", err);
  }
}

// expireKey取得
export async function getExpireKey() {
  const res = await fetch("https://licenseif.mhlw.go.jp/search_iyaku/top.jsp", {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
  });
  const buf = await res.arrayBuffer();
  const html = iconv.decode(Buffer.from(buf), "CP932");
  const m = html.match(/<input[^>]*name="expireKey"[^>]*value="([^"]+)"[^>]*>/i);
  if (!m) {
    console.error("expireKeyが見つかりませんでした");
    throw new Error("expireKeyが見つかりませんでした");
  }
  // expireKey取得ログ
  console.log("expireKey取得成功");
  return m[1];
}

// 登録チェック
export async function CheckRegister(name) {
  try {
    // 和暦取得
    const parts = new Intl.DateTimeFormat("ja-JP-u-ca-japanese", {
      era: "long",
      year: "numeric",
    }).formatToParts(new Date());
    const era = parts.find((p) => p.type === "era")?.value ?? "";
    const year = parts.find((p) => p.type === "year")?.value ?? "";
    const checkYear = `${era}${year}年`;

    const gender = "1";
    const expireKey = await getExpireKey();

    // 名前をShift_JISでエンコード
    const nameBuf = iconv.encode(name, "shift_jis");
    const encodedName = Array.from(nameBuf)
      .map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0"))
      .join("");

    const params = [
      ["seibetu", gender],
      ["name", encodedName],
      ["expireKey", expireKey],
    ];
    const formStr = params.map(([k, v]) => `${k}=${v}`).join("&");
    const body = iconv.encode(formStr, "CP932");

    // POSTリクエスト送信
    const res2 = await fetch("https://licenseif.mhlw.go.jp/search_iyaku/search.do", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=Windows-31J",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      body,
    });
    const buf2 = await res2.arrayBuffer();
    const html2 = iconv.decode(Buffer.from(buf2), "CP932");

    // 年度抽出
    const years = [];
    const re = /<td[^>]*class="REGISTRATION_TD"[^>]*>([^<]+)<\/td>/g;
    let mm;
    while ((mm = re.exec(html2)) !== null) {
      years.push(mm[1].trim());
    }
    // チェック結果ログ
    console.log(`CheckRegister: ${name} => ${years.includes(checkYear) ? "登録あり" : "登録なし"}`);
    return years.includes(checkYear);
  } catch (err) {
    console.error("CheckRegister error:", err);
    return false;
  }
}

// 定期実行スケジューラ
export async function runScheduler() {
  await initDB();
  const INTERVAL = 60 * 60 * 1000;
  console.log(`Scheduler started (interval=${INTERVAL}ms)`);
  setInterval(async () => {
    await initDB();
    // 区切りログ
    console.log("=== スケジューラ実行開始 ===");
    for (const user of db.data.users) {
      if (!user.checked) {
        const exists = await CheckRegister(user.name);
        if (exists) {
          await sendMessage(user.userId, `${user.name}さんは登録されています`);
          user.checked = true;
          await db.write();
          // ユーザー登録済みログ
          console.log(`ユーザー${user.name}（${user.userId}）を登録済みに更新`);
        } else {
          // 未登録ユーザーログ
          console.warn(`ユーザー${user.name}（${user.userId}）は未登録`);
        }
      }
    }
    console.log("=== スケジューラ実行終了 ===");
  }, INTERVAL);
}

// あまり使われない関数例（ダミー）
export function rarelyUsedFunction() {
  // ここはあまり使われません
  console.log("rarelyUsedFunctionが呼ばれました");
  return "rarely used";
}

// ファイルが直接実行された場合のみスケジューラ起動
if (import.meta.url.endsWith("scheduler.js")) {
  runScheduler();
}