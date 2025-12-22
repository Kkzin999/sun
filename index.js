import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import pkg from 'pg';

const { Pool } = pkg;

// ===== ENV =====
const { DISCORD_TOKEN, DATABASE_URL, BOT_PREFIX } = process.env;
const AUTO_ROLE_ID = "1448622830211305674";
const PREFIX = BOT_PREFIX || "!";
const COMMAND_OWNER_ID = "1288921463792861256";
const EMBED_COLOR = 0xffffff;
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

const RARITY_ORDER = ["Comum", "Rara", "Épica", "Lendária", "Mística"];
const RARITY_RULES = {
  Comum: { xpForNext: 10, maxLevel: 25, upgradeTo: "Rara" },
  Rara: { xpForNext: 20, maxLevel: 10, upgradeTo: "Épica" },
  "Épica": { xpForNext: 50, maxLevel: 5, upgradeTo: "Lendária" },
  "Lendária": { xpForNext: 1000, maxLevel: 1, upgradeTo: "Mística" },
  "Mística": { xpForNext: Infinity, maxLevel: 999 }
};

const SPELL_LIBRARY = {
  muralha: {
    id: "muralha",
    name: "Muralha",
    baseCost: 30,
    basePower: 100,
    rarity: "Comum",
    type: "shield",
    description: "Cria uma barreira protetora."
  },
  morcego: {
    id: "morcego",
    name: "Morcego Espectral",
    baseCost: 50,
    basePower: 30,
    rarity: "Rara",
    type: "lifesteal",
    description: "Bate e rouba parte do dano como HP."
  },
  descarga: {
    id: "descarga",
    name: "Descarga Elétrica",
    baseCost: 5,
    basePower: 20,
    rarity: "Comum",
    type: "damage",
    description: "Golpe rápido de eletricidade."
  }
};

