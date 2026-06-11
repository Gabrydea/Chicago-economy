const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

const token = process.env.DISCORD_BOT_TOKEN;
const dbUrl = process.env.DATABASE_URL;

if (!token) { console.error("DISCORD_BOT_TOKEN mancante"); process.exit(1); }
if (!dbUrl) { console.error("DATABASE_URL mancante"); process.exit(1); }

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function query(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function setupDb() {
  await query(`CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0, last_daily TIMESTAMPTZ, last_work TIMESTAMPTZ,
    UNIQUE(user_id, guild_id))`);
  await query(`CREATE TABLE IF NOT EXISTS shop_items (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
    price INTEGER NOT NULL, emoji TEXT NOT NULL DEFAULT '🎁', guild_id TEXT)`);
  await query(`CREATE TABLE IF NOT EXISTS inventory_items (
    id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
    item_id INTEGER NOT NULL, item_name TEXT NOT NULL, item_emoji TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1)`);
  const { rows } = await query("SELECT 1 FROM shop_items LIMIT 1");
  if (rows.length === 0) {
    await query(`INSERT INTO shop_items (name,description,price,emoji) VALUES
      ('Lucky Charm','Un amuleto che porta fortuna.',500,'🍀'),
      ('VIP Badge','Badge VIP esclusivo.',2500,'💎'),
      ('Golden Trophy','Trofeo d''oro per i campioni.',5000,'🏆'),
      ('Mystery Box','Contiene qualcosa di misterioso.',1000,'📦'),
