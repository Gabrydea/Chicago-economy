const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const { Pool } = require("pg");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { createCanvas, loadImage, registerFont } = require("canvas");

const PORT = process.env.PORT || 3000;

// Health check
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot online!");
}).listen(PORT, () => {
  console.log(`Health check su porta ${PORT}`);
});

const token = process.env.DISCORD_BOT_TOKEN;
const dbUrl = process.env.DATABASE_URL;

const STAFF_ROLE_ID = "1504115375577497600";
const CONTACT_USER_ID = "1141049314433573044";

// Stipendi di default
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

// Catalogo negozi
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

if (!token) {
  console.error("DISCORD_BOT_TOKEN mancante");
  process.exit(1);
}

if (!dbUrl) {
  console.error("DATABASE_URL mancante");
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

// Query DB
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// Hash PIN
function hashPin(pin) {
  return crypto.createHash("sha256").update(String(pin)).digest("hex");
}

// Nome negozio
function getShopName(shopKey) {
  return SHOP_CATALOG.find(shop => shop.value === shopKey)?.name || shopKey;
}

// Controllo immagini
function isImageAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(attachment.url || "");
}

// Accorcia testo
function shorten(text, max = 90) {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Chiave cifratura PIN
function getPinEncryptionKey() {
  const secret = process.env.PIN_ENCRYPTION_SECRET || token;
  return crypto.createHash("sha256").update(secret).digest();
}

// Cifra PIN
function encryptPin(pin) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getPinEncryptionKey(), iv);
  let enc = cipher.update(String(pin), "utf8", "hex");
  enc += cipher.final("hex");
  return `${iv.toString("hex")}:${enc}`;
}

// Decifra PIN
function decryptPin(pinEnc) {
  if (!pinEnc) return null;
  const [ivHex, enc] = pinEnc.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", getPinEncryptionKey(), iv);
  let dec = decipher.update(enc, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}
// Setup database
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

  console.log("Database pronto.");
}

// Cache stipendi
async function loadSalaries(guildId) {
  const { rows } = await query(
    "SELECT role_id, amount FROM role_salaries WHERE guild_id=$1",
    [guildId]
  );

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
  const { rows } = await query(
    "SELECT COUNT(*)::int AS n FROM role_salaries WHERE guild_id=$1",
    [guildId]
  );

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

// Funzioni DB
async function getAccount(userId, guildId) {
  const { rows } = await query(
    "SELECT * FROM bank_accounts WHERE user_id=$1 AND guild_id=$2",
    [userId, guildId]
  );
  return rows[0] || null;
}

async function getCard(userId, guildId) {
  const { rows } = await query(
    "SELECT * FROM cards WHERE user_id=$1 AND guild_id=$2",
    [userId, guildId]
  );
  return rows[0] || null;
}

async function getProduct(productId, guildId) {
  const { rows } = await query(
    "SELECT * FROM products WHERE id=$1 AND guild_id=$2",
    [productId, guildId]
  );
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

// Acquisto online
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

    await client.query(
      "UPDATE bank_accounts SET balance=balance-$1 WHERE user_id=$2 AND guild_id=$3",
      [amount, buyerId, guildId]
    );

    await client.query(
      "UPDATE bank_accounts SET balance=balance+$1 WHERE user_id=$2 AND guild_id=$3",
      [amount, sellerId, guildId]
    );

    await client.query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES($1,$2,$3,$4,$5,'acquisto_online')",
      [buyerId, sellerId, guildId, amount, `Acquisto online #${productId}: ${productName}`]
    );

    await client.query("COMMIT");

    return {
      buyerBalance: Number(buyer.balance) - amount,
      sellerBalance: Number(seller.balance) + amount
    };

  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Formattazione euro
function euros(n) {
  return `**${Number(n).toLocaleString("it-IT")} €**`;
}

// Embed errore
function err(msg) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("❌ Errore")
    .setDescription(msg);
}
// Calcolo stipendio
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

// Funzioni grafiche carta identità
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

