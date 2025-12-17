import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import pkg from 'pg';

const { Pool } = pkg;

// ===== ENV =====
const { DISCORD_TOKEN, DATABASE_URL } = process.env;

if (!DISCORD_TOKEN) throw new Error("DISCORD_TOKEN não definido");
if (!DATABASE_URL) throw new Error("DATABASE_URL não definido");

// ===== POSTGRES =====
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initTestTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      value TEXT
    )
  `);
  console.log("✅ Tabela test pronta");
}

// ===== DISCORD =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", async () => {
  console.log(`🤖 Bot online como: ${client.user.tag}`);
  await initTestTable();
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  try {
    if (message.content.startsWith("!save ")) {
      const value = message.content.replace("!save ", "").trim();

      await pool.query(
        "INSERT INTO test (value) VALUES ($1)",
        [value]
      );

      return message.reply("💾 Valor salvo no banco.");
    }

    if (message.content === "!get") {
      const { rows } = await pool.query(
        "SELECT value FROM test ORDER BY id DESC LIMIT 1"
      );

      if (!rows.length) {
        return message.reply("❌ Nenhum valor salvo ainda.");
      }

      return message.reply(
        `📦 Último valor salvo: **${rows[0].value}**`
      );
    }
  } catch (err) {
    console.error("Erro no banco:", err);
    message.reply("❌ Erro ao acessar o banco.");
  }
});

client.login(DISCORD_TOKEN);
