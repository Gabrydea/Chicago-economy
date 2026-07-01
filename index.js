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
const CONCESSIONARIO_ROLE_ID = "1514961491433099386";
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
  { name: "Telefonica", value: "telefonica" },
  { name: "Elettronica", value: "elettronica" },
  { name: "Supermercato", value: "supermercato" },
  { name: "Farmacia", value: "farmacia" },
  { name: "Abbigliamento", value: "abbigliamento" },
  { name: "Gioielleria", value: "gioielleria" },
  { name: "Garage e Ricambi", value: "garage" },
  { name: "Benzinaio", value: "benzinaio" },
  { name: "Immobiliare", value: "immobiliare" },
  { name: "Arredamento", value: "arredamento" },
  { name: "Ferramenta", value: "ferramenta" },
  { name: "Ristorante", value: "ristorante" },
  { name: "Fast Food", value: "fast_food" },
  { name: "Bar", value: "bar" },
  { name: "Gelateria", value: "gelateria" },
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
  await query(`CREATE TABLE IF NOT EXISTS houses (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    creator_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price BIGINT NOT NULL,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS cars (
    id SERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    creator_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price BIGINT NOT NULL,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS job_requests (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    position TEXT NOT NULL,
    message_id TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    buyer_user_id TEXT NOT NULL,
    seller_user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    shop_key TEXT NOT NULL,
    price BIGINT NOT NULL,
    roblox_user TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS salary_history (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    month TEXT NOT NULL,
    amount BIGINT NOT NULL,
    paid_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, guild_id, month)
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_products_guild_shop ON products(guild_id, shop_key)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_products_creator ON products(guild_id, creator_user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_houses_guild ON houses(guild_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_cars_guild ON cars(guild_id)`);
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
async function getHouse(houseId, guildId) {
  const { rows } = await query("SELECT * FROM houses WHERE id=$1 AND guild_id=$2", [houseId, guildId]);
  return rows[0] || null;
}
async function getCar(carId, guildId) {
  const { rows } = await query("SELECT * FROM cars WHERE id=$1 AND guild_id=$2", [carId, guildId]);
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
async function listHouses(guildId) {
  const { rows } = await query(
    "SELECT * FROM houses WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 25",
    [guildId]
  );
  return rows;
}
async function listCars(guildId) {
  const { rows } = await query(
    "SELECT * FROM cars WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 25",
    [guildId]
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
    .setName("saldo")
    .setDescription("Controlla il saldo del tuo conto bancario"),
  new SlashCommandBuilder()
    .setName("stipendio")
    .setDescription("Visualizza quando arriverà il tuo prossimo stipendio"),
  new SlashCommandBuilder()
    .setName("case")
    .setDescription("Visualizza le case disponibili"),
  new SlashCommandBuilder()
    .setName("auto")
    .setDescription("Visualizza le auto disponibili"),
  new SlashCommandBuilder()
    .setName("creacase")
    .setDescription("[SOLO STAFF] Crea una casa in vendita")
    .addStringOption(o => o.setName("nome").setDescription("Nome della casa").setRequired(true))
    .addStringOption(o => o.setName("prezzo").setDescription("Prezzo in euro").setRequired(true))
    .addAttachmentOption(o => o.setName("immagine").setDescription("Foto della casa").setRequired(true)),
  new SlashCommandBuilder()
    .setName("rimuovi-casa")
    .setDescription("[SOLO STAFF] Rimuove una casa")
    .addIntegerOption(o => o.setName("id").setDescription("ID della casa").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName("creauto")
    .setDescription("[SOLO CONCESSIONARIO] Crea un'auto in vendita")
    .addStringOption(o => o.setName("nome").setDescription("Nome dell'auto").setRequired(true))
    .addStringOption(o => o.setName("prezzo").setDescription("Prezzo in euro").setRequired(true))
    .addAttachmentOption(o => o.setName("immagine").setDescription("Foto dell'auto").setRequired(true)),
  new SlashCommandBuilder()
    .setName("rimuovi-auto")
    .setDescription("[SOLO CONCESSIONARIO] Rimuove un'auto")
    .addIntegerOption(o => o.setName("id").setDescription("ID dell'auto").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName("creaprodotto")
    .setDescription("[SOLO CREATORE] Crea un prodotto per un negozio")
    .addStringOption(o => o.setName("negozio").setDescription("Seleziona il negozio").setRequired(true).addChoices(...SHOP_CATALOG.map(s => ({ name: s.name, value: s.value }))))
    .addStringOption(o => o.setName("nome").setDescription("Nome del prodotto").setRequired(true))
    .addStringOption(o => o.setName("prezzo").setDescription("Prezzo in euro").setRequired(true))
    .addAttachmentOption(o => o.setName("immagine").setDescription("Foto del prodotto").setRequired(true)),
  new SlashCommandBuilder()
    .setName("compra-online")
    .setDescription("Compra prodotti online dai negozi"),
  new SlashCommandBuilder()
    .setName("richiesta-lavoro")
    .setDescription("Fai una richiesta di lavoro")
    .addStringOption(o => o.setName("posizione").setDescription("Posizione lavorativa desiderata").setRequired(true)),
];

async function handleCommand(interaction) {
  const { commandName, user, guildId, member } = interaction;
  await interaction.deferReply({ ephemeral: false });
  
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
      .setDescription(`Benvenuto ${user}! Il tuo conto bancario è stato aperto con successo con un bonus di **500 €**!\n\n> Usa **/creapin** per impostare il tuo PIN e iniziare a ricevere lo stipendio mensile!`)
      .setTimestamp()] });
  }

  if (commandName === "creapin") {
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**")] });
    if (acc.pin_hash) return interaction.editReply({ embeds: [err("Hai già un PIN impostato. Usa **/modificapin** per cambiarlo")] });
    const pin = interaction.options.getInteger("pin", true);
    await query("UPDATE bank_accounts SET pin_hash=$1 WHERE user_id=$2 AND guild_id=$3", [hashPin(pin), user.id, guildId]);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("🔐 PIN Creato!")
      .setDescription("Il PIN del tuo conto bancario è stato impostato con successo.\n✅ Ora riceverai lo **stipendio mensile** il 1° di ogni mese!")
      .setTimestamp()] });
  }

  if (commandName === "paga") {
    const target = interaction.options.getUser("utente", true);
    const importo = interaction.options.getInteger("importo", true);
    const motivo = interaction.options.getString("motivo", true);
    const pin = interaction.options.getInteger("pin", true);
    
    if (target.id === user.id) return interaction.editReply({ embeds: [err("Non puoi pagare te stesso")] });
    if (target.bot) return interaction.editReply({ embeds: [err("Non puoi pagare un bot")] });
    
    const mittente = await getAccount(user.id, guildId);
    if (!mittente) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**")] });
    if (!mittente.pin_hash) return interaction.editReply({ embeds: [err("Non hai un PIN impostato. Usa **/creapin** prima")] });
    if (hashPin(pin) !== mittente.pin_hash) return interaction.editReply({ embeds: [err("❌ PIN errato! Transazione annullata")] });
    if (mittente.balance < importo * 100) return interaction.editReply({ embeds: [err(`Saldo insufficiente. Hai solo ${euros(mittente.balance)}`)] });
    
    const destinatario = await getAccount(target.id, guildId);
    if (!destinatario) return interaction.editReply({ embeds: [err(`${target.displayName} non ha un conto bancario`)] });
    
    const amountInCents = importo * 100;
    
    // Embed di conferma
    const confirmEmbed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("💳 Conferma Pagamento")
      .setDescription(`Stai per inviare denaro a ${target}`)
      .addFields(
        { name: "👤 Mittente", value: user.toString(), inline: true },
        { name: "🎯 Destinatario", value: target.toString(), inline: true },
        { name: "💰 Importo", value: euros(amountInCents), inline: false },
        { name: "📝 Motivo", value: motivo, inline: false }
      )
      .setTimestamp();
    
    const confirmButton = new ButtonBuilder()
      .setCustomId(`confirm_pay_${target.id}_${amountInCents}`)
      .setLabel("✅ Conferma")
      .setStyle(ButtonStyle.Success);
    
    const cancelButton = new ButtonBuilder()
      .setCustomId("cancel_pay")
      .setLabel("❌ Annulla")
      .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
    
    await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
    
    // Store transaction data
    interaction.client.pendingTransactions = interaction.client.pendingTransactions || new Map();
    interaction.client.pendingTransactions.set(`pay_${user.id}`, {
      mittente: user.id,
      destinatario: target.id,
      amount: amountInCents,
      motivo,
      guildId
    });
  }

  if (commandName === "saldo") {
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa **/apriconto** per aprirne uno")] });
    
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x3498db)
      .setTitle("🏦 Il Tuo Conto Bancario")
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "💶 Saldo", value: euros(acc.balance), inline: true },
        { name: "🔐 PIN", value: acc.pin_hash ? "✅ Impostato" : "❌ Non impostato", inline: true }
      )
      .setTimestamp()] });
  }

  if (commandName === "stipendio") {
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa **/apriconto** per aprirne uno")] });
    
    const salaries = await getSalaries(guildId);
    const { totale, ruoli } = calcolaStipendio(member, salaries);
    
    const today = new Date();
    const nextSalaryDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    if (today.getDate() > 1) {
      nextSalaryDate.setFullYear(today.getFullYear());
    }
    
    const daysUntilSalary = Math.ceil((nextSalaryDate - today) / (1000 * 60 * 60 * 24));
    
    let rolesText = ruoli.length > 0 
      ? ruoli.map(r => `<@&${r.roleId}> - ${euros(r.importo * 100)}`).join("\n")
      : "❌ Non hai nessun ruolo associato";
    
    if (ruoli.length === 0) {
      rolesText += `\n\n> Se pensi sia un errore, contatta <@${CONTACT_USER_ID}>`;
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("💰 Informazioni Stipendio")
      .addFields(
        { name: "📅 Prossimo Stipendio", value: `${nextSalaryDate.toLocaleDateString("it-IT")} (tra ${daysUntilSalary} giorni)`, inline: false },
        { name: "💵 Importo Totale", value: totale > 0 ? euros(totale * 100) : "€0", inline: true },
        { name: "👔 I Tuoi Ruoli", value: rolesText, inline: false }
      )
      .setTimestamp();
    
    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === "case") {
    const houses = await listHouses(guildId);
    if (!houses.length) {
      return interaction.editReply({ embeds: [err("Non ci sono case disponibili al momento")] });
    }
    
    const embed = new EmbedBuilder()
      .setColor(0xD4AF37)
      .setTitle("🏡 Case Disponibili")
      .setDescription(houses.slice(0, 5).map(h => `#${h.id} • **${h.name}** - ${euros(h.price)}`).join("\n"));
    
    if (houses.length > 5) {
      const viewAll = new ButtonBuilder()
        .setCustomId("view_all_houses")
        .setLabel(`Vedi tutte (${houses.length})`)
        .setStyle(ButtonStyle.Primary);
      return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(viewAll)] });
    }
    
    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === "auto") {
    const cars = await listCars(guildId);
    if (!cars.length) {
      return interaction.editReply({ embeds: [err("Non ci sono auto disponibili al momento")] });
    }
    
    const embed = new EmbedBuilder()
      .setColor(0xFF4500)
      .setTitle("🚗 Auto Disponibili")
      .setDescription(cars.slice(0, 5).map(c => `#${c.id} • **${c.name}** - ${euros(c.price)}`).join("\n"));
    
    if (cars.length > 5) {
      const viewAll = new ButtonBuilder()
        .setCustomId("view_all_cars")
        .setLabel(`Vedi tutte (${cars.length})`)
        .setStyle(ButtonStyle.Primary);
      return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(viewAll)] });
    }
    
    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === "creacase") {
    const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
    if (!hasRole) return interaction.editReply({ embeds: [err("Solo lo STAFF può creare case")] });
    
    const nome = interaction.options.getString("nome", true);
    const prezzoStr = interaction.options.getString("prezzo", true);
    const prezzo = parsePrice(prezzoStr);
    const immagine = interaction.options.getAttachment("immagine", true);
    
    if (!isImageAttachment(immagine)) return interaction.editReply({ embeds: [err("L'allegato deve essere un'immagine")] });
    
    const { rows } = await query(
      "INSERT INTO houses(guild_id, creator_user_id, name, price, image_url) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [guildId, user.id, nome, prezzo, immagine.url]
    );
    
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("🏡 Casa Creata")
      .addFields(
        { name: "Nome", value: nome, inline: true },
        { name: "Prezzo", value: euros(prezzo), inline: true },
        { name: "ID", value: `#${rows[0].id}`, inline: true }
      )
      .setImage(immagine.url)] });
  }

  if (commandName === "rimuovi-casa") {
    const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
    if (!hasRole) return interaction.editReply({ embeds: [err("Solo lo STAFF può rimuovere case")] });
    
    const houseId = interaction.options.getInteger("id", true);
    const house = await getHouse(houseId, guildId);
    if (!house) return interaction.editReply({ embeds: [err("Casa non trovata")] });
    
    await query("DELETE FROM houses WHERE id=$1 AND guild_id=$2", [houseId, guildId]);
    
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("🗑️ Casa Rimossa")
      .setDescription(`La casa **${house.name}** è stata rimossa`)] });
  }

  if (commandName === "creauto") {
    const hasRole = member.roles?.cache?.has(CONCESSIONARIO_ROLE_ID);
    if (!hasRole) return interaction.editReply({ embeds: [err("Solo il CONCESSIONARIO può creare auto")] });
    
    const nome = interaction.options.getString("nome", true);
    const prezzoStr = interaction.options.getString("prezzo", true);
    const prezzo = parsePrice(prezzoStr);
    const immagine = interaction.options.getAttachment("immagine", true);
    
    if (!isImageAttachment(immagine)) return interaction.editReply({ embeds: [err("L'allegato deve essere un'immagine")] });
    
    const { rows } = await query(
      "INSERT INTO cars(guild_id, creator_user_id, name, price, image_url) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [guildId, user.id, nome, prezzo, immagine.url]
    );
    
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4500)
      .setTitle("🚗 Auto Creata")
      .addFields(
        { name: "Nome", value: nome, inline: true },
        { name: "Prezzo", value: euros(prezzo), inline: true },
        { name: "ID", value: `#${rows[0].id}`, inline: true }
      )
      .setImage(immagine.url)] });
  }

  if (commandName === "rimuovi-auto") {
    const hasRole = member.roles?.cache?.has(CONCESSIONARIO_ROLE_ID);
    if (!hasRole) return interaction.editReply({ embeds: [err("Solo il CONCESSIONARIO può rimuovere auto")] });
    
    const carId = interaction.options.getInteger("id", true);
    const car = await getCar(carId, guildId);
    if (!car) return interaction.editReply({ embeds: [err("Auto non trovata")] });
    
    await query("DELETE FROM cars WHERE id=$1 AND guild_id=$2", [carId, guildId]);
    
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4500)
      .setTitle("🗑️ Auto Rimossa")
      .setDescription(`L'auto **${car.name}** è stata rimossa`)] });
  }

  if (commandName === "creaprodotto") {
    if (user.id !== CONTACT_USER_ID) {
      return interaction.editReply({ embeds: [err("Solo il creatore può creare prodotti")] });
    }
    
    const shopKey = interaction.options.getString("negozio", true);
    const nome = interaction.options.getString("nome", true);
    const prezzoStr = interaction.options.getString("prezzo", true);
    const prezzo = parsePrice(prezzoStr);
    const immagine = interaction.options.getAttachment("immagine", true);
    
    if (!isImageAttachment(immagine)) return interaction.editReply({ embeds: [err("L'allegato deve essere un'immagine")] });
    
    const shopName = getShopName(shopKey);
    
    const { rows } = await query(
      "INSERT INTO products(guild_id, creator_user_id, shop_key, name, price, image_url) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [guildId, user.id, shopKey, nome, prezzo, immagine.url]
    );
    
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("📦 Prodotto Creato")
      .addFields(
        { name: "Negozio", value: shopName, inline: true },
        { name: "Nome", value: nome, inline: true },
        { name: "Prezzo", value: euros(prezzo), inline: true },
        { name: "ID", value: `#${rows[0].id}`, inline: true }
      )
      .setImage(immagine.url)] });
  }

  if (commandName === "compra-online") {
    const shopOptions = SHOP_CATALOG.map(shop => ({
      label: shop.name,
      value: shop.value,
      emoji: "🛍️"
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("select_shop")
      .setPlaceholder("Scegli il negozio")
      .addOptions(shopOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.editReply({ 
      content: "🛍️ **Seleziona il negozio dove vuoi fare acquisti**",
      components: [row] 
    });
  }

  if (commandName === "richiesta-lavoro") {
    const position = interaction.options.getString("posizione", true);
    
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle("📋 Richiesta di Lavoro")
      .setDescription(`${user} ha richiesto la posizione di **${position}**`)
      .addFields(
        { name: "👤 Candidato", value: user.toString() },
        { name: "💼 Posizione", value: position }
      )
      .setTimestamp();
    
    const approveButton = new ButtonBuilder()
      .setCustomId(`approve_job_${user.id}_${position}`)
      .setLabel("✅ Approva")
      .setStyle(ButtonStyle.Success);
    
    const rejectButton = new ButtonBuilder()
      .setCustomId(`reject_job_${user.id}`)
      .setLabel("❌ Rifiuta")
      .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder().addComponents(approveButton, rejectButton);
    
    return interaction.editReply({ embeds: [embed], components: [row] });
  }
}

async function handleSelectMenu(interaction) {
  const { customId, user, guildId, values } = interaction;

  if (customId === "select_shop") {
    const shopKey = values[0];
    const shopName = getShopName(shopKey);
    const products = await listProductsForShop(guildId, shopKey);

    if (!products.length) {
      return interaction.reply({ 
        embeds: [err(`Non ci sono prodotti disponibili in **${shopName}**`)],
        ephemeral: true 
      });
    }

    const productOptions = products.slice(0, 25).map(p => ({
      label: `${p.name} - ${euros(p.price)}`.substring(0, 100),
      value: `product_${p.id}`,
      emoji: "📦"
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_product_${shopKey}`)
      .setPlaceholder("Scegli il prodotto")
      .addOptions(productOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({ 
      content: `📦 **Prodotti in ${shopName}** (${products.length} disponibili)`,
      components: [row],
      ephemeral: true
    });
  }

  if (customId.startsWith("select_product_")) {
    const shopKey = customId.replace("select_product_", "");
    const productId = parseInt(values[0].replace("product_", ""));
    const product = await getProduct(productId, guildId);

    if (!product) {
      return interaction.reply({ 
        embeds: [err("Prodotto non trovato")],
        ephemeral: true 
      });
    }

    const buyerAcc = await getAccount(user.id, guildId);
    if (!buyerAcc) {
      return interaction.reply({ 
        embeds: [err("Non hai un conto bancario. Usa **/apriconto** per aprirne uno")],
        ephemeral: true 
      });
    }

    if (!buyerAcc.pin_hash) {
      return interaction.reply({ 
        embeds: [err("Non hai un PIN impostato. Usa **/creapin** prima")],
        ephemeral: true 
      });
    }

    const productEmbed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`📦 ${product.name}`)
      .setImage(product.image_url)
      .addFields(
        { name: "💰 Prezzo", value: euros(product.price), inline: true },
        { name: "🏪 Negozio", value: getShopName(shopKey), inline: true }
      )
      .setTimestamp();

    const buyButton = new ButtonBuilder()
      .setCustomId(`buy_product_${productId}_${product.creator_user_id}`)
      .setLabel("💳 Acquista")
      .setStyle(ButtonStyle.Success);

    const backButton = new ButtonBuilder()
      .setCustomId(`select_shop`)
      .setLabel("← Indietro")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(buyButton, backButton);

    return interaction.reply({ 
      embeds: [productEmbed],
      components: [row],
      ephemeral: true
    });
  }
}

async function handleButtonInteraction(interaction) {
  const { customId, user, guildId } = interaction;
  
  if (customId === "view_all_houses") {
    const houses = await listHouses(guildId);
    const embed = new EmbedBuilder()
      .setColor(0xD4AF37)
      .setTitle("🏡 Tutte le Case")
      .setDescription(houses.map(h => `#${h.id} • **${h.name}** - ${euros(h.price)}`).join("\n"));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  if (customId === "view_all_cars") {
    const cars = await listCars(guildId);
    const embed = new EmbedBuilder()
      .setColor(0xFF4500)
      .setTitle("🚗 Tutte le Auto")
      .setDescription(cars.map(c => `#${c.id} • **${c.name}** - ${euros(c.price)}`).join("\n"));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  if (customId.startsWith("confirm_pay_")) {
    const [_, targetId, amount] = customId.split("_");
    const pendingTx = interaction.client.pendingTransactions?.get(`pay_${user.id}`);
    
    if (!pendingTx) return interaction.reply({ content: "❌ Transazione scaduta", ephemeral: true });
    
    const mittente = await getAccount(user.id, guildId);
    if (!mittente || mittente.balance < Number(amount)) {
      return interaction.reply({ content: "❌ Saldo insufficiente", ephemeral: true });
    }
    
    await query("UPDATE bank_accounts SET balance=balance-$1 WHERE user_id=$2 AND guild_id=$3", [amount, user.id, guildId]);
    await query("UPDATE bank_accounts SET balance=balance+$1 WHERE user_id=$2 AND guild_id=$3", [amount, targetId, guildId]);
    await query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES($1,$2,$3,$4,$5,'pagamento')",
      [user.id, targetId, guildId, amount, pendingTx.motivo]
    );
    
    interaction.client.pendingTransactions.delete(`pay_${user.id}`);
    
    const successEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Pagamento Effettuato")
      .addFields(
        { name: "Importo", value: euros(amount), inline: true },
        { name: "A", value: `<@${targetId}>`, inline: true }
      );
    
    return interaction.reply({ embeds: [successEmbed], ephemeral: true });
  }
  
  if (customId === "cancel_pay") {
    interaction.client.pendingTransactions?.delete(`pay_${user.id}`);
    return interaction.reply({ content: "❌ Pagamento annullato", ephemeral: true });
  }
  
  if (customId.startsWith("buy_product_")) {
    const parts = customId.split("_");
    const productId = parseInt(parts[2]);
    const sellerId = parts[3];

    const product = await getProduct(productId, guildId);
    if (!product) {
      return interaction.reply({ embeds: [err("Prodotto non trovato")], ephemeral: true });
    }

    const buyerAcc = await getAccount(user.id, guildId);
    if (buyerAcc.balance < product.price) {
      return interaction.reply({ embeds: [err(`Saldo insufficiente. Hai solo ${euros(buyerAcc.balance)}`)], ephemeral: true });
    }

    // Mostra modal per Roblox user e PIN
    const modal = new ModalBuilder()
      .setCustomId(`purchase_modal_${productId}_${sellerId}`)
      .setTitle("Completa l'Acquisto");

    const robloxInput = new TextInputBuilder()
      .setCustomId("roblox_user")
      .setLabel("Il tuo Username Roblox")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const pinInput = new TextInputBuilder()
      .setCustomId("purchase_pin")
      .setLabel("Il tuo PIN (4 cifre)")
      .setStyle(TextInputStyle.Short)
      .setMinLength(4)
      .setMaxLength(4)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(robloxInput);
    const row2 = new ActionRowBuilder().addComponents(pinInput);

    modal.addComponents(row1, row2);
    await interaction.showModal(modal);
  }

  if (customId.startsWith("approve_job_")) {
    const [_, userId, position] = customId.split("_");
    const embedApprove = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Richiesta Approvata")
      .setDescription(`La richiesta di lavoro per **${position}** è stata approvata!`);
    
    return interaction.reply({ embeds: [embedApprove], ephemeral: false });
  }
  
  if (customId.startsWith("reject_job_")) {
    const embedReject = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("❌ Richiesta Rifiutata")
      .setDescription("La richiesta di lavoro è stata rifiutata");
    
    return interaction.reply({ embeds: [embedReject], ephemeral: false });
  }
}

async function handleModalSubmit(interaction) {
  const { customId, user, guildId, fields } = interaction;

  if (customId.startsWith("purchase_modal_")) {
    const parts = customId.split("_");
    const productId = parseInt(parts[2]);
    const sellerId = parts[3];

    const robloxUser = fields.getTextInputValue("roblox_user");
    const pinStr = fields.getTextInputValue("purchase_pin");
    const pin = parseInt(pinStr);

    await interaction.deferReply({ ephemeral: true });

    const product = await getProduct(productId, guildId);
    if (!product) {
      return interaction.editReply({ embeds: [err("Prodotto non trovato")] });
    }

    const buyer = await getAccount(user.id, guildId);
    if (!buyer) {
      return interaction.editReply({ embeds: [err("Conto non trovato")] });
    }

    if (hashPin(pin) !== buyer.pin_hash) {
      return interaction.editReply({ embeds: [err("❌ PIN errato!")] });
    }

    if (buyer.balance < product.price) {
      return interaction.editReply({ embeds: [err(`Saldo insufficiente. Hai solo ${euros(buyer.balance)}`)] });
    }

    try {
      await completeOnlinePurchase({
        buyerId: user.id,
        sellerId: sellerId,
        guildId: guildId,
        amount: product.price,
        productName: product.name,
        productId: product.id
      });

      // Salva l'ordine
      await query(
        "INSERT INTO orders(buyer_user_id, seller_user_id, guild_id, product_id, product_name, shop_key, price, roblox_user) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [user.id, sellerId, guildId, product.id, product.name, product.shop_key, product.price, robloxUser]
      );

      const successEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Acquisto Completato!")
        .addFields(
          { name: "📦 Prodotto", value: product.name, inline: true },
          { name: "💰 Importo", value: euros(product.price), inline: true },
          { name: "👤 Username Roblox", value: robloxUser, inline: false }
        )
        .setDescription("Stai in RP! Il pacco arriverà presto a te!")
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });

      // DM al venditore
      const client = interaction.client;
      const seller = await client.users.fetch(sellerId).catch(() => null);
      if (seller) {
        const sellerEmbed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle("📦 Nuovo Acquisto Online!")
          .addFields(
            { name: "👤 Compratore", value: `${user} (${user.id})`, inline: false },
            { name: "📦 Prodotto", value: product.name, inline: true },
            { name: "💰 Importo", value: euros(product.price), inline: true },
            { name: "🎮 Username Roblox Compratore", value: robloxUser, inline: false },
            { name: "💳 Saldo Aggiornato", value: euros((await getAccount(sellerId, guildId)).balance), inline: true }
          )
          .setTimestamp();
        await seller.send({ embeds: [sellerEmbed] }).catch(() => {});
      }

      // DM al postino
      const postino = await client.users.fetch(user.id).catch(() => null);
      if (postino) {
        const postinoEmbed = new EmbedBuilder()
          .setColor(0xFF4500)
          .setTitle("📬 Nuovo Pacco da Consegnare!")
          .addFields(
            { name: "👤 Destinatario", value: `${user}`, inline: false },
            { name: "🎮 Username Roblox", value: robloxUser, inline: false },
            { name: "📦 Prodotto", value: product.name, inline: true },
            { name: "🏪 Negozio", value: getShopName(product.shop_key), inline: true }
          )
          .setDescription("Consegna il pacco al destinatario mantenendo l'RP!")
          .setTimestamp();
        
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (guild) {
          const postiniRole = guild.roles.cache.get(POSTINO_ROLE_ID);
          if (postiniRole) {
            const postiniMembers = postiniRole.members;
            for (const [_, member] of postiniMembers) {
              await member.user.send({ embeds: [postinoEmbed] }).catch(() => {});
            }
          }
        }
      }

      // DM al compratore con istruzioni RP
      const buyerEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle("📬 Il Tuo Pacco è in Arrivo!")
        .addFields(
          { name: "📦 Prodotto", value: product.name, inline: true },
          { name: "💰 Importo Pagato", value: euros(product.price), inline: true },
          { name: "🏪 Negozio", value: getShopName(product.shop_key), inline: false }
        )
        .setDescription("**Stai in RP!** Il postino arriverà presto a consegnarti il tuo pacco. Sii il più realistico possibile durante l'interazione!")
        .setTimestamp();

      await user.send({ embeds: [buyerEmbed] }).catch(() => {});

    } catch (error) {
      console.error("Errore nell'acquisto:", error);
      return interaction.editReply({ embeds: [err(`Errore durante l'acquisto: ${error.message}`)] });
    }
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
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    }
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
    }
    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
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