const DEFAULT_SPELL_SLOTS = [
  { slot: 1, spellId: "muralha" },
  { slot: 2, spellId: "morcego" },
  { slot: 3, spellId: "descarga" }
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_spells (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      slot INTEGER NOT NULL,
      spell_id TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      rarity TEXT NOT NULL DEFAULT 'Comum',
      locked BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (guild_id, user_id, slot)
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

function buildActionEmbed({ title, description, fields = [], color = EMBED_COLOR }) {
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
  if (current.class && current.class !== "0") {
    return { locked: true, currentClass: current.class };
  }
  const updated = await upsertUserProgress(
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
  if (key === "mago") {
    await ensureSpellSlots(guildId, userId);
  }
  return updated;
}

function resolveSpellId(name) {
  if (!name) return null;
  const normalized = name.toLowerCase();
  if (normalized.startsWith("mural")) return "muralha";
  if (normalized.startsWith("morce")) return "morcego";
  if (normalized.startsWith("desc")) return "descarga";
  return SPELL_LIBRARY[normalized] ? normalized : null;
}

function getRarityInfo(rarity) {
  return RARITY_RULES[rarity] || RARITY_RULES.Comum;
}

function upgradeRarity(rarity) {
  const info = getRarityInfo(rarity);
  return info.upgradeTo || rarity;
}

function computeSpellScaling(spell) {
  const base = SPELL_LIBRARY[spell.spell_id];
  if (!base) return null;
  const level = spell.level || 1;
  const cost = Math.round(base.baseCost * Math.pow(1.5, level - 1));
  const power = Math.round(base.basePower * Math.pow(1.25, level - 1));
  return { cost, power, base };
}

function gainSpellXp(spell, amount) {
  if (!spell || spell.locked) return spell;
  let newXp = (spell.xp || 0) + amount;
  let newLevel = spell.level || 1;
  let newRarity = spell.rarity || SPELL_LIBRARY[spell.spell_id]?.rarity || "Comum";
  let locked = spell.locked || false;
  let changed = false;

  while (!locked) {
    const rarityInfo = getRarityInfo(newRarity);
    if (newRarity === "Lendária" && newXp >= 1000) {
      newRarity = "Mística";
      locked = true;
      newXp = 0;
      changed = true;
      break;
    }
    if (newLevel >= rarityInfo.maxLevel) {
      const nextRarity = upgradeRarity(newRarity);
      if (nextRarity === newRarity) {
        locked = true;
        break;
      }
      newRarity = nextRarity;
      locked = true;
      newXp = 0;
      changed = true;
      break;
    }
    if (newXp < rarityInfo.xpForNext) break;
    newXp -= rarityInfo.xpForNext;
    newLevel += 1;
    changed = true;
  }

  return { ...spell, xp: newXp, level: newLevel, rarity: newRarity, locked };
}

async function ensureSpellSlots(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT slot, spell_id, level, xp, rarity, locked FROM user_spells WHERE guild_id = $1 AND user_id = $2 ORDER BY slot`,
    [guildId, userId]
  );
  if (rows.length >= 3) return rows;

  const existingSlots = new Set(rows.map((r) => r.slot));
  const inserts = [];
  for (const def of DEFAULT_SPELL_SLOTS) {
    if (!existingSlots.has(def.slot)) {
      inserts.push(
        pool.query(
          `INSERT INTO user_spells (guild_id, user_id, slot, spell_id, level, xp, rarity, locked) VALUES ($1, $2, $3, $4, 1, 0, $5, FALSE)
           ON CONFLICT (guild_id, user_id, slot) DO NOTHING`,
          [guildId, userId, def.slot, def.spellId, SPELL_LIBRARY[def.spellId].rarity]
        )
      );
    }
  }
  if (inserts.length) await Promise.all(inserts);
  const refreshed = await pool.query(
    `SELECT slot, spell_id, level, xp, rarity, locked FROM user_spells WHERE guild_id = $1 AND user_id = $2 ORDER BY slot`,
    [guildId, userId]
  );
  return refreshed.rows;
}

async function setSpellSlot(guildId, userId, slot, spellId) {
  const base = SPELL_LIBRARY[spellId];
  if (!base) return null;
  await pool.query(
    `
    INSERT INTO user_spells (guild_id, user_id, slot, spell_id, level, xp, rarity, locked)
    VALUES ($1, $2, $3, $4, 1, 0, $5, FALSE)
    ON CONFLICT (guild_id, user_id, slot)
    DO UPDATE SET spell_id = EXCLUDED.spell_id, level = 1, xp = 0, rarity = $5, locked = FALSE
    `,
    [guildId, userId, slot, spellId, base.rarity]
  );
  const { rows } = await pool.query(
    `SELECT slot, spell_id, level, xp, rarity, locked FROM user_spells WHERE guild_id = $1 AND user_id = $2 AND slot = $3`,
    [guildId, userId, slot]
  );
  return rows[0];
}

async function saveSpellProgress(guildId, userId, spell) {
  if (!spell) return;
  await pool.query(
    `UPDATE user_spells SET level = $1, xp = $2, rarity = $3, locked = $4 WHERE guild_id = $5 AND user_id = $6 AND slot = $7`,
    [spell.level, spell.xp, spell.rarity, spell.locked, guildId, userId, spell.slot]
  );
}

const OPPONENTS = [
  { name: "Macaco", minPower: 0, maxPower: 50, atk: 5, def: 0, hp: 50, loot: 10, attackInterval: 5 },
  { name: "Tigre", minPower: 50, maxPower: 100, atk: 15, def: 0, hp: 75, loot: 50, attackInterval: 3 },
  { name: "Leão", minPower: 100, maxPower: 150, atk: 20, def: 0, hp: 150, loot: 100, attackInterval: 6 },
  { name: "Caçador", minPower: 150, maxPower: 200, atk: 100, def: 20, hp: 200, loot: 300, attackInterval: 5 }
];

const battleSessions = new Map();

async function getUserSpells(guildId, userId) {
  const rows = await ensureSpellSlots(guildId, userId);
  return rows;
}

function spellContribution(spell) {
  const scaled = computeSpellScaling(spell);
  if (!scaled) return 0;
  return scaled.power * 0.1 + scaled.cost * 0.05;
}

function computeUserPower(progress, spells) {
  let power = (progress.hp || BASE_STATS.hp) * 0.05 + (progress.atk || 0) * 1.5 + (progress.def || 0) * 1;
  if (progress.mana) power += progress.mana * 0.01;
  for (const sp of spells || []) {
    power += spellContribution(sp);
  }
  return Math.max(0, Math.round(power));
}

function pickOpponent(power) {
  const match = OPPONENTS.find((o) => power >= o.minPower && power <= o.maxPower) || OPPONENTS[OPPONENTS.length - 1];
  return { ...match };
}

async function updateUserVitals(guildId, userId, hp, mana, moneyDelta = 0) {
  const current = await getUserProgress(guildId, userId);
  const newHp = Math.max(0, Math.min(hp, current.hpm));
  const newMana = Math.max(0, mana);
  const newMoney = Math.max(0, current.money + moneyDelta);
  await upsertUserProgress(
    guildId,
    userId,
    current.xp,
    current.level,
    current.tk,
    newMoney,
    current.class,
    newHp,
    current.hpm,
    current.atk,
    current.def,
    newMana
  );
  return { ...current, hp: newHp, mana: newMana, money: newMoney };
}

function describeSpell(spell) {
  const scaled = computeSpellScaling(spell);
  if (!scaled) return "Magia desconhecida.";
  const needed = getRarityInfo(spell.rarity).xpForNext === Infinity ? "infinito" : getRarityInfo(spell.rarity).xpForNext;
  return `${scaled.base.name} | Raridade: ${spell.rarity} | Nivel: ${spell.level} | XP: ${spell.xp}/${needed} | Custo: ${scaled.cost} mana | Poder: ${scaled.power}`;
}

function hasBattle(userId) {
  return battleSessions.has(userId);
}

async function endBattle(userId, reason, channel) {
  const session = battleSessions.get(userId);
  if (session) {
    battleSessions.delete(userId);
    if (reason && channel) {
      await channel.send({
        embeds: [
          buildActionEmbed({
            title: "Batalha encerrada",
            description: reason
          })
        ]
      });
    }
  }
}

async function processBattles(client) {
  const now = Date.now();
  for (const session of battleSessions.values()) {
    if (now >= session.nextAttackAt) {
      const channel = client.channels.cache.get(session.channelId) || await client.channels.fetch(session.channelId).catch(() => null);
      if (!channel) {
        battleSessions.delete(session.userId);
        continue;
      }
      let incoming = session.opponent.atk;
      if (session.shield > 0) {
        const absorbed = Math.min(session.shield, incoming);
        incoming -= absorbed;
        session.shield -= absorbed;
      }
      const damage = Math.max(0, incoming - session.playerDef);
      session.playerHp = Math.max(0, session.playerHp - damage);
      await updateUserVitals(session.guildId, session.userId, session.playerHp, session.playerMana);
      session.nextAttackAt = now + session.opponent.attackInterval * 1000;
      await channel.send({
        embeds: [
          buildActionEmbed({
            title: `${session.opponent.name} atacou!`,
            description: `Dano sofrido: ${damage}. HP restante: ${session.playerHp}.`
          })
        ]
      });
      if (session.playerHp <= 0) {
        await endBattle(session.userId, "Voce foi derrotado.", channel);
      }
    }
  }
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
  setInterval(() => processBattles(client), 1000);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  try {
    await addXpForMessage(message);

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift();
    if (!command) return;
    const lowerCmd = command.toLowerCase();

    if (lowerCmd === "me") {
      const { hp, hpm, atk, def, money, class: charClass, mana } = await getUserProgress(message.guild.id, message.author.id);
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
        .setTitle("Meus atributos")
        .addFields(
          { name: "HP", value: `${hp}/${hpm}`, inline: true },
          { name: "ATK", value: `${atk}`, inline: true },
          { name: "DEF", value: `${def}`, inline: true },
          { name: "💵", value: `${money}`, inline: true },
          { name: "Classe", value: charClass || "Nenhuma", inline: true },
          { name: "Mana", value: `${mana}`, inline: true }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (lowerCmd === "inventario") {
      const progress = await getUserProgress(message.guild.id, message.author.id);
      const spells = progress.class?.toLowerCase() === "mago" ? await getUserSpells(message.guild.id, message.author.id) : [];
      const spellLines = spells.map((sp) => `Slot ${sp.slot}: ${describeSpell(sp)}`);
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
        .setTitle("Inventário")
        .setDescription(spellLines.length ? spellLines.join("\n") : "Sem magias.")
        .addFields(
          { name: "Itens", value: "Armas e equipamentos: sem itens registrados ainda." },
          { name: "Moedas", value: `💵 ${progress.money}` }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (lowerCmd === "magias") {
      const progress = await getUserProgress(message.guild.id, message.author.id);
      if (progress.class?.toLowerCase() !== "mago") {
        return message.reply({ embeds: [buildActionEmbed({ title: "Somente magos", description: "Apenas magos podem ver magias." })] });
      }
      const spells = await getUserSpells(message.guild.id, message.author.id);
      const lines = spells.map((sp) => `Magia ${sp.slot}: ${describeSpell(sp)}`);
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("MAGIAS")
        .setDescription([
          "Magia 1: Muralha - nivel 1 (padrao)",
          "Magia 2: Morcego Espectral - nivel 1 (padrao)",
          "Magia 3: Descarga Eletrica - nivel 1 (padrao)",
          "",
          "Use !m1, !m2 ou !m3 para conjurar.",
          "Veja detalhes com !m1 info, !m2 info, !m3 info.",
          "Troque as magias com !m1 set <magia>, !m2 set <magia>, !m3 set <magia>.",
          "",
          "Regras: cada magia tem raridade e nivel proprios. Evoluir aumenta custo em 50% e efeito em 25% por nivel.",
          "Ao chegar no nivel maximo, a magia sobe de raridade (Comum -> Rara -> Épica -> Lendária -> Mística) e trava."
        ].join("\n"))
        .addFields(
          { name: "Suas magias", value: lines.join("\n") },
          { name: "Progresso", value: "Raridades: Comum, Rara, Épica, Lendária, Mística.\nXP: Comum 10xp lvl2 (max 25), Rara 20xp lvl2 (max 10), Épica 50xp lvl2 (max 5). Lendária vira Mística ao chegar em 1000xp. Mística nivel 999 sem xp.\nGanho de XP: +1 por uso de magia, +2 por eliminação com magia." }
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (["m1", "m2", "m3"].includes(lowerCmd)) {
      const slot = parseInt(lowerCmd.slice(1), 10);
      const progress = await getUserProgress(message.guild.id, message.author.id);
      if (progress.class?.toLowerCase() !== "mago") {
        return message.reply({ embeds: [buildActionEmbed({ title: "Somente magos", description: "Apenas magos podem usar magias." })] });
      }
      if (hasBattle(message.author.id) && args[0] && args[0].toLowerCase() === "set") {
        return message.reply({ embeds: [buildActionEmbed({ title: "Batalha ativa", description: "Nao e possivel trocar magias durante a batalha." })] });
      }
      const spells = await getUserSpells(message.guild.id, message.author.id);
      const currentSpell = spells.find((sp) => sp.slot === slot);

      const sub = (args[0] || "").toLowerCase();
      if (sub === "info") {
        if (!currentSpell) {
          return message.reply({ embeds: [buildActionEmbed({ title: "Magia nao configurada", description: "Defina uma magia primeiro." })] });
        }
        return message.reply({ embeds: [buildActionEmbed({ title: `Magia ${slot}`, description: describeSpell(currentSpell) })] });
      }

      if (sub === "set") {
        const desired = resolveSpellId(args[1]);
        if (!desired) {
          return message.reply({ embeds: [buildActionEmbed({ title: "Uso", description: `Use ${PREFIX}m${slot} set <muralha|morcego|descarga>` })] });
        }
        const updatedSpell = await setSpellSlot(message.guild.id, message.author.id, slot, desired);
        return message.reply({ embeds: [buildActionEmbed({ title: `Magia ${slot} atualizada`, description: describeSpell(updatedSpell) })] });
      }

      if (!hasBattle(message.author.id)) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Sem batalha", description: "Inicie com !caçar antes de usar magias." })] });
      }
      if (!currentSpell) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Magia nao configurada", description: "Defina uma magia com o subcomando set." })] });
      }

      const session = battleSessions.get(message.author.id);
      const scaled = computeSpellScaling(currentSpell);
      if (!scaled) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Magia invalida", description: "Nao consegui ler essa magia." })] });
      }
      if (session.playerMana < scaled.cost) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Mana insuficiente", description: `Custo: ${scaled.cost}. Mana atual: ${session.playerMana}.` })] });
      }

      session.playerMana -= scaled.cost;
      let desc = "";
      if (scaled.base.type === "shield") {
        session.shield += scaled.power;
        desc = `Barreira ativada com ${scaled.power} de protecao. Escudo atual: ${session.shield}.`;
      } else if (scaled.base.type === "lifesteal") {
        const raw = Math.max(0, scaled.power - session.opponent.def);
        session.opponentHp = Math.max(0, session.opponentHp - raw);
        const heal = Math.round(raw * 0.5);
        session.playerHp = Math.min(session.playerHp + heal, session.playerHpm);
        desc = `Dano causado: ${raw}. Vida recuperada: ${heal}. HP: ${session.playerHp}/${session.playerHpm}.`;
      } else {
        const raw = Math.max(0, scaled.power - session.opponent.def);
        session.opponentHp = Math.max(0, session.opponentHp - raw);
        desc = `Dano causado: ${raw}. HP do oponente: ${session.opponentHp}/${session.opponentMaxHp}.`;
      }

      const progressed = gainSpellXp(currentSpell, 1);
      await saveSpellProgress(message.guild.id, message.author.id, progressed);
      battleSessions.set(message.author.id, { ...session, lastSpellUsed: slot });
      await updateUserVitals(message.guild.id, message.author.id, session.playerHp, session.playerMana);

      if (session.opponentHp <= 0) {
        const reward = session.opponent.loot;
        const spellWin = gainSpellXp(progressed, 2);
        await saveSpellProgress(message.guild.id, message.author.id, spellWin);
        await updateUserVitals(message.guild.id, message.author.id, session.playerHp, session.playerMana, reward);
        await endBattle(message.author.id, `Vitoria sobre ${session.opponent.name}! Loot: ${reward} 💵 adicionado ao inventario.`, message.channel);
        return;
      }

      const embed = buildActionEmbed({
        title: `Magia ${slot} usada`,
        description: `${scaled.base.name} - custo ${scaled.cost} mana.`,
        fields: [
          { name: "Efeito", value: desc },
          { name: "Mana restante", value: `${session.playerMana}` }
        ]
      });
      return message.reply({ embeds: [embed] });
    }

    if (lowerCmd === "caçar" || lowerCmd === "cacar") {
      if (hasBattle(message.author.id)) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Batalha em andamento", description: "Finalize a luta antes de caçar novamente." })] });
      }
      const progress = await getUserProgress(message.guild.id, message.author.id);
      const spells = progress.class?.toLowerCase() === "mago" ? await getUserSpells(message.guild.id, message.author.id) : [];
      const power = computeUserPower(progress, spells);
      const opponent = pickOpponent(power);

      const session = {
        userId: message.author.id,
        guildId: message.guild.id,
        channelId: message.channel.id,
        opponent,
        opponentHp: opponent.hp,
        opponentMaxHp: opponent.hp,
        playerHp: progress.hp || progress.hpm,
        playerHpm: progress.hpm,
        playerMana: progress.mana || 0,
        playerAtk: progress.atk,
        playerDef: progress.def,
        playerClass: progress.class,
        shield: 0,
        nextAttackAt: Date.now() + opponent.attackInterval * 1000
      };
      battleSessions.set(message.author.id, session);

      const embed = buildActionEmbed({
        title: "Caçada iniciada",
        description: `Oponente encontrado: **${opponent.name}**`,
        fields: [
          { name: "Poder avaliado", value: `${power}`, inline: true },
          { name: "Alvo", value: `${opponent.hp} HP | ${opponent.atk} ATK | ${opponent.def} DEF`, inline: true },
          { name: "Loot", value: `${opponent.loot} 💵`, inline: true },
          { name: "Dicas", value: "Use !atk para ataques basicos e !m1/!m2/!m3 para magias. O oponente ataca automaticamente." }
        ]
      });
      return message.reply({ embeds: [embed] });
    }

    if (lowerCmd === "atk") {
      if (!hasBattle(message.author.id)) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Sem batalha", description: "Use !caçar para iniciar uma luta." })] });
      }
      const session = battleSessions.get(message.author.id);
      const damage = Math.max(0, session.playerAtk - session.opponent.def);
      session.opponentHp = Math.max(0, session.opponentHp - damage);
      let desc = `Dano causado: ${damage}. HP do oponente: ${session.opponentHp}/${session.opponentMaxHp}.`;
      if (session.opponentHp <= 0) {
        const reward = session.opponent.loot;
        await updateUserVitals(message.guild.id, message.author.id, session.playerHp, session.playerMana, reward);
        await endBattle(message.author.id, `Vitoria sobre ${session.opponent.name}! Loot: ${reward} 💵 adicionado ao inventario.`, message.channel);
        return;
      }
      battleSessions.set(message.author.id, session);
      return message.reply({ embeds: [buildActionEmbed({ title: "Ataque basico", description: desc })] });
    }

    if (lowerCmd === "perfil") {
      const { xp, level, tk, money } = await getUserProgress(message.guild.id, message.author.id);
      const nextLevel = level + 1;
      const nextLevelXp = xpForLevel(nextLevel);
      const toNext = nextLevelXp - xp;

      const fields = [
        { name: "XP", value: `${xp}`, inline: true },
        { name: "Nivel", value: `${level}`, inline: true },
        { name: "Para o proximo", value: `${toNext} XP`, inline: true },
        { name: "TK", value: `${tk}`, inline: true },
        { name: "💵", value: `${money}`, inline: true }
      ];

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
        .setTitle("Perfil")
        .addFields(fields)
        .setFooter({ text: `Prefixo: ${PREFIX} | Comando: ${PREFIX}perfil` })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }
    if (command.toLowerCase() === "start") {
      const currentProfile = await getUserProgress(message.guild.id, message.author.id);
      if (currentProfile.class && currentProfile.class !== "0") {
        return message.reply({ embeds: [buildActionEmbed({ title: "Classe ja escolhida", description: `Voce ja escolheu: ${currentProfile.class}. A escolha e unica.` }).setColor(EMBED_COLOR)] });
      }

      const classKey = (args[0] || "").toLowerCase();
      if (!classKey) {
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
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
        return message.reply({ embeds: [buildActionEmbed({ title: "Classe invalida", description: "Use arqueiro, assassino, militar ou mago." }).setColor(EMBED_COLOR)] });
      }
      if (updated.locked) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Classe ja escolhida", description: `Voce ja escolheu: ${updated.currentClass}. A escolha e unica.` }).setColor(EMBED_COLOR)] });
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
      }).setColor(EMBED_COLOR);
      return message.reply({ embeds: [embed] });
    }

    if (command.toLowerCase() === "ban") {
      if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Permissao insuficiente", description: "Voce precisa de permissao de banir membros." }).setColor(EMBED_COLOR)] });
      }

      const targetId = (message.mentions.users.first()?.id) || args.shift();
      if (!targetId) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Uso", description: `${PREFIX}ban @usuario <tempo opcional> <motivo>` }).setColor(EMBED_COLOR)] });
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
        return message.reply({ embeds: [buildActionEmbed({ title: "Erro ao banir", description: "Nao consegui banir o usuario." }).setColor(EMBED_COLOR)] });
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
        return message.reply({ embeds: [buildActionEmbed({ title: "Acesso negado", description: "Somente o proprietario autorizado pode usar este comando." }).setColor(EMBED_COLOR)] });
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
            }).setColor(EMBED_COLOR)
          ]
        });
      }

      if (variableName === "level") {
        return message.reply({
          embeds: [
            buildActionEmbed({
              title: "Nivel bloqueado",
              description: "Nivel nao pode ser alterado diretamente."
            }).setColor(EMBED_COLOR)
          ]
        });
      }

      if (variableName === "class" && mode !== "set") {
        return message.reply({
          embeds: [
            buildActionEmbed({
              title: "Classe",
              description: "Use apenas o modo set para classe."
            }).setColor(EMBED_COLOR)
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
            }).setColor(EMBED_COLOR)
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
              }).setColor(EMBED_COLOR)
            ]
          });
        }
        if (err.message === "class-set-only") {
          return message.reply({
            embeds: [
              buildActionEmbed({
                title: "Classe",
                description: "Classe so pode ser alterada com o modo set."
              }).setColor(EMBED_COLOR)
            ]
          });
        }
        console.error("Erro ao alterar variavel:", err);
        return message.reply({ embeds: [buildActionEmbed({ title: "Erro", description: "Nao foi possivel alterar a variavel." }).setColor(EMBED_COLOR)] });
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
        return message.reply({ embeds: [buildActionEmbed({ title: "Permissao insuficiente", description: "Voce precisa de permissao de moderar membros." }).setColor(EMBED_COLOR)] });
      }

      const targetMember = message.mentions.members.first() || (await message.guild.members.fetch(args[0]).catch(() => null));
      if (!targetMember) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Uso", description: `${PREFIX}mute @usuario <tempo> <motivo>` }).setColor(EMBED_COLOR)] });
      }

      const durationMs = parseDuration(args[1] || args[0]);
      if (!durationMs) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Duracao invalida", description: "Use formatos como 10m, 2h, 3d, 1y (max 100 anos)." }).setColor(EMBED_COLOR)] });
      }

      if (durationMs > MAX_TIMEOUT_MS) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Limite do Discord", description: "Timeout nao pode passar de 28 dias." }).setColor(EMBED_COLOR)] });
      }

      const reasonStartIndex = args[1] ? 2 : 1;
      const reason = args.slice(reasonStartIndex).join(" ") || "Sem motivo";

      try {
        await targetMember.timeout(durationMs, reason);
      } catch (err) {
        console.error("Erro ao mutar:", err);
        return message.reply({ embeds: [buildActionEmbed({ title: "Erro ao mutar", description: "Nao consegui aplicar timeout." }).setColor(EMBED_COLOR)] });
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
        return message.reply({ embeds: [buildActionEmbed({ title: "Permissao insuficiente", description: "Voce precisa de permissao de expulsar membros." }).setColor(EMBED_COLOR)] });
      }

      const targetMember = message.mentions.members.first() || (await message.guild.members.fetch(args[0]).catch(() => null));
      if (!targetMember) {
        return message.reply({ embeds: [buildActionEmbed({ title: "Uso", description: `${PREFIX}expulsar @usuario <motivo>` }).setColor(EMBED_COLOR)] });
      }

      const reason = args.slice(1).join(" ") || "Sem motivo";

      try {
        await targetMember.kick(reason);
      } catch (err) {
        console.error("Erro ao expulsar:", err);
        return message.reply({ embeds: [buildActionEmbed({ title: "Erro ao expulsar", description: "Nao consegui expulsar o usuario." }).setColor(EMBED_COLOR)] });
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
