const https = require("https");
const http = require("http");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const NITTER_INSTANCES = [
  "nitter.privacydev.net",
  "nitter.poast.org",
  "nitter.1d4.us"
];

let currentInstance = 0;
const seenTweets = new Set();

const SEARCH_QUERIES = [
  "stealth launch crypto",
  "CA dropping soon",
  "fair launch token",
  "just launched sol",
  "liquidity added sol",
  "pumpfun launch"
];

let currentQuery = 0;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, data: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

async function sendTelegram(message) {
  try {
    const url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
    const postData = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message });
    
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  } catch (err) {
    console.log("Telegram error:", err.message);
  }
}

function extractProfileLinks(text) {
  const profiles = [];
  const regex = /https?:\/\/(twitter\.com|x\.com)\/([a-zA-Z0-9_]+)(?!\/(status|i|search|hashtag))/gi;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const username = match[2];
    if (username.length > 1 && username.length < 20) {
      profiles.push("https://x.com/" + username);
    }
  }
  
  return [...new Set(profiles)];
}

function parseTweets(html) {
  const tweets = [];
  const tweetRegex = /<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const linkRegex = /<a class="tweet-link"[^>]*href="([^"]+)"/gi;
  
  const texts = [];
  let textMatch;
  while ((textMatch = tweetRegex.exec(html)) !== null) {
    let text = textMatch[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    texts.push(text);
  }
  
  const links = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    links.push(linkMatch[1]);
  }
  
  for (let i = 0; i < texts.length && i < links.length; i++) {
    const tweetPath = links[i];
    const parts = tweetPath.split("/");
    const username = parts[1] || "unknown";
    const tweetId = parts[3] || "";
    
    tweets.push({
      id: tweetId,
      username: username,
      text: texts[i],
      link: "https://x.com" + tweetPath
    });
  }
  
  return tweets;
}

async function scan() {
  try {
    const query = SEARCH_QUERIES[currentQuery];
    currentQuery = (currentQuery + 1) % SEARCH_QUERIES.length;
    
    const instance = NITTER_INSTANCES[currentInstance];
    const searchUrl = "https://" + instance + "/search?f=tweets&q=" + encodeURIComponent(query);
    
    console.log("Searching: " + query);
    console.log("Using: " + instance);
    
    const response = await fetchUrl(searchUrl);
    
    if (response.status !== 200) {
      console.log("Instance returned " + response.status + ", switching...");
      currentInstance = (currentInstance + 1) % NITTER_INSTANCES.length;
      return;
    }
    
    const tweets = parseTweets(response.data);
    console.log("Found " + tweets.length + " tweets");
    
    let newCount = 0;
    
    for (const tweet of tweets) {
      if (!tweet.id || seenTweets.has(tweet.id)) continue;
      seenTweets.add(tweet.id);
      
      const profiles = extractProfileLinks(tweet.text);
      if (profiles.length === 0) continue;
      
      newCount++;
      
      let msg = "Early Launch Signal\n\n";
      msg += "Tweet:\n" + tweet.text.substring(0, 280) + "\n\n";
      msg += "Profiles:\n";
      for (const p of profiles) {
        msg += p + "\n";
      }
      msg += "\nSource:\n" + tweet.link;
      
      console.log("---");
      console.log(msg);
      
      await sendTelegram(msg);
      await new Promise((r) => setTimeout(r, 2000));
      
      if (newCount >= 3) break;
    }
    
    console.log("Processed " + newCount + " new signals, tracking " + seenTweets.size + " tweets");
    
  } catch (err) {
    console.log("Scan error:", err.message);
    currentInstance = (currentInstance + 1) % NITTER_INSTANCES.length;
  }
}

console.log("X Scanner started...");
console.log("Bot token set:", TELEGRAM_BOT_TOKEN ? "Yes" : "No");
console.log("Chat ID set:", TELEGRAM_CHAT_ID ? "Yes" : "No");

scan();
setInterval(scan, 30000);
