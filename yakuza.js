const fs = require("fs");
const iconv = require("iconv-lite");
const Encoding = require("encoding-japanese");

// expireKeyを取得する関数
async function getExpireKey() {
    const response = await fetch(
        "https://licenseif.mhlw.go.jp/search_iyaku/top.jsp",
        {
            headers: {
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
        }
    );
    const responseBuffer = await response.arrayBuffer();
    const html = iconv.decode(Buffer.from(responseBuffer), "CP932");

    // expireKeyを抽出（より厳密な正規表現）
    const match = html.match(
        /<input[^>]*name="expireKey"[^>]*value="([^"]+)"[^>]*>/i
    );
    if (!match) {
        throw new Error("expireKeyが見つかりませんでした");
    }
    const expireKey = match[1];
    console.log("取得したexpireKey:", expireKey);
    return expireKey;
}

// メインの処理
async function main() {
    try {
        // expireKeyを取得
        const expireKey = await getExpireKey();

        const name = "岩永 徹也";
        const nameBuffer = iconv.encode(name, "shift_jis");

        const encodedName = Array.from(nameBuffer)
            .map(
                (byte) => "%" + byte.toString(16).toUpperCase().padStart(2, "0")
            )
            .join("");

        // スペース (0x20) を '+' に変換
        // encodedName = encodedName.replace(/%20/g, "+");

        console.log(encodedName); // => %8A%E2%89i+%93O%96%E7

        // パラメータを配列で定義
        const params = [
            ["seibetu", "1"], // 1=男性, 2=女性, 3=指定なし
            ["name", encodedName],
            ["expireKey", expireKey],
        ];

        // 手動でフォームデータを構築
        const formDataString = params
            .map(([key, value]) => `${key}=${value}`)
            .join("&");

        // Shift-JISにエンコード
        const encodedBody = iconv.encode(formDataString, "CP932");

        // 検索リクエストを送信
        const response = await fetch(
            "https://licenseif.mhlw.go.jp/search_iyaku/search.do",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=Windows-31J",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                },
                body: encodedBody,
            }
        );

        const responseBuffer = await response.arrayBuffer();
        const html = iconv.decode(Buffer.from(responseBuffer), "CP932");
        const modifiedHtml = html.replace(
            "charset=Windows-31J",
            "charset=UTF-8"
        );
        fs.writeFileSync("result.html", modifiedHtml, "utf8");
        console.log("結果を result.html に保存しました");
    } catch (error) {
        console.error("エラーが発生しました:", error);
    }
}

main();
