const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { Pool } = require("pg");
const http = require("http");
const crypto = require("crypto");
const { createCanvas, loadImage } = require("canvas");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end("Bot online!"); }).listen(PORT, () => {
  console.log(`Health check su porta ${PORT}`);
});
const token = process.env.DISCORD_BOT_TOKEN;
const dbUrl = process.env.DATABASE_URL;
const STAFF_ROLE_ID = "1504115375577497600";
const CONTACT_USER_ID = "1141049314433573044";
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
function euros(n) { return `**${Number(n).toLocaleString("it-IT")} €**`; }
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
async function generateCardImage(user, nome, cognome, createdAt, { isPublic = true, pin = null } = {}) {
  const canvas = createCanvas(860, 540);
  const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, 860, 540);
  bg.addColorStop(0, "#0f0c29");
  bg.addColorStop(0.5, "#302b63");
  bg.addColorStop(1, "#24243e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 860, 540);
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(120 + i * 130, 80 + (i % 2) * 40, 90, 0, Math.PI * 2);
    ctx.fill();
  }
  roundRect(ctx, 24, 24, 812, 492, 28);
  ctx.fillStyle = "rgba(10, 10, 20, 0.55)";
  ctx.fill();
  ctx.strokeStyle = "#D4AF37";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const accent = ctx.createLinearGradient(40, 40, 400, 120);
  accent.addColorStop(0, "#f5d76e");
  accent.addColorStop(1, "#D4AF37");
  ctx.fillStyle = accent;
  ctx.font = "bold 22px Arial";
  ctx.fillText("CHICAGO CITY RP", 48, 72);
  ctx.fillStyle = "rgba(212, 175, 55, 0.85)";
  ctx.font = "14px Arial";
  ctx.fillText(isPublic ? "CARTA IDENTITÀ · VERSIONE PUBBLICA" : "CARTA IDENTITÀ · VERSIONE COMPLETA", 48, 98);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px Arial";
  ctx.fillText(nome.toUpperCase(), 48, 170);
  if (!isPublic && cognome) {
    ctx.fillStyle = "#D4AF37";
    ctx.font = "bold 34px Arial";
    ctx.fillText(cognome.toUpperCase(), 48, 220);
  }
  const dataCreazione = new Date(createdAt).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "16px Arial";
  ctx.fillText(`Membro dal ${dataCreazione}`, 48, isPublic ? 230 : 280);
  ctx.fillStyle = "#D4AF37";
  ctx.font = "16px Arial";
  ctx.fillText(`@${user.username}`, 48, isPublic ? 265 : 315);
  if (!isPublic && pin) {
    roundRect(ctx, 48, 350, 220, 56, 12);
    ctx.fillStyle = "rgba(212, 175, 55, 0.15)";
    ctx.fill();
    ctx.strokeStyle = "#D4AF37";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px Arial";
    ctx.fillText(`PIN · ${pin}`, 64, 385);
  } else if (isPublic) {
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "14px Arial";
    ctx.fillText("Dati sensibili nascosti", 48, 310);
  }
  const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
  const avatarImage = await loadImage(avatarUrl);
  const avatarX = 680;
  const avatarY = 270;
  const avatarRadius = 88;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 6, 0, Math.PI * 2);
  ctx.fillStyle = "#D4AF37";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(avatarImage, avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
  ctx.restore();
  ctx.fillStyle = "rgba(212, 175, 55, 0.9)";
  ctx.font = "bold 16px Arial";
  ctx.fillText("Chicago City Rp Card", 48, 490);
  if (isPublic) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "12px Arial";
    ctx.fillText("Solo il proprietario può richiedere la versione completa", 48, 512);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "12px Arial";
    ctx.fillText("Documento riservato — non condividere", 48, 512);
  }
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
          .setDescription(`Non hai nessun ruolo lavorativo assegnato, quindi non puoi ricevere lo stipendio mensile.\n\n> Contatta <@${CONTACT_USER_ID}> per farti assegnare un ruolo e iniziare a guadagnare!`)
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
    const dettaglioRuoli = ruoli.map(r => `<@&${r.roleId}> → ${euros(r.importo)}`).join("\n");
    try {
      const u = await client.users.fetch(acc.user_id);
      await u.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
        .setTitle("💰 Stipendio Accreditato!")
        .setDescription(`Il tuo stipendio mensile di ${euros(totale)} è stato accreditato sul tuo conto bancario! 🎉`)
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
    .setDescription("Mostra la tua carta nel canale (versione pubblica)")
    .addIntegerOption(o => o.setName("pin").setDescription("Il tuo PIN per confermare").setRequired(true).setMinValue(1000).setMaxValue(9999)),
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
    .setLabel("🔐 Vedi carta completa")
    .setStyle(ButtonStyle.Secondary);
  const row = new ActionRowBuilder().addComponents(fullCardButton);
  return {
    content: "",
    embeds: [new EmbedBuilder().setColor(0xD4AF37)
      .setTitle("💳 Chicago City Rp Card")
      .setDescription(`${user} ha mostrato la propria carta identità.\n*Versione pubblica — cognome e PIN nascosti.*`)
      .setImage("attachment://carta_pubblica.png")
      .setFooter({ text: "Solo il proprietario può richiedere la carta completa via DM" })
      .setTimestamp()],
    files: [attachment],
    components: [row],
  };
}
async function handleCommand(interaction) {
  const { commandName, user, guildId, member } = interaction;
  const ephemeral = ["saldo", "paga", "stipendio", "setstipendio", "rimuovistipendio", "listastipendi"].includes(commandName);
  await interaction.deferReply({ ephemeral });
  if (commandName === "apriconto") {
    const existing = await getAccount(user.id, guildId);
    if (existing) {
      return interaction.editReply({ embeds: [err("Hai già un conto bancario aperto!")] });
    }
    await query(
      "INSERT INTO bank_accounts(user_id, guild_id, balance) VALUES($1, $2, 500)",
      [user.id, guildId]
    );
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("🏦 Conto Bancario Aperto!")
      .setDescription(`Benvenuto ${user}! Il tuo conto bancario è stato aperto con successo con un bonus di **500 €**! 🎉\n\n> Usa **/creapin** per impostare il tuo PIN e iniziare a ricevere lo stipendio mensile!`)
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
    if (mittente.balance < importo) return interaction.editReply({ embeds: [err(`Saldo insufficiente. Hai solo ${euros(mittente.balance)} sul conto.`)] });
    const destinatario = await getAccount(target.id, guildId);
    if (!destinatario) return interaction.editReply({ embeds: [err(`${target.displayName} non ha un conto bancario.`)] });
    await query("UPDATE bank_accounts SET balance=balance-$1 WHERE user_id=$2 AND guild_id=$3", [importo, user.id, guildId]);
    await query("UPDATE bank_accounts SET balance=balance+$1 WHERE user_id=$2 AND guild_id=$3", [importo, target.id, guildId]);
    await query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES($1,$2,$3,$4,$5,'pagamento')",
      [user.id, target.id, guildId, importo, motivo]
    );
    try {
      await target.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
        .setTitle("💸 Hai Ricevuto un Pagamento!")
        .setDescription(`${user.tag} ti ha inviato ${euros(importo)}`)
        .addFields({ name: "Motivo", value: motivo })
        .setTimestamp()] });
    } catch {}
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("✅ Pagamento Effettuato!")
      .setDescription(`Hai inviato ${euros(importo)} a ${target}`)
      .addFields(
        { name: "Motivo", value: motivo },
        { name: "Tuo saldo rimanente", value: euros(mittente.balance - importo) }
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
    const sequestrabile = Math.min(importo, vittima.balance);
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
      [guildId, ruolo.id, importo]
    );
    await loadSalaries(guildId);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
      .setTitle("💼 Stipendio Impostato")
      .setDescription(`Lo stipendio mensile del ruolo ${ruolo} è ora ${euros(importo)}.`)
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
      .setDescription(`Ogni 1° del mese riceverai un totale di ${euros(totale)}`)
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
    const pin = interaction.options.getInteger("pin", true);
    const acc = await getAccount(user.id, guildId);
    const card = await getCard(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa prima **/apriconto**.")] });
    if (!card) return interaction.editReply({ embeds: [err("Non hai ancora una carta. Usa **/creacarta** prima.")] });
    if (!acc.pin_hash) return interaction.editReply({ embeds: [err("Non hai un PIN impostato. Usa **/creapin** prima.")] });
    if (hashPin(pin) !== acc.pin_hash) return interaction.editReply({ embeds: [err("❌ PIN errato!")] });
    await query("UPDATE cards SET pin_enc=$1 WHERE user_id=$2 AND guild_id=$3", [encryptPin(pin), user.id, guildId]);
    await interaction.editReply({ content: "🎴 Generazione carta in corso..." });
    try {
      const imgBuffer = await generateCardImage(user, card.nome, card.cognome, card.created_at, { isPublic: true });
      return interaction.editReply(buildPublicCardReply(user, imgBuffer));
    } catch (error) {
      console.error("Errore nella generazione della carta:", error);
      return interaction.editReply({ embeds: [err("Errore nella generazione della carta. Riprova più tardi.")] });
    }
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
  const pin = decryptPin(card.pin_enc);
  if (!pin) {
    return interaction.editReply({
      embeds: [err("PIN non disponibile. Usa **/mostracarta** o **/creacarta** inserendo il PIN per aggiornare la carta.")],
    });
  }
  try {
    const user = await interaction.client.users.fetch(interaction.user.id);
    const imgBuffer = await generateCardImage(user, card.nome, card.cognome, card.created_at, { isPublic: false, pin });
    const attachment = new AttachmentBuilder(imgBuffer, { name: "carta_completa.png" });
    await interaction.user.send({
      embeds: [new EmbedBuilder().setColor(0xD4AF37)
        .setTitle("🔐 Carta Completa — Solo per te")
        .setDescription("Ecco la tua **Chicago City Rp Card** con tutti i dati.\n**Non condividere questo messaggio.**")
        .setImage("attachment://carta_completa.png")
        .setTimestamp()],
      files: [attachment],
    });
    return interaction.editReply({
      content: "✅ Carta completa inviata nei tuoi **messaggi privati (DM)**!",
    });
  } catch (error) {
    console.error("Errore invio carta completa:", error);
    return interaction.editReply({
      embeds: [err("Non riesco a scriverti in DM. Abilita i messaggi privati dal server e riprova.")],
    });
  }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
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
