import iconv from "iconv-lite";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

/**
 * expireKey を取得する
 */
export async function getExpireKey() {
    const res = await fetch(
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
    const buf = await res.arrayBuffer();
    const html = iconv.decode(Buffer.from(buf), "CP932");
    const m = html.match(
        /<input[^>]*name="expireKey"[^>]*value="([^"]+)"[^>]*>/i
    );
    if (!m) {
        console.error("expireKeyが見つかりませんでした");
        throw new Error("expireKeyが見つかりませんでした");
    }
    console.log("expireKey取得成功");
    return m[1];
}

/**
 * 苗字と名前の間に空白が含まれているか判定する
 * @param {string} name
 * @returns {boolean}
 */
export function hasSpaceBetweenNames(name) {
    // 半角スペースまたは全角スペースが1つ以上、かつ両端が文字
    const regex = /(?<=\S)[\u0020\u3000]+(?=\S)/;
    return regex.test(name);
}

/**
 * 指定した名前の登録有無をチェックして boolean を返す
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function RegisterCheck(name, checkYear = undefined) {
    try {
        // 現在の和暦年を「令和○年」の形式で取得
        if (!checkYear) {
            const parts = new Intl.DateTimeFormat("ja-JP-u-ca-japanese", {
                era: "long",
                year: "numeric",
            }).formatToParts(new Date());
            const era = parts.find((p) => p.type === "era")?.value ?? "";
            const year = parts.find((p) => p.type === "year")?.value ?? "";
            checkYear = `${era}${year}年`;
        }
        const expireKey = await getExpireKey();
        const gender = "3";
        // 名前を Shift_JIS でエンコードして URL エンコード文字列に
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

        const res2 = await fetch(
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
                body,
            }
        );
        const buf2 = await res2.arrayBuffer();
        const html2 = iconv.decode(Buffer.from(buf2), "CP932");

        // 「REGISTRATION_TD」セルから年度を抽出
        const years = [];
        const re = /<td[^>]*class="REGISTRATION_TD"[^>]*>([^<]+)<\/td>/g;
        let mm;
        while ((mm = re.exec(html2)) !== null) {
            years.push(mm[1].trim());
        }

        const exists = years.includes(checkYear);
        console.log(
            `CheckRegister: ${checkYear}に${name}は${
                exists ? "登録されています" : "登録されていません"
            }`
        );
        return exists;
    } catch (err) {
        console.error("CheckRegister error:", err);
        return false;
    }
}

// common.js を単体実行したときのエントリポイント
// if (require.main === module) {
//     const name = process.env.CHECK_NAME;
//     if (!name) {
//         console.error("ERROR: 環境変数 CHECK_NAME が設定されていません");
//         process.exit(1);
//     }
//     (async () => {
//         const exists = await CheckRegister(name);
//         process.exit(exists ? 0 : 1);
//     })();
// }