function drawCardText(ctx, text, x, y, {
  color = "#ffffff",
  stroke = "rgba(0,0,0,0.55)",
  lineWidth = 3
} = {}) {
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

// Generazione immagine carta identità
async function generateCardImage(user, nome, cognome, createdAt, { isPublic = true, pin = null } = {}) {
  ensureCardFonts();

  const canvas = createCanvas(860, 540);
  const ctx = canvas.getContext("2d");

  if ("textDrawingMode" in ctx) ctx.textDrawingMode = "glyph";

  // Background
  const bg = ctx.createLinearGradient(0, 0, 860, 540);
  bg.addColorStop(0, "#101832");
  bg.addColorStop(0.42, "#261348");
  bg.addColorStop(1, "#07131d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 860, 540);

  // Glow effetti
  const glowA = ctx.createRadialGradient(690, 110, 20, 690, 110, 310);
  glowA.addColorStop(0, "rgba(255, 214, 112, 0.34)");
  glowA.addColorStop(1, "rgba(255, 214, 112, 0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, 860, 540);

  const glowB = ctx.createRadialGradient(170, 430, 20, 170, 430, 290);
  glowB.addColorStop(0, "rgba(106, 225, 255, 0.22)");
  glowB.addColorStop(1, "rgba(106, 225, 255, 0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, 860, 540);

  // Cerchi decorativi
  ctx.save();
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc(72 + i * 78, 52 + (i % 3) * 164, 58 + (i % 2) * 26, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 ? "#f7d26a" : "#78e7ff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // Cornice principale
  roundRect(ctx, 24, 24, 812, 492, 34);
  const glass = ctx.createLinearGradient(24, 24, 836, 516);
  glass.addColorStop(0, "rgba(255,255,255,0.18)");
  glass.addColorStop(0.52, "rgba(255,255,255,0.06)");
  glass.addColorStop(1, "rgba(0,0,0,0.30)");
  ctx.fillStyle = glass;
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 219, 126, 0.95)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Box info
  roundRect(ctx, 46, 54, 492, 366, 28);
  ctx.fillStyle = "rgba(3, 9, 20, 0.46)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Titolo
  const accent = ctx.createLinearGradient(52, 48, 450, 92);
  accent.addColorStop(0, "#fff1a8");
  accent.addColorStop(0.5, "#f4c15d");
  accent.addColorStop(1, "#7ff3ff");

  setCardFont(ctx, 24, { bold: true });
  drawCardText(ctx, "CHICAGO CITY RP", 58, 82, {
    color: accent,
    stroke: "rgba(0,0,0,0.54)",
    lineWidth: 4
  });

  setCardFont(ctx, 14);
  drawCardText(ctx, isPublic ? "CARTA IDENTITÀ · PUBBLICA" : "CARTA IDENTITÀ · COMPLETA", 58, 112, {
    color: "rgba(255, 238, 185, 0.95)",
    stroke: "rgba(0,0,0,0.62)",
    lineWidth: 3
  });
  // Badge modalità
  roundRect(ctx, 620, 66, 154, 42, 16);
  ctx.fillStyle = isPublic ? "rgba(126, 243, 255, 0.16)" : "rgba(255, 199, 89, 0.17)";
  ctx.fill();

  ctx.strokeStyle = isPublic ? "rgba(126,243,255,0.65)" : "rgba(255,199,89,0.66)";
  ctx.lineWidth = 1;
  ctx.stroke();

  setCardFont(ctx, 13, { bold: true });
  drawCardText(ctx, isPublic ? "PUBLIC VIEW" : "OWNER ONLY", 642, 93, {
    color: isPublic ? "#aef8ff" : "#ffe3a0",
    stroke: "rgba(0,0,0,0.55)",
    lineWidth: 2
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

  const avatarRing = ctx.createLinearGradient(
    avatarX - 110, avatarY - 110,
    avatarX + 110, avatarY + 110
  );

  avatarRing.addColorStop(0, "#fff2aa");
  avatarRing.addColorStop(0.45, "#d4af37");
  avatarRing.addColorStop(1, "#7ff3ff");

  ctx.fillStyle = avatarRing;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(
    avatarImage,
    avatarX - avatarRadius,
    avatarY - avatarRadius,
    avatarRadius * 2,
    avatarRadius * 2
  );
  ctx.restore();

  // Glow avatar
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.ellipse(682, 286, 132, 48, -0.46, 0, Math.PI * 2);
  ctx.strokeStyle = "#7ff3ff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Nome e cognome
  const safeNome = String(nome ?? "").toUpperCase();
  const safeCognome = String(cognome ?? "").toUpperCase();

  setCardFont(ctx, 46, { bold: true });
  drawCardText(ctx, fitText(ctx, safeNome, 430), 58, 186, {
    color: "#ffffff",
    stroke: "rgba(0,0,0,0.72)",
    lineWidth: 5
  });

  if (!isPublic && safeCognome) {
    setCardFont(ctx, 34, { bold: true });
    drawCardText(ctx, fitText(ctx, safeCognome, 420), 58, 236, {
      color: "#ffe08b",
      stroke: "rgba(0,0,0,0.70)",
      lineWidth: 4
    });
  } else {
    roundRect(ctx, 58, 211, 282, 36, 14);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fill();

    setCardFont(ctx, 14, { bold: true });
    drawCardText(ctx, "COGNOME NASCOSTO", 76, 235, {
      color: "rgba(255,255,255,0.82)",
      stroke: "rgba(0,0,0,0.55)",
      lineWidth: 2
    });
  }

  // Data creazione
  const dataCreazione = new Date(createdAt).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  setCardFont(ctx, 15, { bold: true });
  drawCardText(ctx, `MEMBRO DAL ${dataCreazione.toUpperCase()}`, 58, 292, {
    color: "rgba(255,255,255,0.92)",
    stroke: "rgba(0,0,0,0.66)",
    lineWidth: 3
  });

  // Username Discord
  setCardFont(ctx, 17, { bold: true });
  drawCardText(ctx, fitText(ctx, `@${user.username}`, 330), 58, 326, {
    color: "#7ff3ff",
    stroke: "rgba(0,0,0,0.66)",
    lineWidth: 3
  });

  // Linea separatrice
  drawSoftLine(ctx, 58, 354, 492, 354, "rgba(255,255,255,0.20)");

  // PIN (solo privato)
  if (!isPublic && pin) {
    roundRect(ctx, 58, 374, 250, 58, 16);
    ctx.fillStyle = "rgba(255, 210, 106, 0.16)";
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 219, 126, 0.82)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    setCardFont(ctx, 23, { bold: true });
    drawCardText(ctx, `PIN · ${pin}`, 78, 411, {
      color: "#ffffff",
      stroke: "rgba(0,0,0,0.68)",
      lineWidth: 4
    });

  } else if (isPublic) {
    roundRect(ctx, 58, 374, 298, 58, 16);
    ctx.fillStyle = "rgba(126, 243, 255, 0.12)";
    ctx.fill();

    ctx.strokeStyle = "rgba(126, 243, 255, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    setCardFont(ctx, 15, { bold: true });
    drawCardText(ctx, "PIN E DATI SENSIBILI NASCOSTI", 76, 410, {
      color: "rgba(226,251,255,0.92)",
      stroke: "rgba(0,0,0,0.60)",
      lineWidth: 2.5
    });
  }

  // Footer badge
  roundRect(ctx, 584, 404, 194, 48, 14);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();

  setCardFont(ctx, 13, { bold: true });
  drawCardText(ctx, isPublic ? "SAFE PUBLIC CARD" : "PRIVATE OWNER CARD", 606, 434, {
    color: "rgba(255,255,255,0.82)",
    stroke: "rgba(0,0,0,0.55)",
    lineWidth: 2
  });

  // Footer testo
  setCardFont(ctx, 16, { bold: true });
  drawCardText(ctx, "Chicago City Rp Card", 58, 486, {
    color: "rgba(255, 225, 142, 0.96)",
    stroke: "rgba(0,0,0,0.66)",
    lineWidth: 3
  });

  setCardFont(ctx, 12, { bold: true });
  drawCardText(
    ctx,
    isPublic ? "Premi “Vedi tutto” solo se questa carta è tua" : "Documento riservato — non condividere",
    58,
    510,
    {
      color: "rgba(255,255,255,0.72)",
      stroke: "rgba(0,0,0,0.64)",
      lineWidth: 2
    }
  );

  return canvas.toBuffer("image/png");
}
// Pagamento stipendi automatico
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
        await u.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe67e22)
              .setTitle("⚠️ Nessuno Stipendio Questo Mese")
              .setDescription(
                `Non hai nessun ruolo lavorativo assegnato, quindi non puoi ricevere lo stipendio mensile.\n\n` +
                `> Contatta <@${CONTACT_USER_ID}> per farti assegnare un ruolo e iniziare a guadagnare!`
              )
              .setTimestamp()
          ]
        });
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

    const dettaglioRuoli = ruoli
      .map(r => `<@&${r.roleId}> → ${euros(r.importo)}`)
      .join("\n");

    try {
      const u = await client.users.fetch(acc.user_id);
      await u.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("💰 Stipendio Accreditato!")
            .setDescription(
              `Il tuo stipendio mensile di ${euros(totale)} è stato accreditato sul tuo conto bancario! 🎉`
            )
            .addFields({ name: "Dettaglio ruoli", value: dettaglioRuoli })
            .setTimestamp()
        ]
      });
    } catch {}

    console.log(`Stipendio di ${totale} pagato a ${acc.user_id} (guild: ${acc.guild_id})`);
  }
}

