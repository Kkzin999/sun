import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import pkg from 'pg';

const { Pool } = pkg;

// ===== ENV =====
const { DISCORD_TOKEN, DATABASE_URL, BOT_PREFIX } = process.env;
const AUTO_ROLE_ID = "1448622830211305674";
const PREFIX = BOT_PREFIX || "!";
const COMMAND_OWNER_ID = "1288921463792861256";
const ROLE_REWARDS = [
  { level: 1, roleId: "1448628943300329472" },
  { level: 5, roleId: "1448629507690074172" },
  { level: 10, roleId: "1448629997811138765" },
  { level: 25, roleId: "1448630103956262996" },
  { level: 50, roleId: "1448630243928707125" }
];
const MONEY_REWARDS = { 1: 100, 2: 200, 3: 300 };
const VAR_ALIASES = {
  tk: "tk",
  token: "tk",
  xp: "xp",
  exp: "xp",
  money: "money",
  cash: "money",
  dinheiro: "money",
  hp: "hp",
  hpm: "hpm",
  atk: "atk",
  def: "def",
  mana: "mana",
  classe: "class",
  class: "class"
};
const BASE_STATS = {
  hp: 100,
  hpm: 100,
  atk: 10,
  def: 10,
  mana: 0
};
const CLASS_CONFIG = {
  arqueiro: {
    label: "Arqueiro",
    atkMul: 0.5,
    defMul: 0.5,
    hpmMul: 1,
    mana: 0
  },
  assassino: {
    label: "Assassino",
    atkMul: 2,
    defMul: 0.5,
    hpmMul: 0.5,
    mana: 0
  },
  militar: {
    label: "Militar",
    atkMul: 1,
    defMul: 1,
    hpmMul: 1,
    mana: 0
  },
  mago: {
    label: "Mago",
    atkMul: 0.5,
    defFixed: 0,
    hpmMul: 0.2, // reduz 80%
    mana: 100
  }
};

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
      tk INTEGER NOT NULL DEFAULT 0,
      money INTEGER NOT NULL DEFAULT 0,
      class TEXT NOT NULL DEFAULT '0',
      hp INTEGER NOT NULL DEFAULT 100,
      hpm INTEGER NOT NULL DEFAULT 100,
      atk INTEGER NOT NULL DEFAULT 10,
      def INTEGER NOT NULL DEFAULT 10,
      mana INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_inviter (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      inviter_id TEXT,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS punishments (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL, -- ban | mute
      ends_at TIMESTAMPTZ,
      reason TEXT
    )
  `);
  await pool.query(`ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS tk INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS money INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS class TEXT NOT NULL DEFAULT '0'`);
  await pool.query(`ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS hp INTEGER NOT NULL DEFAULT 100`);
  await pool.query(`ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS hpm INTEGER NOT NULL DEFAULT 100`);
  await pool.query(`ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS atk INTEGER NOT NULL DEFAULT 10`);
  await pool.query(`ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS def INTEGER NOT NULL DEFAULT 10`);
  await pool.query(`ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS mana INTEGER NOT NULL DEFAULT 0`);
  console.log("Tabelas prontas");
}

// ===== XP / NIVEL =====
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

async function upsertUserProgress(guildId, userId, xp, level, tk, money, charClass, hp, hpm, atk, def, mana) {
  const { rows } = await pool.query(
    `
    INSERT INTO user_xp (guild_id, user_id, xp, level, tk, money, class, hp, hpm, atk, def, mana)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level, tk = EXCLUDED.tk, money = EXCLUDED.money, class = EXCLUDED.class, hp = EXCLUDED.hp, hpm = EXCLUDED.hpm, atk = EXCLUDED.atk, def = EXCLUDED.def, mana = EXCLUDED.mana
    RETURNING xp, level, tk, money, class, hp, hpm, atk, def, mana
    `,
    [guildId, userId, xp, level, tk, money, charClass, hp, hpm, atk, def, mana]
  );
  return rows[0];
}

async function getUserProgress(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT xp, level, tk, money, class, hp, hpm, atk, def, mana FROM user_xp WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
  if (!rows.length) {
    return {
      xp: 0,
      level: 0,
      tk: 0,
      money: 0,
      class: "0",
      hp: BASE_STATS.hp,
      hpm: BASE_STATS.hpm,
      atk: BASE_STATS.atk,
      def: BASE_STATS.def,
      mana: BASE_STATS.mana
    };
  }
  const data = rows[0];
  return {
    xp: data.xp ?? 0,
    level: data.level ?? 0,
    tk: data.tk ?? 0,
    money: data.money ?? 0,
    class: data.class ?? "0",
    hp: data.hp ?? BASE_STATS.hp,
    hpm: data.hpm ?? BASE_STATS.hpm,
    atk: data.atk ?? BASE_STATS.atk,
    def: data.def ?? BASE_STATS.def,
    mana: data.mana ?? BASE_STATS.mana
  };
}

// ===== UTIL =====
const MS_SECOND = 1000;
const MS_MINUTE = MS_SECOND * 60;
const MS_HOUR = MS_MINUTE * 60;
const MS_DAY = MS_HOUR * 24;
const MS_YEAR = MS_DAY * 365;
const MAX_DURATION_MS = MS_YEAR * 100; // 100 anos
const MAX_TIMEOUT_MS = MS_DAY * 28; // limite da API do Discord para timeout

function parseDuration(text) {
  if (!text) return null;
  const match = text.toLowerCase().match(/^(\d+)(s|m|h|d|w|mo|y)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = {
    s: MS_SECOND,
    m: MS_MINUTE,
    h: MS_HOUR,
    d: MS_DAY,
    w: MS_DAY * 7,
    mo: MS_DAY * 30,
    y: MS_YEAR
  };
  const ms = value * (multipliers[unit] || 0);
  if (!ms || ms < 1000) return null;
  return Math.min(ms, MAX_DURATION_MS);
}

function formatDuration(ms) {
  if (ms === null) return "Permanente";
  const parts = [];
  const units = [
    { label: "ano(s)", value: MS_YEAR },
    { label: "dia(s)", value: MS_DAY },
    { label: "hora(s)", value: MS_HOUR },
    { label: "min", value: MS_MINUTE },
    { label: "s", value: MS_SECOND }
  ];
  let remaining = ms;
  for (const u of units) {
    if (remaining >= u.value) {
      const qty = Math.floor(remaining / u.value);
      parts.push(`${qty} ${u.label}`);
      remaining -= qty * u.value;
    }
  }
  return parts.join(", ");
}

function buildActionEmbed({ title, description, fields = [], color = 0x5865f2 }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();
}

function computeLevelRewards(prevLevel, newLevel) {
  const tkGain = Math.max(0, newLevel - prevLevel);
  let moneyGain = 0;
  for (let lvl = prevLevel + 1; lvl <= newLevel; lvl++) {
    if (MONEY_REWARDS[lvl]) {
      moneyGain += MONEY_REWARDS[lvl];
    }
  }
  return { tkGain, moneyGain };
}

function resolveVariableName(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  if (VAR_ALIASES[key]) return VAR_ALIASES[key];
  if (key === "level" || key === "nivel" || key === "lvl") return "level";
  return null;
}

function buildStatsForClass(classKey) {
  const config = CLASS_CONFIG[classKey];
  if (!config) return null;

  const hpm = Math.max(1, Math.round(BASE_STATS.hpm * (config.hpmMul ?? 1)));
  const hp = hpm;
  const atk = Math.max(0, Math.round(BASE_STATS.atk * (config.atkMul ?? 1)));
  const def = config.defFixed !== undefined
    ? config.defFixed
    : Math.max(0, Math.round(BASE_STATS.def * (config.defMul ?? 1)));
  const mana = config.mana ?? BASE_STATS.mana;

  return {
    className: config.label,
    hp,
    hpm,
    atk,
    def,
    mana
  };
}

async function modifyUserVariable(guildId, userId, variable, value, mode) {
  const current = await getUserProgress(guildId, userId);
  let xp = current.xp;
  let level = current.level;
  let tk = current.tk;
  let money = current.money;
  let charClass = current.class || "0";
  let hp = current.hp ?? BASE_STATS.hp;
  let hpm = current.hpm ?? BASE_STATS.hpm;
  let atk = current.atk ?? BASE_STATS.atk;
  let def = current.def ?? BASE_STATS.def;
  let mana = current.mana ?? BASE_STATS.mana;

  if (variable === "level") {
    throw new Error("level-not-allowed");
  } else if (variable === "xp") {
    if (mode === "set") xp = value;
    if (mode === "add") xp += value;
    if (mode === "remove") xp = Math.max(0, xp - value);
    level = levelForXp(xp);
  } else if (variable === "tk") {
    if (mode === "set") tk = value;
    if (mode === "add") tk += value;
    if (mode === "remove") tk = Math.max(0, tk - value);
  } else if (variable === "money") {
    if (mode === "set") money = value;
    if (mode === "add") money += value;
    if (mode === "remove") money = Math.max(0, money - value);
  } else if (variable === "hp") {
    if (mode === "set") hp = value;
    if (mode === "add") hp += value;
    if (mode === "remove") hp = Math.max(0, hp - value);
    hp = Math.min(hp, hpm);
  } else if (variable === "hpm") {
    if (mode === "set") hpm = value;
    if (mode === "add") hpm += value;
    if (mode === "remove") hpm = Math.max(1, hpm - value);
    if (hp > hpm) hp = hpm;
  } else if (variable === "atk") {
    if (mode === "set") atk = value;
    if (mode === "add") atk += value;
    if (mode === "remove") atk = Math.max(0, atk - value);
  } else if (variable === "def") {
    if (mode === "set") def = value;
    if (mode === "add") def += value;
    if (mode === "remove") def = Math.max(0, def - value);
  } else if (variable === "mana") {
    if (mode === "set") mana = value;
    if (mode === "add") mana += value;
    if (mode === "remove") mana = Math.max(0, mana - value);
  } else if (variable === "class") {
    if (mode !== "set") throw new Error("class-set-only");
    charClass = String(value || "0");
  }

  return upsertUserProgress(guildId, userId, xp, level, tk, money, charClass, hp, hpm, atk, def, mana);
}

async function setUserClass(guildId, userId, classKey) {
  const key = (classKey || "").toLowerCase();
  const stats = buildStatsForClass(key);
  if (!stats) return null;

  const current = await getUserProgress(guildId, userId);
  return upsertUserProgress(
    guildId,
    userId,
    current.xp,
    current.level,
    current.tk,
    current.money,
    stats.className,
    stats.hp,
    stats.hpm,
    stats.atk,
    stats.def,
    stats.mana
  );
}

// ===== INVITER =====
async function recordInviter(guildId, userId, inviterId) {
  if (!inviterId) return;
  await pool.query(
    `
    INSERT INTO user_inviter (guild_id, user_id, inviter_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET inviter_id = EXCLUDED.inviter_id
    `,
    [guildId, userId, inviterId]
  );
}

async function getInviterId(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT inviter_id FROM user_inviter WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
  if (!rows.length) return null;
  return rows[0].inviter_id;
}

async function rewardInviter(guild, invitedUserId) {
  if (!guild) return;
  const inviterId = await getInviterId(guild.id, invitedUserId);
  if (!inviterId) return;

  const current = await getUserProgress(guild.id, inviterId);
  const newXp = current.xp + 100;
  const newLevel = levelForXp(newXp);
  let tk = current.tk;
  let money = current.money;
  const charClass = current.class || "0";
  let hp = current.hp ?? BASE_STATS.hp;
  let hpm = current.hpm ?? BASE_STATS.hpm;
  let atk = current.atk ?? BASE_STATS.atk;
  let def = current.def ?? BASE_STATS.def;
  let mana = current.mana ?? BASE_STATS.mana;
  if (newLevel > current.level) {
    const rewards = computeLevelRewards(current.level, newLevel);
    tk += rewards.tkGain;
    money += rewards.moneyGain;
  }
  const updated = await upsertUserProgress(guild.id, inviterId, newXp, newLevel, tk, money, charClass, hp, hpm, atk, def, mana);

  if (updated.level > current.level) {
    try {
      const member = guild.members.cache.get(inviterId) || await guild.members.fetch(inviterId);
      await grantLevelRoles(member, updated.level);
    } catch (err) {
      console.error(`Nao consegui aplicar cargos do convidador ${inviterId}:`, err);
    }
  }
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
  const prevLevel = current.level;
  let tk = current.tk;
  let money = current.money;
  const charClass = current.class || "0";
  let hp = current.hp ?? BASE_STATS.hp;
  let hpm = current.hpm ?? BASE_STATS.hpm;
  let atk = current.atk ?? BASE_STATS.atk;
  let def = current.def ?? BASE_STATS.def;
  let mana = current.mana ?? BASE_STATS.mana;

  if (level > prevLevel) {
    const rewards = computeLevelRewards(prevLevel, level);
    tk += rewards.tkGain;
    money += rewards.moneyGain;
  }

  const updated = await upsertUserProgress(guildId, userId, xp, level, tk, money, charClass, hp, hpm, atk, def, mana);

  if (updated.level > prevLevel) {
    await grantLevelRoles(message.member, updated.level);
  }

  if (prevLevel < 1 && updated.level >= 1) {
    await rewardInviter(message.guild, userId);
  }
}

// ===== INVITES CACHE =====
const invitesCache = new Map();

async function refreshInvitesCache(guild) {
  try {
    const invites = await guild.invites.fetch();
    const byCode = new Map();
    invites.forEach((inv) => byCode.set(inv.code, inv.uses || 0));
    invitesCache.set(guild.id, byCode);
  } catch (err) {
    console.error(`Erro ao atualizar cache de convites do servidor ${guild.id}:`, err);
  }
}

async function detectInviter(member) {
  try {
    const guild = member.guild;
    const cached = invitesCache.get(guild.id) || new Map();
    const newInvites = await guild.invites.fetch();

    let usedInvite = null;
    newInvites.forEach((inv) => {
      const prevUses = cached.get(inv.code) || 0;
      const currentUses = inv.uses || 0;
      if (currentUses > prevUses) {
        usedInvite = inv;
      }
    });

    await refreshInvitesCache(guild);

    if (usedInvite && usedInvite.inviter) {
      await recordInviter(guild.id, member.id, usedInvite.inviter.id);
    }
  } catch (err) {
    console.error(`Erro ao detectar convidador para ${member.id}:`, err);
  }
}

async function notifyPunishmentEnd(client, userId, type, guildName) {
  try {
    const user = await client.users.fetch(userId);
    const embed = buildActionEmbed({
      title: "Punicao encerrada",
      description: `Sua punicao de ${type === "ban" ? "banimento" : "mute"} no servidor **${guildName}** acabou.`
    });
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.error(`Nao consegui avisar usuario ${userId} sobre fim da punicao:`, err);
  }
}

async function processExpiredPunishments(client) {
  const { rows } = await pool.query(
    `SELECT id, guild_id, user_id, type, reason FROM punishments WHERE ends_at IS NOT NULL AND ends_at <= NOW()`
  );

  for (const row of rows) {
    let guild;
    try {
      guild = await client.guilds.fetch(row.guild_id);
    } catch (err) {
      console.error(`Nao achei guild ${row.guild_id} para remover punicao ${row.id}:`, err);
      continue;
    }

    try {
      if (row.type === "ban") {
        await guild.bans.remove(row.user_id, "Punicao expirada");
      } else if (row.type === "mute") {
        const member = await guild.members.fetch(row.user_id);
        await member.timeout(null, "Punicao expirada");
      }
      await pool.query(`DELETE FROM punishments WHERE id = $1`, [row.id]);
      await notifyPunishmentEnd(client, row.user_id, row.type, guild.name);
    } catch (err) {
      console.error(`Erro ao remover punicao ${row.id} (${row.type}) do usuario ${row.user_id}:`, err);
    }
  }
}

// ===== DISCORD =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildInvites
  ]
});

client.once("ready", async () => {
  console.log(`Bot online como: ${client.user.tag}`);
  await initTables();

  for (const guild of client.guilds.cache.values()) {
    await refreshInvitesCache(guild);
  }

  setInterval(() => processExpiredPunishments(client), 30_000);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  try {
    await addXpForMessage(message);

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift();
    if (!command) return;

    if (command.toLowerCase() === "perfil") {
      const { xp, level, tk, money, hp, hpm, atk, def, class: charClass, mana } = await getUserProgress(message.guild.id, message.author.id);
      const nextLevel = level + 1;
      const nextLevelXp = xpForLevel(nextLevel);
      const toNext = nextLevelXp - xp;

      const fields = [
        { name: "XP", value: `${xp}`, inline: true },
        { name: "Nivel", value: `${level}`, inline: true },
        { name: "Para o proximo", value: `${toNext} XP`, inline: true },
        { name: "TK", value: `${tk}`, inline: true },
        { name: "💵", value: `${money}`, inline: true },
        { name: "HP", value: `${hp}/${hpm}`, inline: true },
        { name: "ATK", value: `${atk}`, inline: true },
        { name: "DEF", value: `${def}`, inline: true }
      ];
      if (mana > 0) {
        fields.push({ name: "Mana", value: `${mana}`, inline: true });
      }
      if (charClass && charClass !== "0") {
        fields.push({ name: "Classe", value: charClass, inline: true });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
        .setTitle("Perfil")
        .addFields(fields)
        .setFooter({ text: `Prefixo: ${PREFIX} | Comando: ${PREFIX}perfil` })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    if (command.toLowerCase() === "start") {
      const classKey = (args[0] || "").toLowerCase();
      if (!classKey) {
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle("RPG - Escolha sua classe")
          .setDescription(`Use \`${PREFIX}start <classe>\` para escolher. Classes: arqueiro, assassino, militar, mago.`)
          .addFields(
            { name: "Arqueiro", value: "ATK -50%, DEF -50%. Especial: criticos (50% a 150%) e `!peneirar` ignora DEF com 3 flechas." },
            { name: "Assassino", value: "ATK +100%, DEF -50%, HPM -50%. Especial: `!esfaquear` bate 2-5x ATK e adiciona +2s de cooldown ao alvo." },
            { name: "Militar", value: "Sem ajustes. Especial: pode comprar itens do exercito." },
            { name: "Mago", value: "HPM -80% (DEF inicia 0), ATK -50%, DEF -50%. Ganha Mana 100. Magias: Muralha (30 mana, 100 HP de protecao), Morcego espectral (50 mana, rouba HP baseado no dano, ATK 30), Descarga eletrica (5 mana, dano 20 ATK)." }
          );
        return message.reply({ embeds: [embed] });
      }

      const updated = await setUserClass(message.guild.id, message.author.id, classKey);
      if (!updated) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Classe invalida", description: "Use arqueiro, assassino, militar ou mago." }).setColor(0xED4245)] });
      }

      const embed = buildActionEmbed({
        title: `Classe escolhida: ${updated.class}`,
        description: "Atributos ajustados.",
        fields: [
          { name: "HP", value: `${updated.hp}/${updated.hpm}`, inline: true },
          { name: "ATK", value: `${updated.atk}`, inline: true },
          { name: "DEF", value: `${updated.def}`, inline: true },
          { name: "Mana", value: `${updated.mana}`, inline: true }
        ]
      }).setColor(0x57F287);
      return message.reply({ embeds: [embed] });
    }

    if (command.toLowerCase() === "ban") {
      if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Permissao insuficiente", description: "Voce precisa de permissao de banir membros." }).setColor(0xED4245)] });
      }

      const targetId = (message.mentions.users.first()?.id) || args.shift();
      if (!targetId) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Uso", description: `${PREFIX}ban @usuario <tempo opcional> <motivo>` }).setColor(0xED4245)] });
      }

      const maybeDuration = args[0];
      const durationMs = parseDuration(maybeDuration);
      const hasDuration = durationMs !== null;
      if (hasDuration) args.shift();
      const reason = args.join(" ") || "Sem motivo";

      try {
        await message.guild.members.ban(targetId, { reason });
      } catch (err) {
        console.error("Erro ao banir:", err);
        return message.reply({ embeds: [buildActionEmbed({ title: "Erro ao banir", description: "Nao consegui banir o usuario." }).setColor(0xED4245)] });
      }

      if (hasDuration) {
        const endsAt = new Date(Date.now() + durationMs);
        await pool.query(
          `INSERT INTO punishments (guild_id, user_id, type, ends_at, reason) VALUES ($1, $2, $3, $4, $5)`,
          [message.guild.id, targetId, "ban", endsAt.toISOString(), reason]
        );
      }

      const embed = buildActionEmbed({
        title: "Banimento aplicado",
        description: `<@${targetId}> foi banido.`,
        fields: [
          { name: "Moderador", value: `<@${message.author.id}>`, inline: true },
          { name: "Duracao", value: hasDuration ? formatDuration(durationMs) : "Permanente", inline: true },
          { name: "Motivo", value: reason }
        ]
      });
      return message.reply({ embeds: [embed] });
    }

    if (["add", "remove", "set"].includes(command.toLowerCase())) {
      if (message.author.id !== COMMAND_OWNER_ID) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Acesso negado", description: "Somente o proprietario autorizado pode usar este comando." }).setColor(0xED4245)] });
      }

      const mode = command.toLowerCase();
      const variableName = resolveVariableName(args[0]);
      const rawValue = args[1];
      const numericValue = parseInt(rawValue, 10);
      const targetMember =
        message.mentions.members.first() ||
        (args[2] ? await message.guild.members.fetch(args[2]).catch(() => null) : null);

      if (!variableName) {
        return message.reply({
          embeds: [
            buildActionEmbed({
              title: "Variavel inexistente",
              description: "Essa variavel nao existe. Use tk, money, xp, hp, hpm, atk, def, mana ou class."
            }).setColor(0xED4245)
          ]
        });
      }

      if (variableName === "level") {
        return message.reply({
          embeds: [
            buildActionEmbed({
              title: "Nivel bloqueado",
              description: "Nivel nao pode ser alterado diretamente."
            }).setColor(0xED4245)
          ]
        });
      }

      if (variableName === "class" && mode !== "set") {
        return message.reply({
          embeds: [
            buildActionEmbed({
              title: "Classe",
              description: "Use apenas o modo set para classe."
            }).setColor(0xED4245)
          ]
        });
      }

      const needsNumber = variableName !== "class";
      if ((needsNumber && (Number.isNaN(numericValue) || numericValue < 0)) || !targetMember || !rawValue) {
        return message.reply({
          embeds: [
            buildActionEmbed({
              title: "Uso",
              description: `${PREFIX}${mode} variavel valor @usuario\nVariaveis: tk, money, xp, hp, hpm, atk, def, mana, class\nExemplo classe: ${PREFIX}set class Mago @usuario`
            }).setColor(0xED4245)
          ]
        });
      }

      let updated;
      try {
        const valueToUse = needsNumber ? numericValue : rawValue;
        updated = await modifyUserVariable(message.guild.id, targetMember.id, variableName, valueToUse, mode);
      } catch (err) {
        if (err.message === "level-not-allowed") {
          return message.reply({
            embeds: [
              buildActionEmbed({
                title: "Nivel bloqueado",
                description: "Nivel nao pode ser alterado diretamente."
              }).setColor(0xED4245)
            ]
          });
        }
        if (err.message === "class-set-only") {
          return message.reply({
            embeds: [
              buildActionEmbed({
                title: "Classe",
                description: "Classe so pode ser alterada com o modo set."
              }).setColor(0xED4245)
            ]
          });
        }
        console.error("Erro ao alterar variavel:", err);
        return message.reply({ embeds: [buildActionEmbed({ title: "Erro", description: "Nao foi possivel alterar a variavel." }).setColor(0xED4245)] });
      }

      const embed = buildActionEmbed({
        title: `Variavel ${mode}`,
        description: `Valores atualizados para <@${targetMember.id}>`,
        fields: [
          { name: "Variavel", value: variableName.toUpperCase(), inline: true },
          { name: "Valor alterado", value: `${rawValue}`, inline: true },
          { name: "Resultado", value: `TK: ${updated.tk} | 💵: ${updated.money} | XP: ${updated.xp} | HP: ${updated.hp}/${updated.hpm} | ATK: ${updated.atk} | DEF: ${updated.def} | Classe: ${updated.class || "0"}` }
        ]
      });
      return message.reply({ embeds: [embed] });
    }

    if (command.toLowerCase() === "mute") {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Permissao insuficiente", description: "Voce precisa de permissao de moderar membros." }).setColor(0xED4245)] });
      }

      const targetMember = message.mentions.members.first() || (await message.guild.members.fetch(args[0]).catch(() => null));
      if (!targetMember) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Uso", description: `${PREFIX}mute @usuario <tempo> <motivo>` }).setColor(0xED4245)] });
      }

      const durationMs = parseDuration(args[1] || args[0]);
      if (!durationMs) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Duracao invalida", description: "Use formatos como 10m, 2h, 3d, 1y (max 100 anos)." }).setColor(0xED4245)] });
      }

      if (durationMs > MAX_TIMEOUT_MS) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Limite do Discord", description: "Timeout nao pode passar de 28 dias." }).setColor(0xED4245)] });
      }

      const reasonStartIndex = args[1] ? 2 : 1;
      const reason = args.slice(reasonStartIndex).join(" ") || "Sem motivo";

      try {
        await targetMember.timeout(durationMs, reason);
      } catch (err) {
        console.error("Erro ao mutar:", err);
        return message.reply({ embeds: [buildActionEmbed({ title: "Erro ao mutar", description: "Nao consegui aplicar timeout." }).setColor(0xED4245)] });
      }

      const endsAt = new Date(Date.now() + durationMs);
      await pool.query(
        `INSERT INTO punishments (guild_id, user_id, type, ends_at, reason) VALUES ($1, $2, $3, $4, $5)`,
        [message.guild.id, targetMember.id, "mute", endsAt.toISOString(), reason]
      );

      const embed = buildActionEmbed({
        title: "Mute aplicado",
        description: `<@${targetMember.id}> recebeu timeout.`,
        fields: [
          { name: "Moderador", value: `<@${message.author.id}>`, inline: true },
          { name: "Duracao", value: formatDuration(durationMs), inline: true },
          { name: "Motivo", value: reason }
        ]
      });
      return message.reply({ embeds: [embed] });
    }

    if (command.toLowerCase() === "expulsar" || command.toLowerCase() === "kick") {
      if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Permissao insuficiente", description: "Voce precisa de permissao de expulsar membros." }).setColor(0xED4245)] });
      }

      const targetMember = message.mentions.members.first() || (await message.guild.members.fetch(args[0]).catch(() => null));
      if (!targetMember) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Uso", description: `${PREFIX}expulsar @usuario <motivo>` }).setColor(0xED4245)] });
      }

      const reason = args.slice(1).join(" ") || "Sem motivo";

      try {
        await targetMember.kick(reason);
      } catch (err) {
        console.error("Erro ao expulsar:", err);
        return message.reply({ embeds: [buildActionEmbed({ title: "Erro ao expulsar", description: "Nao consegui expulsar o usuario." }).setColor(0xED4245)] });
      }

      const embed = buildActionEmbed({
        title: "Expulsao aplicada",
        description: `<@${targetMember.id}> foi expulso.`,
        fields: [
          { name: "Moderador", value: `<@${message.author.id}>`, inline: true },
          { name: "Motivo", value: reason }
        ]
      });
      return message.reply({ embeds: [embed] });
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
  } else {
    try {
      await member.roles.add(role);
      console.log(`Cargo ${AUTO_ROLE_ID} aplicado a ${member.user.tag}`);
    } catch (err) {
      console.error(`Erro ao aplicar cargo para ${member.user.tag}:`, err);
    }
  }

  await detectInviter(member);
});

client.login(DISCORD_TOKEN);
