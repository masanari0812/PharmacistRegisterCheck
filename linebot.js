import express from "express";
import dotenv from "dotenv";
import { addUser, sendMessage, runScheduler } from "./common.js";

dotenv.config();
const app = express();

// LINE Webhook エンドポイント
app.post("/webhook", express.json(), async (req, res) => {
  const events = req.body.events || [];
  for (const ev of events) {
    if (ev.type === "message" && ev.message.type === "text") {
      const name   = ev.message.text.trim();
      const userId = ev.source.userId;
      try {
        await addUser(name, userId);
        await sendMessage(userId, "登録できました");
      } catch (e) {
        console.error("addUser error:", e);
        await sendMessage(userId, "登録に失敗しました");
      }
    }
  }
  res.sendStatus(200);
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// 定期チェック機能も起動
runScheduler();