// Comandi slash
const commands = [
  new SlashCommandBuilder()
    .setName("apriconto")
    .setDescription("Apri un conto bancario per ricevere lo stipendio mensile"),

  new SlashCommandBuilder()
    .setName("creapin")
    .setDescription("Crea il PIN del tuo conto bancario (4 cifre)")
    .addIntegerOption(o =>
      o.setName("pin")
        .setDescription("Il tuo PIN a 4 cifre")
        .setRequired(true)
        .setMinValue(1000)
        .setMaxValue(9999)
    ),

  new SlashCommandBuilder()
    .setName("modificapin")
    .setDescription("Modifica il PIN del tuo conto bancario")
    .addIntegerOption(o =>
      o.setName("vecchiopin")
        .setDescription("Il PIN attuale")
        .setRequired(true)
        .setMinValue(1000)
        .setMaxValue(9999)
    )
    .addIntegerOption(o =>
      o.setName("nuovopin")
        .setDescription("Il nuovo PIN a 4 cifre")
        .setRequired(true)
        .setMinValue(1000)
        .setMaxValue(9999)
    ),

  new SlashCommandBuilder()
    .setName("paga")
    .setDescription("Paga un utente con soldi dal tuo conto bancario")
    .addUserOption(o =>
      o.setName("utente")
        .setDescription("Chi vuoi pagare")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("importo")
        .setDescription("Quanti euro inviare")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName("motivo")
        .setDescription("Motivo del pagamento")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("pin")
        .setDescription("Il tuo PIN per confermare")
        .setRequired(true)
        .setMinValue(1000)
        .setMaxValue(9999)
    ),

  new SlashCommandBuilder()
    .setName("sequestra")
    .setDescription("[SOLO STAFF] Sequestra soldi da un utente")
    .addUserOption(o =>
      o.setName("utente")
        .setDescription("Utente a cui sequestrare i soldi")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("importo")
        .setDescription("Importo da sequestrare")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName("motivo")
        .setDescription("Motivo del sequestro")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("saldo")
    .setDescription("Controlla il saldo del tuo conto bancario"),

  new SlashCommandBuilder()
    .setName("stipendio")
    .setDescription("Controlla quanto stipendio mensile ricevi in base ai tuoi ruoli"),

  new SlashCommandBuilder()
    .setName("tassa")
    .setDescription("[SOLO STAFF] Applica una tassa a tutti i conti bancari del server")
    .addIntegerOption(o =>
      o.setName("percentuale")
        .setDescription("Percentuale da tassare (1-50%)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50)
    )
    .addStringOption(o =>
      o.setName("motivo")
        .setDescription("Motivo della tassa")
        .setRequired(false)
    ),
];
  new SlashCommandBuilder()
    .setName("creacarta")
    .setDescription("Crea la tua carta Chicago City Rp Card")
    .addStringOption(o =>
      o.setName("nome")
        .setDescription("Il tuo nome")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("cognome")
        .setDescription("Il tuo cognome")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("pin")
        .setDescription("Il tuo PIN a 4 cifre")
        .setRequired(true)
        .setMinValue(1000)
        .setMaxValue(9999)
    ),

  new SlashCommandBuilder()
    .setName("mostracarta")
    .setDescription("Mostra nel canale una carta pubblica, senza cognome e senza PIN")
    .addUserOption(o =>
      o.setName("utente")
        .setDescription("Carta da mostrare pubblicamente")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("creaprodotto")
    .setDescription("Crea un prodotto vendibile in un negozio online")
    .addStringOption(o =>
      o.setName("negozio")
        .setDescription("Negozio in cui mettere il prodotto")
        .setRequired(true)
        .addChoices(...SHOP_CATALOG)
    )
    .addStringOption(o =>
      o.setName("nome")
        .setDescription("Nome del prodotto")
        .setRequired(true)
        .setMaxLength(80)
    )
    .addStringOption(o =>
      o.setName("costo")
        .setDescription("Prezzo del prodotto (es. 12.50 o 12,50)")
        .setRequired(true)
    )
    .addAttachmentOption(o =>
      o.setName("immagine")
        .setDescription("Foto del prodotto")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("eliminaprodotto")
    .setDescription("Elimina un prodotto che hai creato")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("ID del prodotto da eliminare")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("compraonline")
    .setDescription("Pubblica il pannello con il bottone Ordina online")
    .addAttachmentOption(o =>
      o.setName("immagine")
        .setDescription("Immagine/banner del negozio online")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setstipendio")
    .setDescription("[SOLO STAFF] Imposta o modifica lo stipendio mensile di un ruolo")
    .addRoleOption(o =>
      o.setName("ruolo")
        .setDescription("Il ruolo a cui assegnare lo stipendio")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("importo")
        .setDescription("Stipendio mensile in euro")
        .setRequired(true)
        .setMinValue(0)
    ),

  new SlashCommandBuilder()
    .setName("rimuovistipendio")
    .setDescription("[SOLO STAFF] Rimuove lo stipendio associato a un ruolo")
    .addRoleOption(o =>
      o.setName("ruolo")
        .setDescription("Il ruolo da cui rimuovere lo stipendio")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("listastipendi")
    .setDescription("[SOLO STAFF] Mostra tutti gli stipendi per ruolo configurati"),
];

// Funzione per carta pubblica
function buildPublicCardReply(user, imgBuffer) {
  const attachment = new AttachmentBuilder(imgBuffer, { name: "carta_pubblica.png" });

  const fullCardButton = new ButtonBuilder()
    .setCustomId(`carta_completa_${user.id}`)
    .setLabel("👁️ Vedi tutto")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(fullCardButton);

  return {
    content: "",
    embeds: [
      new EmbedBuilder()
        .setColor(0xD4AF37)
        .setTitle("💳 Chicago City Rp Card")
        .setDescription(`Carta identità pubblica di ${user}.\n*Versione pubblica — cognome e PIN nascosti.*`)
        .setImage("attachment://carta_pubblica.png")
        .setFooter({ text: "Solo il proprietario può richiedere la carta completa via DM" })
        .setTimestamp()
    ],
    files: [attachment],
    components: [row],
  };
}

// ===============================
//   AVVIO CLIENT DISCORD
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: ["CHANNEL"]
});

client.once("ready", async () => {
  console.log(`Bot avviato come ${client.user.tag}`);
  await setupDb();
});

// ===============================
//   LOGIN
// ===============================

client.login(token);

