const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { Pool } = require("pg");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { createCanvas, loadImage, registerFont } = require("canvas");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end("Bot online!"); }).listen(PORT, () => {
  console.log(`Health check su porta ${PORT}`);
});
const token = process.env.DISCORD_BOT_TOKEN;
const dbUrl = process.env.DATABASE_URL;
const STAFF_ROLE_ID = "1504115375577497600";
const CONTACT_USER_ID = "1141049314433573044";
const POSTINO_ROLE_ID = "1515749955242037460";
const DEFAULT_ROLE_SALARIES = {
  "1514961491433099386": 150,
  "1514960724626116721": 100,
  "1512153845373993001": 200,
  "1512029409211715715": 200,
  "1504115591676559533": 250,
  "1504115627844042905": 100,
  "1504115690116874311": 100,
  "1504115728859529371": 150,
  "1504115619291730041": 100,
};
const SHOP_CATALOG = [
  { name: "Telefonia", value: "telefonia" },
  { name: "Elettronica", value: "elettronica" },
  { name: "Supermercato", value: "supermercato" },
  { name: "Farmacia", value: "farmacia" },
  { name: "Abbigliamento", value: "abbigliamento" },
  { name: "Gioielleria", value: "gioielleria" },
  { name: "Concessionaria", value: "concessionaria" },
  { name: "Garage e Ricambi", value: "garage" },
  { name: "Benzinaio", value: "benzinaio" },
  { name: "Immobiliare", value: "immobiliare" },
  { name: "Arredamento", value: "arredamento" },
  { name: "Ferramenta", value: "ferramenta" },
  { name: "Ristorante", value: "ristorante" },
  { name: "Fast Food", value: "fast_food" },
  { name: "Pizzeria", value: "pizzeria" },
  { name: "Bar", value: "bar" },
  { name: "Gelateria", value: "gelateria" },
  { name: "Panetteria", value: "panetteria" },
  { name: "Animali", value: "animali" },
  { name: "Ospedale", value: "ospedale" },
  { name: "Parrucchiere", value: "parrucchiere" },
];
const CARD_FONT_FAMILY = "ChicagoCardSans";
const salaryCache = new Map();
if (!token) { console.error("DISCORD_BOT_TOKEN mancante"); process.exit(1); }
if (!dbUrl) { console.error("DATABASE_URL mancante"); process.exit(1); }
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
async function query(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}
function hashPin(pin) {
  return crypto.createHash("sha256").update(String(pin)).digest("hex");
}
function getShopName(shopKey) {
  return SHOP_CATALOG.find(shop => shop.value === shopKey)?.name || shopKey;
}
function isImageAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(attachment.url || "");
}
function shorten(text, max = 90) {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function getPinEncryptionKey() {
  const secret = process.env.PIN_ENCRYPTION_SECRET || token;
  return crypto.createHash("sha256").update(secret).digest();
}
function encryptPin(pin) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getPinEncryptionKey(), iv);
  let enc = cipher.update(String(pin), "utf8", "hex");
  enc += cipher.final("hex");
  return `${iv.toString("hex")}:${enc}`;
}
function decryptPin(pinEnc) {
  if (!pinEnc) return null;
  const [ivHex, enc] = pinEnc.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", getPinEncryptionKey(), iv);
  let dec = decipher.update(enc, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}
function parsePrice(priceStr) {
  if (typeof priceStr === "number") return Math.round(priceStr * 100);
  const normalized = String(priceStr).replace(",", ".");
  const parsed = parseFloat(normalized);
  return Math.round(parsed * 100);
}
async function setupDb() {
  await query(`CREATE TABLE IF NOT EXISTS bank_accounts (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    balance BIGINT NOT NULL DEFAULT 0,
    pin_hash TEXT,
    salary_paid_month TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, guild_id)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    from_user_id TEXT,
    to_user_id TEXT,
    guild_id TEXT NOT NULL,
    amount BIGINT NOT NULL,
    reason TEXT,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS cards (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    nome TEXT NOT NULL,
    cognome TEXT NOT NULL,
    pin_enc TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, guild_id)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS role_salaries (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    amount BIGINT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, role_id)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    creator_user_id TEXT NOT NULL,
    shop_key TEXT NOT NULL,
    name TEXT NOT NULL,
    price BIGINT NOT NULL,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_products_guild_shop ON products(guild_id, shop_key)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_products_creator ON products(guild_id, creator_user_id)`);
  await query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS pin_enc TEXT`).catch(() => {});
  console.log("Database pronto.");
}
async function loadSalaries(guildId) {
  const { rows } = await query("SELECT role_id, amount FROM role_salaries WHERE guild_id=$1", [guildId]);
  const map = new Map();
  for (const r of rows) map.set(r.role_id, Number(r.amount));
  salaryCache.set(guildId, map);
  return map;
}
async function getSalaries(guildId) {
  if (salaryCache.has(guildId)) return salaryCache.get(guildId);
  return await loadSalaries(guildId);
}
async function seedDefaultSalaries(guildId) {
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM role_salaries WHERE guild_id=$1", [guildId]);
  if (rows[0].n > 0) return;
  for (const [roleId, amount] of Object.entries(DEFAULT_ROLE_SALARIES)) {
    await query(
      "INSERT INTO role_salaries(guild_id, role_id, amount) VALUES($1,$2,$3) ON CONFLICT (guild_id, role_id) DO NOTHING",
      [guildId, roleId, amount]
    );
  }
  await loadSalaries(guildId);
  console.log(`Stipendi di default inseriti per la guild ${guildId}`);
}
async function getAccount(userId, guildId) {
  const { rows } = await query("SELECT * FROM bank_accounts WHERE user_id=$1 AND guild_id=$2", [userId, guildId]);
  return rows[0] || null;
}
async function getCard(userId, guildId) {
  const { rows } = await query("SELECT * FROM cards WHERE user_id=$1 AND guild_id=$2", [userId, guildId]);
  return rows[0] || null;
}
async function getProduct(productId, guildId) {
  const { rows } = await query("SELECT * FROM products WHERE id=$1 AND guild_id=$2", [productId, guildId]);
  return rows[0] || null;
}
async function getShopProductCounts(guildId) {
  const { rows } = await query(
    "SELECT shop_key, COUNT(*)::int AS count FROM products WHERE guild_id=$1 GROUP BY shop_key ORDER BY shop_key",
    [guildId]
  );
  return rows;
}
async function listProductsForShop(guildId, shopKey) {
  const { rows } = await query(
    "SELECT * FROM products WHERE guild_id=$1 AND shop_key=$2 ORDER BY created_at DESC, id DESC LIMIT 25",
    [guildId, shopKey]
  );
  return rows;
}
async function completeOnlinePurchase({ buyerId, sellerId, guildId, amount, productName, productId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const buyerResult = await client.query(
      "SELECT * FROM bank_accounts WHERE user_id=$1 AND guild_id=$2 FOR UPDATE",
      [buyerId, guildId]
    );
    const sellerResult = await client.query(
      "SELECT * FROM bank_accounts WHERE user_id=$1 AND guild_id=$2 FOR UPDATE",
      [sellerId, guildId]
    );
    const buyer = buyerResult.rows[0];
    const seller = sellerResult.rows[0];
    if (!buyer) throw new Error("BUYER_ACCOUNT_MISSING");
    if (!seller) throw new Error("SELLER_ACCOUNT_MISSING");
    if (Number(buyer.balance) < amount) throw new Error("INSUFFICIENT_FUNDS");
    await client.query("UPDATE bank_accounts SET balance=balance-$1 WHERE user_id=$2 AND guild_id=$3", [amount, buyerId, guildId]);
    await client.query("UPDATE bank_accounts SET balance=balance+$1 WHERE user_id=$2 AND guild_id=$3", [amount, sellerId, guildId]);
    await client.query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES($1,$2,$3,$4,$5,'acquisto_online')",
      [buyerId, sellerId, guildId, amount, `Acquisto online #${productId}: ${productName}`]
    );
    await client.query("COMMIT");
    return { buyerBalance: Number(buyer.balance) - amount, sellerBalance: Number(seller.balance) + amount };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
function euros(n) { 
  const centesimi = Number(n);
  const euro = Math.floor(centesimi / 100);
  const cent = centesimi % 100;
  if (cent === 0) return `**${euro.toLocaleString("it-IT")} €**`;
  return `**${euro},${String(cent).padStart(2, "0")} €**`;
}
function err(msg) { return new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Errore").setDescription(msg); }
function calcolaStipendio(member, salaries) {
  let totale = 0;
  const ruoli = [];
  for (const [roleId, importo] of salaries.entries()) {
    if (member.roles.cache.has(roleId)) {
      totale += importo;
      ruoli.push({ roleId, importo });
    }
  }
  return { totale, ruoli };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
let cardFontsLoaded = false;
function ensureCardFonts() {
  if (cardFontsLoaded) return;
  try {
    registerFont(path.join(__dirname, "assets", "fonts", "NotoSans-Regular.ttf"), {
      family: CARD_FONT_FAMILY,
      weight: "normal",
    });
    registerFont(path.join(__dirname, "assets", "fonts", "NotoSans-Bold.ttf"), {
      family: CARD_FONT_FAMILY,
      weight: "bold",
    });
    cardFontsLoaded = true;
    console.log("Font carta caricati.");
  } catch (error) {
    console.error("Impossibile caricare i font della carta, uso fallback di sistema.", error);
  }
}
function setCardFont(ctx, size, { bold = false } = {}) {
  ctx.font = `${bold ? "bold " : ""}${size}px "${CARD_FONT_FAMILY}", sans-serif`;
}
function drawCardText(ctx, text, x, y, { color = "#ffffff", stroke = "rgba(0,0,0,0.55)", lineWidth = 3 } = {}) {
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
function fitText(ctx, text, maxWidth) {
  let value = String(text ?? "").trim();
  if (!value) return "—";
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}
function drawSoftLine(ctx, x1, y1, x2, y2, color = "rgba(255,255,255,0.18)") {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}
async function generateCardImage(user, nome, cognome, createdAt, { isPublic = true, pin = null } = {}) {
  ensureCardFonts();
  const canvas = createCanvas(860, 540);
  const ctx = canvas.getContext("2d");
  if ("textDrawingMode" in ctx) ctx.textDrawingMode = "glyph";
  
  // BACKGROUND LUMINOSO
  const bg = ctx.createLinearGradient(0, 0, 860, 540);
  bg.addColorStop(0, "#0f1e2e");
  bg.addColorStop(0.5, "#1a3a42");
  bg.addColorStop(1, "#0f1e2e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 860, 540);

  // Glow superiore
  const glowA = ctx.createRadialGradient(690, 110, 20, 690, 110, 310);
  glowA.addColorStop(0, "rgba(255, 214, 112, 0.5)");
  glowA.addColorStop(1, "rgba(255, 214, 112, 0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, 860, 540);
  
  // Glow inferiore
  const glowB = ctx.createRadialGradient(170, 430, 20, 170, 430, 290);
  glowB.addColorStop(0, "rgba(106, 225, 255, 0.4)");
  glowB.addColorStop(1, "rgba(106, 225, 255, 0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, 860, 540);

  // Decorazioni
  ctx.save();
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc(72 + i * 78, 52 + (i % 3) * 164, 58 + (i % 2) * 26, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 ? "#f7d26a" : "#78e7ff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // Border principale
  roundRect(ctx, 24, 24, 812, 492, 34);
  const glass = ctx.createLinearGradient(24, 24, 836, 516);
  glass.addColorStop(0, "rgba(255,255,255,0.25)");
  glass.addColorStop(0.52, "rgba(255,255,255,0.1)");
  glass.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 219, 126, 1)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Card info box
  roundRect(ctx, 46, 54, 492, 366, 28);
  ctx.fillStyle = "rgba(20, 40, 60, 0.7)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Titolo
  const accent = ctx.createLinearGradient(52, 48, 450, 92);
  accent.addColorStop(0, "#ffd46a");
  accent.addColorStop(0.5, "#ffc94d");
  accent.addColorStop(1, "#7ff3ff");
  setCardFont(ctx, 24, { bold: true });
  drawCardText(ctx, "CHICAGO CITY RP", 58, 82, { color: accent, stroke: "rgba(0,0,0,0.7)", lineWidth: 4 });
  
  setCardFont(ctx, 14);
  drawCardText(ctx, isPublic ? "CARTA IDENTITÀ · PUBBLICA" : "CARTA IDENTITÀ · COMPLETA", 58, 112, {
    color: "rgba(255, 238, 185, 1)",
    stroke: "rgba(0,0,0,0.7)",
    lineWidth: 3,
  });

  // Status badge
  roundRect(ctx, 620, 66, 154, 42, 16);
  ctx.fillStyle = isPublic ? "rgba(126, 243, 255, 0.2)" : "rgba(255, 199, 89, 0.25)";
  ctx.fill();
  ctx.strokeStyle = isPublic ? "rgba(126,243,255,0.8)" : "rgba(255,199,89,0.9)";
  ctx.lineWidth = 1;
  ctx.stroke();
  setCardFont(ctx, 13, { bold: true });
  drawCardText(ctx, isPublic ? "PUBLIC VIEW" : "OWNER ONLY", 642, 93, {
    color: isPublic ? "#7ff3ff" : "#ffdb7d",
    stroke: "rgba(0,0,0,0.65)",
    lineWidth: 2,
  });

  // Avatar
  const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
  const avatarImage = await loadImage(avatarUrl);
  const avatarX = 682;
  const avatarY = 286;
  const avatarRadius = 92;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 11, 0, Math.PI * 2);
  const avatarRing = ctx.createLinearGradient(avatarX - 110, avatarY - 110, avatarX + 110, avatarY + 110);
  avatarRing.addColorStop(0, "#fff2aa");
  avatarRing.addColorStop(0.45, "#d4af37");
  avatarRing.addColorStop(1, "#7ff3ff");
  ctx.fillStyle = avatarRing;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(avatarImage, avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.ellipse(682, 286, 132, 48, -0.46, 0, Math.PI * 2);
  ctx.strokeStyle = "#7ff3ff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Nome
  const safeNome = String(nome ?? "").toUpperCase();
  const safeCognome = String(cognome ?? "").toUpperCase();
  setCardFont(ctx, 46, { bold: true });
  drawCardText(ctx, fitText(ctx, safeNome, 430), 58, 186, { color: "#ffffff", stroke: "rgba(0,0,0,0.8)", lineWidth: 5 });
  
  // Cognome o nascosto
  if (!isPublic && safeCognome) {
    setCardFont(ctx, 34, { bold: true });
    drawCardText(ctx, fitText(ctx, safeCognome, 420), 58, 236, { color: "#ffe08b", stroke: "rgba(0,0,0,0.75)", lineWidth: 4 });
  } else {
    roundRect(ctx, 58, 211, 282, 36, 14);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fill();
    setCardFont(ctx, 14, { bold: true });
    drawCardText(ctx, "COGNOME NASCOSTO", 76, 235, {
      color: "rgba(255,255,255,0.88)",
      stroke: "rgba(0,0,0,0.65)",
      lineWidth: 2,
    });
  }
  
  // Data creazione
  const dataCreazione = new Date(createdAt).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
  setCardFont(ctx, 15, { bold: true });
  drawCardText(ctx, `MEMBRO DAL ${dataCreazione.toUpperCase()}`, 58, 292, {
    color: "rgba(255,255,255,0.95)",
    stroke: "rgba(0,0,0,0.73)",
    lineWidth: 3,
  });
  
  // Username
  setCardFont(ctx, 17, { bold: true });
  drawCardText(ctx, fitText(ctx, `@${user.username}`, 330), 58, 326, {
    color: "#7ff3ff",
    stroke: "rgba(0,0,0,0.73)",
    lineWidth: 3,
  });

  drawSoftLine(ctx, 58, 354, 492, 354, "rgba(255,255,255,0.25)");
  
  // PIN o nascosto
  if (!isPublic && pin) {
    roundRect(ctx, 58, 374, 250, 58, 16);
    ctx.fillStyle = "rgba(255, 210, 106, 0.2)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 219, 126, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    setCardFont(ctx, 23, { bold: true });
    drawCardText(ctx, `PIN · ${pin}`, 78, 411, { color: "#ffffff", stroke: "rgba(0,0,0,0.73)", lineWidth: 4 });
  } else if (isPublic) {
    roundRect(ctx, 58, 374, 298, 58, 16);
    ctx.fillStyle = "rgba(126, 243, 255, 0.16)";
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 243, 255, 0.6)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    setCardFont(ctx, 15, { bold: true });
    drawCardText(ctx, "PIN E DATI SENSIBILI NASCOSTI", 76, 410, {
      color: "rgba(200, 250, 255, 0.95)",
      stroke: "rgba(0,0,0,0.68)",
      lineWidth: 2.5,
    });
  }

  // Footer box
  roundRect(ctx, 584, 404, 194, 48, 14);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fill();
  setCardFont(ctx, 13, { bold: true });
  drawCardText(ctx, isPublic ? "SAFE PUBLIC CARD" : "PRIVATE OWNER CARD", 606, 434, {
    color: "rgba(255,255,255,0.88)",
    stroke: "rgba(0,0,0,0.65)",
    lineWidth: 2,
  });

  setCardFont(ctx, 16, { bold: true });
  drawCardText(ctx, "Chicago City Rp Card", 58, 486, {
    color: "rgba(255, 225, 142, 0.98)",
    stroke: "rgba(0,0,0,0.73)",
    lineWidth: 3,
  });
  
  setCardFont(ctx, 12, { bold: true });
  drawCardText(ctx, isPublic ? "Premi "Vedi tutto" solo se questa carta è tua" : "Documento riservato — non condividere", 58, 510, {
    color: "rgba(255,255,255,0.78)",
    stroke: "rgba(0,0,0,0.70)",
    lineWidth: 2,
  });
  return canvas.toBuffer("image/png");
}
async function pagareStipendiGuild(client) {
  const now = new Date();
  if (now.getDate() !== 1) return;
  const mese = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { rows } = await query(
    "SELECT * FROM bank_accounts WHERE (salary_paid_month IS NULL OR salary_paid_month != $1)",
    [mese]
  );
  const guildCache = new Map();
  for (const acc of rows) {
    let guild = guildCache.get(acc.guild_id);
    if (guild === undefined) {
      try {
        guild = await client.guilds.fetch(acc.guild_id);
      } catch {
        guild = null;
      }
      guildCache.set(acc.guild_id, guild);
    }
    if (!guild) continue;
    let member;
    try {
      member = await guild.members.fetch(acc.user_id);
    } catch {
      member = null;
    }
    if (!member) continue;
    const salaries = await getSalaries(acc.guild_id);
    const { totale, ruoli } = calcolaStipendio(member, salaries);
    if (totale <= 0) {
      try {
        const u = await client.users.fetch(acc.user_id);
        await u.send({ embeds: [new EmbedBuilder().setColor(0xe67e22)
          .setTitle("⚠️ Nessuno Stipendio Questo Mese")
          .setDescription(`Non hai nessun ruolo lavorativo assegnato, quindi non puoi ricevere lo stipendio mensile.\n\n> Contatta <@${CONTACT_USER_ID}> per farti assegnare un ruolo e iniziare a [...]
          .setTimestamp()] });
      } catch {}
      console.log(`Nessun ruolo lavorativo per ${acc.user_id} (guild: ${acc.guild_id}) - avviso inviato`);
      continue;
    }
    await query(
      "UPDATE bank_accounts SET balance=balance+$1, salary_paid_month=$2 WHERE user_id=$3 AND guild_id=$4",
      [totale, mese, acc.user_id, acc.guild_id]
    );
    await query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES(NULL,$1,$2,$3,'Stipendio mensile automatico','stipendio')",
      [acc.user_id, acc.guild_id, totale]
    );
    const dettaglioRuoli = ruoli.map(r => `<@&${r.roleId}> → ${euros(r.importo * 100)}`).join("\n");
    try {
      const u = await client.users.fetch(acc.user_id);
      await u.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
        .setTitle("💰 Stipendio Accreditato!")
        .setDescription(`Il tuo stipendio mensile di ${euros(totale * 100)} è stato accreditato sul tuo conto bancario! 🎉`)
        .addFields({ name: "Dettaglio ruoli", value: dettaglioRuoli })
        .setTimestamp()] });
    } catch {}
    console.log(`Stipendio di ${totale} pagato a ${acc.user_id} (guild: ${acc.guild_id})`);
  }
}
const commands = [
  new SlashCommandBuilder()
    .setName("apriconto")
    .setDescription("Apri un conto bancario per ricevere lo stipendio mensile"),
  new SlashCommandBuilder()
    .setName("creapin")
    .setDescription("Crea il PIN del tuo conto bancario (4 cifre)")
    .addIntegerOption(o => o.setName("pin").setDescription("Il tuo PIN a 4 cifre").setRequired(true).setMinValue(1000).setMaxValue(9999)),
  new SlashCommandBuilder()
    .setName("modificapin")
    .setDescription("Modifica il PIN del tuo conto bancario")
    .addIntegerOption(o => o.setName("vecchiopin").setDescription("Il PIN attuale").setRequired(true).setMinValue(1000).setMaxValue(9999))
    .addIntegerOption(o => o.setName("nuovopin").setDescription("Il nuovo PIN a 4 cifre").setRequired(true).setMinValue(1000).setMaxValue(9999)),
  new SlashCommandBuilder()
    .setName("paga")
    .setDescription("Paga un utente con soldi dal tuo conto bancario")
    .addUserOption(o => o.setName("utente").setDescription("Chi vuoi pagare").setRequired(true))
    .addIntegerOption(o => o.setName("importo").setDescription("Quanti euro inviare").setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo del pagamento").setRequired(true))
    .addIntegerOption(o => o.setName("pin").setDescription("Il tuo PIN per confermare").setRequired(true).setMinValue(1000).setMaxValue(9999)),
  new SlashCommandBuilder()
    .setName("sequestra")
    .setDescription("[SOLO STAFF] Sequestra soldi da un utente")
    .addUserOption(o => o.setName("utente").setDescription("Utente a cui sequestrare i soldi").setRequired(true))
    .addIntegerOption(o => o.setName("importo").setDescription("Importo da sequestrare").setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo del sequestro").setRequired(false)),
  new SlashCommandBuilder()
    .setName("saldo")
    .setDescription("Controlla il saldo del tuo conto bancario"),
  new SlashCommandBuilder()
    .setName("stipendio")
    .setDescription("Controlla quanto stipendio mensile ricevi in base ai tuoi ruoli"),
  new SlashCommandBuilder()
    .setName("tassa")
    .setDescription("[SOLO STAFF] Applica una tassa a tutti i conti bancari del server")
    .addIntegerOption(o => o.setName("percentuale").setDescription("Percentuale da tassare (1-50%)").setRequired(true).setMinValue(1).setMaxValue(50))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo della tassa").setRequired(false)),
  new SlashCommandBuilder()
    .setName("creacarta")
    .setDescription("Crea la tua carta Chicago City Rp Card")
    .addStringOption(o => o.setName("nome").setDescription("Il tuo nome").setRequired(true))
    .addStringOption(o => o.setName("cognome").setDescription("Il tuo cognome").setRequired(true))
    .addIntegerOption(o => o.setName("pin").setDescription("Il tuo PIN a 4 cifre").setRequired(true).setMinValue(1000).setMaxValue(9999)),
  new SlashCommandBuilder()
    .setName("mostracarta")
    .setDescription("Mostra nel canale una carta pubblica, senza cognome e senza PIN")
    .addUserOption(o => o.setName("utente").setDescription("Carta da mostrare pubblicamente").setRequired(false)),
  new SlashCommandBuilder()
    .setName("creaprodotto")
    .setDescription("Crea un prodotto vendibile in un negozio online")
    .addStringOption(o => o.setName("negozio").setDescription("Negozio in cui mettere il prodotto").setRequired(true).addChoices(...SHOP_CATALOG))
    .addStringOption(o => o.setName("nome").setDescription("Nome del prodotto").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("costo").setDescription("Prezzo in euro (es: 19.99 o 19,99)").setRequired(true))
    .addAttachmentOption(o => o.setName("immagine").setDescription("Foto del prodotto").setRequired(true)),
  new SlashCommandBuilder()
    .setName("eliminaprodotto")
    .setDescription("Elimina un prodotto che hai creato")
    .addIntegerOption(o => o.setName("id").setDescription("ID del prodotto da eliminare").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName("compraonline")
    .setDescription("Pubblica il pannello con il bottone Ordina online")
    .addAttachmentOption(o => o.setName("immagine").setDescription("Immagine/banner del negozio online").setRequired(false)),
  new SlashCommandBuilder()
    .setName("setstipendio")
    .setDescription("[SOLO STAFF] Imposta o modifica lo stipendio mensile di un ruolo")
    .addRoleOption(o => o.setName("ruolo").setDescription("Il ruolo a cui assegnare lo stipendio").setRequired(true))
    .addIntegerOption(o => o.setName("importo").setDescription("Stipendio mensile in euro").setRequired(true).setMinValue(0)),
  new SlashCommandBuilder()
    .setName("rimuovistipendio")
    .setDescription("[SOLO STAFF] Rimuove lo stipendio associato a un ruolo")
    .addRoleOption(o => o.setName("ruolo").setDescription("Il ruolo da cui rimuovere lo stipendio").setRequired(true)),
  new SlashCommandBuilder()
    .setName("listastipendi")
    .setDescription("[SOLO STAFF] Mostra tutti gli stipendi per ruolo configurati"),
];
function buildPublicCardReply(user, imgBuffer) {
  const attachment = new AttachmentBuilder(imgBuffer, { name: "carta_pubblica.png" });
  const fullCardButton = new ButtonBuilder()
    .setCustomId(`carta_completa_${user.id}`)
    .setLabel("👁️ Vedi tutto")
    .setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(fullCardButton);
  return {
    content: "",
    embeds: [new EmbedBuilder().setColor(0xD4AF37)
      .setTitle("💳 Chicago City Rp Card - Versione Pubblica")
      .setDescription(`Carta identità di ${user}.\n*Cognome e PIN nascosti. Clicca il pulsante sotto se sei il proprietario per vedere tutto.*`)
      .setImage("attachment://carta_pubblica.png")
      .setFooter({ text: "Solo il proprietario può visualizzare la carta completa in privato" })
      .setTimestamp()],
    files: [attachment],
    components: [row],
  };
}
async function handleCommand(interaction) {
  const { commandName, user, guildId, member } = interaction;
  const ephemeral = ["saldo", "paga", "stipendio", "creaprodotto", "eliminaprodotto", "setstipendio", "rimuovistipendio", "listastipendi"].includes(commandName);
  await interaction.deferReply({ ephemeral });
  if (commandName === "apriconto") {
    const existing = await getAccount(user.id, guildId);
    if (existing) {
      return interaction.editReply({ embeds: [err("Hai già un conto bancario aperto!")] });
    }
    await query(
      "INSERT INTO bank_accounts(user_id, guild_id, balance) VALUES($1, $2, 50000)",
      [user.id, guildId]
    );
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("🏦 Conto Bancario Aperto!")
      .setDescription(`Benvenuto ${user}! Il tuo conto bancario è stato aperto con successo con un bonus di **500 €**! 🎉\n\n> Usa **/creapin** per impostare il tuo PIN e iniziare a ricevere[...]
      .setTimestamp()] });
  }
  if (commandName === "creapin") {
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**.")] });
    if (acc.pin_hash) return interaction.editReply({ embeds: [err("Hai già un PIN impostato. Usa **/modificapin** per cambiarlo.")] });
    const pin = interaction.options.getInteger("pin", true);
    await query("UPDATE bank_accounts SET pin_hash=$1 WHERE user_id=$2 AND guild_id=$3", [hashPin(pin), user.id, guildId]);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("🔐 PIN Creato!")
      .setDescription("Il PIN del tuo conto bancario è stato impostato con successo.\n\n✅ Ora riceverai lo **stipendio mensile** il 1° di ogni mese!")
      .setTimestamp()] });
  }
  if (commandName === "modificapin") {
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**.")] });
    if (!acc.pin_hash) return interaction.editReply({ embeds: [err("Non hai ancora un PIN. Usa **/creapin** prima.")] });
    const vecchio = interaction.options.getInteger("vecchiopin", true);
    const nuovo = interaction.options.getInteger("nuovopin", true);
    if (hashPin(vecchio) !== acc.pin_hash) return interaction.editReply({ embeds: [err("PIN attuale errato!")] });
    if (vecchio === nuovo) return interaction.editReply({ embeds: [err("Il nuovo PIN deve essere diverso da quello attuale.")] });
    await query("UPDATE bank_accounts SET pin_hash=$1 WHERE user_id=$2 AND guild_id=$3", [hashPin(nuovo), user.id, guildId]);
    await query("UPDATE cards SET pin_enc=$1 WHERE user_id=$2 AND guild_id=$3", [encryptPin(nuovo), user.id, guildId]);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("🔐 PIN Modificato!")
      .setDescription("Il tuo PIN è stato aggiornato con successo.")
      .setTimestamp()] });
  }
  if (commandName === "paga") {
    const target = interaction.options.getUser("utente", true);
    const importo = interaction.options.getInteger("importo", true);
    const motivo = interaction.options.getString("motivo", true);
    const pin = interaction.options.getInteger("pin", true);
    if (target.id === user.id) return interaction.editReply({ embeds: [err("Non puoi pagare te stesso.")] });
    if (target.bot) return interaction.editReply({ embeds: [err("Non puoi pagare un bot.")] });
    const mittente = await getAccount(user.id, guildId);
    if (!mittente) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**.")] });
    if (!mittente.pin_hash) return interaction.editReply({ embeds: [err("Non hai un PIN impostato. Usa **/creapin** prima.")] });
    if (hashPin(pin) !== mittente.pin_hash) return interaction.editReply({ embeds: [err("❌ PIN errato! Transazione annullata.")] });
    if (mittente.balance < importo * 100) return interaction.editReply({ embeds: [err(`Saldo insufficiente. Hai solo ${euros(mittente.balance)} sul conto.`)] });
    const destinatario = await getAccount(target.id, guildId);
    if (!destinatario) return interaction.editReply({ embeds: [err(`${target.displayName} non ha un conto bancario.`)] });
    const amountInCents = importo * 100;
    await query("UPDATE bank_accounts SET balance=balance-$1 WHERE user_id=$2 AND guild_id=$3", [amountInCents, user.id, guildId]);
    await query("UPDATE bank_accounts SET balance=balance+$1 WHERE user_id=$2 AND guild_id=$3", [amountInCents, target.id, guildId]);
    await query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES($1,$2,$3,$4,$5,'pagamento')",
      [user.id, target.id, guildId, amountInCents, motivo]
    );
    try {
      await target.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
        .setTitle("💸 Hai Ricevuto un Pagamento!")
        .setDescription(`${user.tag} ti ha inviato ${euros(amountInCents)}`)
        .addFields({ name: "Motivo", value: motivo })
        .setTimestamp()] });
    } catch {}
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("✅ Pagamento Effettuato!")
      .setDescription(`Hai inviato ${euros(amountInCents)} a ${target}`)
      .addFields(
        { name: "Motivo", value: motivo },
        { name: "Tuo saldo rimanente", value: euros(mittente.balance - amountInCents) }
      ).setTimestamp()] });
  }
  if (commandName === "sequestra") {
    const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
    if (!hasRole) {
      return interaction.editReply({ embeds: [err("Non hai i permessi per usare questo comando. Richiede il ruolo Staff.")] });
    }
    const target = interaction.options.getUser("utente", true);
    const importo = interaction.options.getInteger("importo", true);
    const motivo = interaction.options.getString("motivo") ?? "Nessun motivo specificato";
    const vittima = await getAccount(target.id, guildId);
    if (!vittima) return interaction.editReply({ embeds: [err(`${target.displayName} non ha un conto bancario.`)] });
    const sequestrabile = Math.min(importo * 100, vittima.balance);
    if (sequestrabile <= 0) return interaction.editReply({ embeds: [err(`${target.displayName} non ha fondi sul conto.`)] });
    await query("UPDATE bank_accounts SET balance=balance-$1 WHERE user_id=$2 AND guild_id=$3", [sequestrabile, target.id, guildId]);
    await query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES($1,NULL,$2,$3,$4,'sequestro')",
      [target.id, guildId, sequestrabile, motivo]
    );
    try {
      await target.send({ embeds: [new EmbedBuilder().setColor(0xe74c3c)
        .setTitle("🚨 Sequestro Fondi")
        .setDescription(`${euros(sequestrabile)} sono stati sequestrati dal tuo conto dal personale del server.`)
        .addFields({ name: "Motivo", value: motivo })
        .setTimestamp()] });
    } catch {}
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe67e22)
      .setTitle("🚨 Sequestro Effettuato")
      .setDescription(`Sono stati sequestrati ${euros(sequestrabile)} dal conto di ${target}`)
      .addFields(
        { name: "Motivo", value: motivo },
        { name: "Saldo residuo", value: euros(vittima.balance - sequestrabile) }
      ).setTimestamp()] });
  }
  if (commandName === "tassa") {
    const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
    if (!hasRole) return interaction.editReply({ embeds: [err("Non hai i permessi. Richiede il ruolo Staff.")] });
    const percentuale = interaction.options.getInteger("percentuale", true);
    const motivo = interaction.options.getString("motivo") ?? "Tassa governativa";
    const { rows } = await query("SELECT * FROM bank_accounts WHERE guild_id=$1 AND balance > 0", [guildId]);
    if (!rows.length) return interaction.editReply({ embeds: [err("Nessun conto bancario con fondi trovato.")] });
    let totaleRaccolto = 0;
    for (const acc of rows) {
      const tassa = Math.floor(acc.balance * percentuale / 100);
      if (tassa <= 0) continue;
      await query("UPDATE bank_accounts SET balance=balance-$1 WHERE user_id=$2 AND guild_id=$3", [tassa, acc.user_id, guildId]);
      await query(
        "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES($1,NULL,$2,$3,$4,'tassa')",
        [acc.user_id, guildId, tassa, motivo]
      );
      totaleRaccolto += tassa;
      try {
        const u = await client.users.fetch(acc.user_id);
        await u.send({ embeds: [new EmbedBuilder().setColor(0xe67e22)
          .setTitle("🏛️ Tassa Applicata")
          .setDescription(`Una tassa del **${percentuale}%** è stata applicata al tuo conto bancario.`)
          .addFields(
            { name: "Importo detratto", value: euros(tassa), inline: true },
            { name: "Saldo rimanente", value: euros(acc.balance - tassa), inline: true },
            { name: "Motivo", value: motivo }
          ).setTimestamp()] });
      } catch {}
    }
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe67e22)
      .setTitle("🏛️ Tassa Applicata!")
      .setDescription(`Tassa del **${percentuale}%** applicata a **${rows.length}** conti bancari.`)
      .addFields(
        { name: "Totale raccolto", value: euros(totaleRaccolto), inline: true },
        { name: "Conti tassati", value: `${rows.length}`, inline: true },
        { name: "Motivo", value: motivo }
      ).setTimestamp()] });
  }
  if (commandName === "setstipendio") {
    const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
    if (!hasRole) return interaction.editReply({ embeds: [err("Non hai i permessi. Richiede il ruolo Staff.")] });
    const ruolo = interaction.options.getRole("ruolo", true);
    const importo = interaction.options.getInteger("importo", true);
    await query(
      `INSERT INTO role_salaries(guild_id, role_id, amount) VALUES($1,$2,$3)
       ON CONFLICT (guild_id, role_id) DO UPDATE SET amount=EXCLUDED.amount, updated_at=NOW()`,
      [guildId, ruolo.id, importo * 100]
    );
    await loadSalaries(guildId);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("💼 Stipendio Impostato")
      .setDescription(`Lo stipendio mensile del ruolo ${ruolo} è ora ${euros(importo * 100)}.`)
      .setFooter({ text: "La modifica avrà effetto dal prossimo pagamento (1° del mese)." })
      .setTimestamp()] });
  }
  if (commandName === "rimuovistipendio") {
    const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
    if (!hasRole) return interaction.editReply({ embeds: [err("Non hai i permessi. Richiede il ruolo Staff.")] });
    const ruolo = interaction.options.getRole("ruolo", true);
    const { rowCount } = await query("DELETE FROM role_salaries WHERE guild_id=$1 AND role_id=$2", [guildId, ruolo.id]);
    await loadSalaries(guildId);
    if (!rowCount) return interaction.editReply({ embeds: [err(`Il ruolo ${ruolo} non aveva nessuno stipendio configurato.`)] });
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe67e22)
      .setTitle("🗑️ Stipendio Rimosso")
      .setDescription(`Il ruolo ${ruolo} non riceve più nessuno stipendio mensile.`)
      .setTimestamp()] });
  }
  if (commandName === "listastipendi") {
    const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
    if (!hasRole) return interaction.editReply({ embeds: [err("Non hai i permessi. Richiede il ruolo Staff.")] });
    const salaries = await getSalaries(guildId);
    if (!salaries.size) {
      return interaction.editReply({ embeds: [err("Nessuno stipendio per ruolo è configurato. Usa **/setstipendio** per aggiungerne uno.")] });
    }
    const entries = [...salaries.entries()].sort((a, b) => b[1] - a[1]);
    const lista = entries.map(([roleId, importo]) => `<@&${roleId}> → ${euros(importo)}`).join("\n");
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x3498db)
      .setTitle("📋 Stipendi per Ruolo")
      .setDescription(lista)
      .setFooter({ text: "Chi possiede più ruoli riceve la somma dei rispettivi stipendi." })
      .setTimestamp()] });
  }
  if (commandName === "stipendio") {
    const salaries = await getSalaries(guildId);
    const { totale, ruoli } = calcolaStipendio(member, salaries);
    if (totale <= 0) {
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe67e22)
        .setTitle("⚠️ Nessuno Stipendio")
        .setDescription(`Non hai nessun ruolo lavorativo assegnato.\n\n> Contatta <@${CONTACT_USER_ID}> per farti assegnare un ruolo e iniziare a guadagnare!`)
        .setTimestamp()] });
    }
    const dettaglioRuoli = ruoli.map(r => `<@&${r.roleId}> → ${euros(r.importo)}`).join("\n");
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x3498db)
      .setTitle("💰 Il Tuo Stipendio Mensile")
      .setDescription(`Ogni 1° del mese riceverai un totale di ${euros(totale)}.`)
      .addFields({ name: "Dettaglio ruoli", value: dettaglioRuoli })
      .setFooter({ text: "Lo stipendio viene accreditato automaticamente il 1° di ogni mese." })
      .setTimestamp()] });
  }
  if (commandName === "creacarta") {
    const nome = interaction.options.getString("nome", true).trim();
    const cognome = interaction.options.getString("cognome", true).trim();
    const pin = interaction.options.getInteger("pin", true);
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**.")] });
    if (!acc.pin_hash) return interaction.editReply({ embeds: [err("Non hai un PIN impostato. Usa **/creapin** prima.")] });
    if (hashPin(pin) !== acc.pin_hash) return interaction.editReply({ embeds: [err("❌ PIN errato!")] });
    const pinEnc = encryptPin(pin);
    const existing = await getCard(user.id, guildId);
    if (existing) {
      await query("UPDATE cards SET nome=$1, cognome=$2, pin_enc=$3 WHERE user_id=$4 AND guild_id=$5", [nome, cognome, pinEnc, user.id, guildId]);
    } else {
      await query("INSERT INTO cards(user_id,guild_id,nome,cognome,pin_enc) VALUES($1,$2,$3,$4,$5)", [user.id, guildId, nome, cognome, pinEnc]);
    }
    await interaction.editReply({ content: "🎴 Generazione carta in corso..." });
    try {
      const card = await getCard(user.id, guildId);
      const imgBuffer = await generateCardImage(user, nome, cognome, card.created_at, { isPublic: true });
      return interaction.editReply(buildPublicCardReply(user, imgBuffer));
    } catch (error) {
      console.error("Errore nella generazione della carta:", error);
      return interaction.editReply({ embeds: [err("Errore nella generazione della carta. Riprova più tardi.")] });
    }
  }
  if (commandName === "mostracarta") {
    const target = interaction.options.getUser("utente") ?? user;
    if (target.bot) return interaction.editReply({ embeds: [err("I bot non hanno una carta identità.")] });
    const card = await getCard(target.id, guildId);
    if (!card) {
      const message = target.id === user.id
        ? "Non hai ancora una carta. Usa **/creacarta** prima."
        : `${target} non ha ancora una carta.`;
      return interaction.editReply({ embeds: [err(message)] });
    }
    await interaction.editReply({ content: "🎴 Generazione carta in corso..." });
    try {
      const imgBuffer = await generateCardImage(target, card.nome, card.cognome, card.created_at, { isPublic: true });
      return interaction.editReply(buildPublicCardReply(target, imgBuffer));
    } catch (error) {
      console.error("Errore nella generazione della carta:", error);
      return interaction.editReply({ embeds: [err("Errore nella generazione della carta. Riprova più tardi.")] });
    }
  }
  if (commandName === "creaprodotto") {
    const shopKey = interaction.options.getString("negozio", true);
    const nome = interaction.options.getString("nome", true).trim();
    const costoStr = interaction.options.getString("costo", true);
    const costo = parsePrice(costoStr);
    const immagine = interaction.options.getAttachment("immagine", true);
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Devi avere un conto bancario per vendere prodotti. Usa prima **/apriconto**.")] });
    if (!isImageAttachment(immagine)) return interaction.editReply({ embeds: [err("L'allegato deve essere una foto/immagine del prodotto.")] });
    const { rows } = await query(
      "INSERT INTO products(guild_id, creator_user_id, shop_key, name, price, image_url) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [guildId, user.id, shopKey, nome, costo, immagine.url]
    );
    const product = rows[0];
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("🛍️ Prodotto Creato")
      .setDescription(`Il prodotto è ora disponibile nel negozio **${getShopName(shopKey)}**.`)
      .addFields(
        { name: "ID prodotto", value: `#${product.id}`, inline: true },
        { name: "Nome", value: product.name, inline: true },
        { name: "Prezzo", value: euros(product.price), inline: true }
      )
      .setImage(product.image_url)
      .setFooter({ text: "Solo chi ha creato il prodotto può eliminarlo." })
      .setTimestamp()] });
  }
  if (commandName === "eliminaprodotto") {
    const productId = interaction.options.getInteger("id", true);
    const product = await getProduct(productId, guildId);
    if (!product) return interaction.editReply({ embeds: [err("Prodotto non trovato in questo server.")] });
    if (product.creator_user_id !== user.id) {
      return interaction.editReply({ embeds: [err("Può eliminare questo prodotto solo chi lo ha creato.")] });
    }
    await query("DELETE FROM products WHERE id=$1 AND guild_id=$2", [productId, guildId]);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe67e22)
      .setTitle("🗑️ Prodotto Eliminato")
      .setDescription(`Hai eliminato **${product.name}** da **${getShopName(product.shop_key)}**.`)
      .setTimestamp()] });
  }
  if (commandName === "compraonline") {
    const immagine = interaction.options.getAttachment("immagine");
    if (immagine && !isImageAttachment(immagine)) return interaction.editReply({ embeds: [err("L'allegato deve essere un'immagine/banner.")] });
    const orderButton = new ButtonBuilder()
      .setCustomId("online_shop_open")
      .setLabel("🛒 Ordina online")
      .setStyle(ButtonStyle.Success);
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("📦 Acquisti Online Brookhaven")
      .setDescription("Premi **Ordina online**, scegli il negozio, seleziona il prodotto e conferma il pagamento con il tuo PIN e il nome Roblox.")
      .setFooter({ text: "Il pagamento arriva subito al venditore nel conto del server. Il postino consegnerà al prossimo RP!" })
      .setTimestamp();
    if (immagine) embed.setImage(immagine.url);
    return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(orderButton)] });
  }
  if (commandName === "saldo") {
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa **/apriconto** per aprirne uno.")] });
    const pinStatus = acc.pin_hash ? "✅ PIN impostato" : "❌ PIN non impostato (usa /creapin)";
    const salaries = await getSalaries(guildId);
    const { totale } = calcolaStipendio(member, salaries);
    let stipendioStatus;
    if (!acc.pin_hash) {
      stipendioStatus = "❌ Disattivato (imposta il PIN)";
    } else if (totale <= 0) {
      stipendioStatus = `⚠️ Nessun ruolo lavorativo (contatta <@${CONTACT_USER_ID}>)`;
    } else {
      stipendioStatus = `✅ ${euros(totale)} (1° del mese)`;
    }
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x3498db)
      .setTitle("🏦 Il Tuo Conto Bancario")
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "💶 Saldo", value: euros(acc.balance), inline: true },
        { name: "🔐 Sicurezza", value: pinStatus, inline: true },
        { name: "💰 Stipendio", value: stipendioStatus, inline: false }
      ).setTimestamp()] });
  }
}
async function handleFullCardButton(interaction) {
  const cardOwnerId = interaction.customId.replace("carta_completa_", "");
  if (interaction.user.id !== cardOwnerId) {
    return interaction.reply({
      content: "❌ Solo il proprietario della carta può vedere la versione completa.",
      ephemeral: true,
    });
  }
  await interaction.deferReply({ ephemeral: true });
  const card = await getCard(interaction.user.id, interaction.guildId);
  if (!card) {
    return interaction.editReply({ embeds: [err("Carta non trovata. Usa **/creacarta** per crearne una.")] });
  }
  let pin = null;
  try {
    pin = decryptPin(card.pin_enc);
  } catch {
    pin = null;
  }
  if (!pin) {
    return interaction.editReply({
      embeds: [err("PIN non disponibile. Usa **/creacarta** inserendo il PIN corretto per aggiornare la carta.")],
    });
  }
  try {
    const userFetch = await interaction.client.users.fetch(interaction.user.id);
    const imgBuffer = await generateCardImage(userFetch, card.nome, card.cognome, card.created_at, { isPublic: false, pin });
    const attachment = new AttachmentBuilder(imgBuffer, { name: "carta_completa.png" });
    await interaction.user.send({
      embeds: [new EmbedBuilder().setColor(0xD4AF37)
        .setTitle("🔐 Carta Completa - SOLO PER TE")
        .setDescription("Ecco la tua **Chicago City Rp Card** con TUTTI i dati:\n- Nome ✓\n- Cognome ✓\n- PIN ✓\n\n**Non condividere questo messaggio con nessuno!**")
        .setImage("attachment://carta_completa.png")
        .setFooter({ text: "Documento riservato" })
        .setTimestamp()],
      files: [attachment],
    });
    return interaction.editReply({
      content: "✅ Carta completa inviata nei tuoi **messaggi privati (DM)**! Controlla i tuoi DM 📬",
    });
  } catch (error) {
    console.error("Errore invio carta completa:", error);
    return interaction.editReply({
      embeds: [err("Non riesco a scriverti in DM. Abilita i messaggi privati dal server e riprova.")],
    });
  }
}
async function handleOnlineShopOpen(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const counts = await getShopProductCounts(interaction.guildId);
  const countMap = new Map(counts.map(row => [row.shop_key, row.count]));
  const options = SHOP_CATALOG
    .filter(shop => countMap.has(shop.value))
    .map(shop => ({
      label: shop.name,
      value: shop.value,
      description: `${countMap.get(shop.value)} prodotti disponibili`,
    }));
  if (!options.length) {
    return interaction.editReply({ embeds: [err("Non ci sono ancora prodotti online. Usa **/creaprodotto** per aggiungerne uno.")] });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("online_shop_select")
    .setPlaceholder("Scegli il negozio in cui acquistare")
    .addOptions(options.slice(0, 25));
  return interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x3498db)
      .setTitle("🛒 Scegli un negozio")
      .setDescription("Seleziona il negozio, poi scegli il prodotto da ordinare online.")],
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}
async function handleOnlineShopSelect(interaction) {
  const shopKey = interaction.values[0];
  const products = await listProductsForShop(interaction.guildId, shopKey);
  if (!products.length) {
    return interaction.update({ embeds: [err("Questo negozio non ha più prodotti disponibili.")], components: [] });
  }
  const productOptions = products.map(product => ({
    label: shorten(product.name, 90),
    value: String(product.id),
    description: shorten(`${euros(product.price)} · ID #${product.id}`, 100),
  }));
  const menu = new StringSelectMenuBuilder()
    .setCustomId("online_product_select")
    .setPlaceholder("Scegli il prodotto da ordinare")
    .addOptions(productOptions);
  const preview = products.slice(0, 10).map(product => `#${product.id} · **${product.name}** — ${euros(product.price)}`).join("\n");
  const extra = products.length > 10 ? `\n…e altri ${products.length - 10} prodotti nel menu.` : "";
  return interaction.update({
    content: "",
    embeds: [new EmbedBuilder().setColor(0x3498db)
      .setTitle(`🏪 ${getShopName(shopKey)}`)
      .setDescription(`${preview}${extra}`)
      .setFooter({ text: "Scegli un prodotto per vedere la foto e pagare con PIN." })],
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}
async function handleOnlineProductSelect(interaction) {
  const productId = Number(interaction.values[0]);
  const product = await getProduct(productId, interaction.guildId);
  if (!product) {
    return interaction.update({ embeds: [err("Prodotto non più disponibile.")], components: [] });
  }
  const buyButton = new ButtonBuilder()
    .setCustomId(`online_buy_${product.id}`)
    .setLabel("🔐 Inserisci PIN e paga")
    .setStyle(ButtonStyle.Success);
  return interaction.update({
    content: "",
    embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle(`📦 ${product.name}`)
      .setDescription("Conferma l'ordine inserendo il PIN del tuo conto bancario e il tuo nome Roblox.\n\n**⚠️ Importante: Sii presente al prossimo RP per ricevere il pacco dal postino!**")
      .addFields(
        { name: "Negozio", value: getShopName(product.shop_key), inline: true },
        { name: "Prezzo", value: euros(product.price), inline: true },
        { name: "Venditore", value: `<@${product.creator_user_id}>`, inline: true }
      )
      .setImage(product.image_url)
      .setFooter({ text: "Il pacco viene confermato dopo il pagamento - Consegna al prossimo RP" })
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(buyButton)],
  });
}
async function handleOnlineBuyButton(interaction) {
  const productId = Number(interaction.customId.replace("online_buy_", ""));
  const product = await getProduct(productId, interaction.guildId);
  if (!product) return interaction.reply({ content: "❌ Prodotto non più disponibile.", ephemeral: true });
  if (product.creator_user_id === interaction.user.id) {
    return interaction.reply({ content: "❌ Non puoi comprare un prodotto creato da te.", ephemeral: true });
  }
  const acc = await getAccount(interaction.user.id, interaction.guildId);
  if (!acc) return interaction.reply({ content: "❌ Non hai un conto bancario. Usa prima **/apriconto**.", ephemeral: true });
  if (!acc.pin_hash) return interaction.reply({ content: "❌ Non hai ancora un PIN. Usa **/creapin** prima di comprare online.", ephemeral: true });

  const modal = new ModalBuilder()
    .setCustomId(`online_pin_${product.id}`)
    .setTitle("Pagamento Online");
  const pinInput = new TextInputBuilder()
    .setCustomId("pin")
    .setLabel("Inserisci il PIN del conto (4 cifre)")
    .setPlaceholder("1234")
    .setMinLength(4)
    .setMaxLength(4)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  const robloxInput = new TextInputBuilder()
    .setCustomId("roblox_name")
    .setLabel("Inserisci il tuo NOME ROBLOX")
    .setPlaceholder("Il tuo username Roblox esatto")
    .setMinLength(3)
    .setMaxLength(20)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(
    new ActionRowBuilder().addComponents(pinInput),
    new ActionRowBuilder().addComponents(robloxInput)
  );
  return interaction.showModal(modal);
}
async function handleOnlinePinModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const productId = Number(interaction.customId.replace("online_pin_", ""));
  const pin = interaction.fields.getTextInputValue("pin").trim();
  const robloxName = interaction.fields.getTextInputValue("roblox_name").trim();
  if (!/^\d{4}$/.test(pin)) {
    return interaction.editReply({ embeds: [err("Il PIN deve essere composto da 4 cifre.")] });
  }
  const product = await getProduct(productId, interaction.guildId);
  if (!product) return interaction.editReply({ embeds: [err("Prodotto non più disponibile.")] });
  if (product.creator_user_id === interaction.user.id) {
    return interaction.editReply({ embeds: [err("Non puoi comprare un prodotto creato da te.")] });
  }
  const buyer = await getAccount(interaction.user.id, interaction.guildId);
  if (!buyer) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**.")] });
  if (!buyer.pin_hash) return interaction.editReply({ embeds: [err("Non hai ancora un PIN. Usa **/creapin** prima di comprare online.")] });
  if (hashPin(pin) !== buyer.pin_hash) return interaction.editReply({ embeds: [err("❌ PIN errato! Pagamento annullato.")] });

  const price = Number(product.price);
  try {
    const result = await completeOnlinePurchase({
      buyerId: interaction.user.id,
      sellerId: product.creator_user_id,
      guildId: interaction.guildId,
      amount: price,
      productName: product.name,
      productId: product.id,
    });
    const sellerUser = await interaction.client.users.fetch(product.creator_user_id).catch(() => null);
    if (sellerUser) {
      await sellerUser.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
        .setTitle("💸 Vendita Online Ricevuta")
        .setDescription(`${interaction.user.tag} ha comprato **${product.name}** da **${getShopName(product.shop_key)}**.`)
        .addFields(
          { name: "Importo ricevuto", value: euros(price), inline: true },
          { name: "Saldo nel server", value: euros(result.sellerBalance), inline: true }
        )
        .setFooter({ text: "I soldi sono stati accreditati nel tuo conto del server." })
        .setImage(product.image_url)
        .setTimestamp()] }).catch(() => {});
    }
    const guild = interaction.guild || await interaction.client.guilds.fetch(interaction.guildId).catch(() => null);
    if (guild) {
      try {
        const postinoRole = guild.roles.cache.get(POSTINO_ROLE_ID);
        if (postinoRole) {
          await postinoRole.send({ embeds: [new EmbedBuilder().setColor(0x3498db)
            .setTitle("📦 NUOVO ORDINE ONLINE")
            .setDescription(`Un nuovo ordine è in attesa di consegna!`)
            .addFields(
              { name: "📌 Prodotto", value: `${product.name} (ID: #${product.id})`, inline: false },
              { name: "👤 Acquirente Discord", value: `${interaction.user} (@${interaction.user.username})`, inline: false },
              { name: "🎮 Nome Roblox", value: `**${robloxName}**`, inline: false },
              { name: "💰 Prezzo", value: euros(price), inline: true },
              { name: "🏪 Negozio", value: getShopName(product.shop_key), inline: true }
            )
            .addFields(
              { name: "⚠️ IMPORTANTE", value: `L'acquirente sarà presente al **PROSSIMO RP** per ricevere il pacco!` }
            )
            .setImage(product.image_url)
            .setFooter({ text: "Consegna confermata in chat una volta completata." })
            .setTimestamp()] }).catch(() => {});
        }
      } catch (e) {
        console.error("Errore invio DM postino:", e);
      }
    }
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("✅ ORDINE CONFERMATO!")
      .setDescription(`Hai ordinato con successo **${product.name}**!\n\n📦 Il postino te lo consegnerà al **prossimo RP**`)
      .addFields(
        { name: "🎮 Nome Roblox", value: robloxName, inline: true },
        { name: "💸 Pagato", value: euros(price), inline: true },
        { name: "💶 Saldo rimanente", value: euros(result.buyerBalance), inline: true }
      )
      .setImage(product.image_url)
      .setFooter({ text: "✅ Non dimenticare di presentarti al prossimo RP!" })
      .setTimestamp()] });
  } catch (error) {
    if (error.message === "INSUFFICIENT_FUNDS") return interaction.editReply({ embeds: [err("Saldo insufficiente per comprare questo prodotto.")] });
    if (error.message === "SELLER_ACCOUNT_MISSING") return interaction.editReply({ embeds: [err("Il venditore non ha più un conto bancario valido.")] });
    if (error.message === "BUYER_ACCOUNT_MISSING") return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**.")] });
    console.error("Errore acquisto online:", error);
    return interaction.editReply({ embeds: [err("Errore durante l'acquisto online. Riprova più tardi.")] });
  }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages] });
client.once("ready", async (rc) => {
  console.log(`Bot online: ${rc.user.tag}`);
  await setupDb();
  for (const guild of rc.guilds.cache.values()) {
    await seedDefaultSalaries(guild.id);
  }
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(rc.user.id), { body: commands.map(c => c.toJSON()) });
  console.log(`${commands.length} comandi registrati.`);
  setInterval(() => pagareStipendiGuild(rc).catch(console.error), 60 * 60 * 1000);
  await pagareStipendiGuild(rc);
});
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith("carta_completa_")) {
      await handleFullCardButton(interaction);
    }
    if (interaction.isButton() && interaction.customId === "online_shop_open") {
      await handleOnlineShopOpen(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "online_shop_select") {
      await handleOnlineShopSelect(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "online_product_select") {
      await handleOnlineProductSelect(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith("online_buy_")) {
      await handleOnlineBuyButton(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("online_pin_")) {
      await handleOnlinePinModal(interaction);
    }
  } catch (e) {
    console.error(e);
    const msg = "Si è verificato un errore. Riprova.";
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
    } else {
      interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});
client.login(token);
