const OpenAI = require("openai");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY in environment variables");
  console.error("Make sure .env file exists in the aggremart root directory");
  process.exit(1);
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey,
  defaultHeaders: {
    "HTTP-Referer": process.env.OPENROUTER_REFERER || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_TITLE || "AggreMart",
  },
});

module.exports = { openai }; 