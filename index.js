import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import pkg from 'pg';

const { Pool } = pkg;

// ===== ENV =====
const { DISCORD_TOKEN, DATABASE_URL, BOT_PREFIX } = process.env;
const AUTO_ROLE_ID = "1448622830211305674";
const PREFIX = BOT_PREFIX || "*";
const ROLE_REWARDS = [
  { level: 1, roleId: "1448628943300329472" },
  { level: 5, roleId: "1448629507690074172" },
  { level: 10, roleId: "1448629997811138765" },
  { level: 25, roleId: "1448630103956262996" },
  { level: 50, roleId: "1448630243928707125" }
];

if (!DISCORD_TOKEN) throw new Error("DISCORD_TOKEN nao definido");
if (!DATABASE_URL) throw new Error("DATABASE_URL nao definido");

// ===== POSTGRES =====
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      value TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_xp (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  console.log("Tabelas prontas");
}

function xpForLevel(level) {
  return Math.floor(((level * (level + 1)) / 2) * 100);
}

function levelForXp(xp) {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

async function upsertUserProgress(guildId, userId, xp, level) {
  const { rows } = await pool.query(
    `
    INSERT INTO user_xp (guild_id, user_id, xp, level)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level
    RETURNING xp, level
    `,
    [guildId, userId, xp, level]
  );
  return rows[0];
}

async function getUserProgress(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT xp, level FROM user_xp WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
  if (!rows.length) return { xp: 0, level: 0 };
  return rows[0];
}

async function grantLevelRoles(member, level) {
  if (!member) return;

  for (const reward of ROLE_REWARDS) {
    if (level >= reward.level && !member.roles.cache.has(reward.roleId)) {
      const role = member.guild.roles.cache.get(reward.roleId);
      if (!role) {
        console.error(`Cargo ${reward.roleId} nao encontrado no servidor ${member.guild.id}`);
        continue;
      }
      try {
        await member.roles.add(role);
        console.log(`Cargo ${reward.roleId} aplicado a ${member.user.tag} (nivel ${level})`);
      } catch (err) {
        console.error(`Erro ao aplicar cargo ${reward.roleId} para ${member.user.tag}:`, err);
      }
    }
  }
}

async function addXpForMessage(message) {
  if (!message.guild) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  const current = await getUserProgress(guildId, userId);
  let xp = current.xp + 1;
  let level = levelForXp(xp);

  if (current.level < 1 && level >= 1) {
    xp += 100; // bonus ao atingir o nivel 1
    level = levelForXp(xp);
  }

  const updated = await upsertUserProgress(guildId, userId, xp, level);

  if (updated.level > current.level) {
    await grantLevelRoles(message.member, updated.level);
  }
}

// ===== DISCORD =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", async () => {
  console.log(`Bot online como: ${client.user.tag}`);
  await initTables();
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  try {
    await addXpForMessage(message);

    if (!message.content.startsWith(PREFIX)) return;

    const [command] = message.content.slice(PREFIX.length).trim().split(/\s+/);
    if (!command) return;

    if (command.toLowerCase() === "perfil") {
      const { xp, level } = await getUserProgress(message.guild.id, message.author.id);
      const nextLevel = level + 1;
      const nextLevelXp = xpForLevel(nextLevel);
      const toNext = nextLevelXp - xp;

      return message.reply(
        `Perfil de ${message.author.username}: XP **${xp}**, Nivel **${level}**. Falta **${toNext} XP** para o nivel ${nextLevel}.`
      );
    }
  } catch (err) {
    console.error("Erro no banco:", err);
    message.reply("Erro ao acessar o banco.");
  }
});

client.on("guildMemberAdd", async (member) => {
  const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
  if (!role) {
    console.error(`Cargo ${AUTO_ROLE_ID} nao encontrado no servidor ${member.guild.id}`);
    return;
  }

  try {
    await member.roles.add(role);
    console.log(`Cargo ${AUTO_ROLE_ID} aplicado a ${member.user.tag}`);
  } catch (err) {
    console.error(`Erro ao aplicar cargo para ${member.user.tag}:`, err);
  }
});

client.login(DISCORD_TOKEN);
