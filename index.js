const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { Pool } = require("pg");
const http = require("http");
const crypto = require("crypto");
const { createCanvas, registerFont, loadImage } = require("canvas");
const fs = require("fs");
const path = require("path");

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

async function setupDb() {
  await query(`CREATE TABLE IF NOT EXISTS bank_accounts (
    id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
    balance BIGINT NOT NULL DEFAULT 0, pin_hash TEXT, salary_paid_month TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, guild_id)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS cards (
    id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
    nome TEXT NOT NULL, cognome TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, guild_id)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS role_salaries (
    id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, role_id TEXT NOT NULL,
    amount BIGINT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(guild_id, role_id)
  )`);
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
    await query("INSERT INTO role_salaries(guild_id, role_id, amount) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [guildId, roleId, amount]);
  }
  await loadSalaries(guildId);
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
    if (member.roles.cache.has(roleId)) { totale += importo; ruoli.push({ roleId, importo }); }
  }
  return { totale, ruoli };
}

// --- GENERAZIONE CARTA AESTHETIC ---
async function generateCardImage(user, nome, cognome, createdAt, isPrivate = false) {
  const canvas = createCanvas(800, 450);
  const ctx = canvas.getContext("2d");

  // Sfondo Sfumato Moderno
  const grad = ctx.createLinearGradient(0, 0, 800, 450);
  grad.addColorStop(0, "#0f0c29"); 
  grad.addColorStop(0.5, "#302b63");
  grad.addColorStop(1, "#24243e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 450);

  // Pattern di decorazione (linee sottili)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  for (let i = 0; i < 800; i += 40) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 450); ctx.stroke();
  }

  // Bordo Oro Arrotondato
  ctx.strokeStyle = "#D4AF37";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 780, 430);

  // Foto Profilo
  const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
  const avatarImage = await loadImage(avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(650, 150, 80, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatarImage, 570, 70, 160, 160);
  ctx.restore();
  
  // Cerchio dorato intorno all'avatar
  ctx.strokeStyle = "#D4AF37";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(650, 150, 80, 0, Math.PI * 2);
  ctx.stroke();

  // Testi
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 40px Sans-Serif";
  ctx.fillText(nome.toUpperCase(), 50, 120);

  // Se è privata mostra il cognome, altrimenti mostra asterischi
  ctx.fillStyle = "#D4AF37";
  ctx.font = "bold 35px Sans-Serif";
  const displayCognome = isPrivate ? cognome.toUpperCase() : "********";
  ctx.fillText(displayCognome, 50, 170);

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "20px Sans-Serif";
  const data = new Date(createdAt).toLocaleDateString("it-IT");
  ctx.fillText(`MEMBRO DAL: ${data}`, 50, 240);
  ctx.fillText(`ID UTENTE: ${user.id.slice(0, 8)}...`, 50, 270);

  // PIN
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 25px Monospace";
  const displayPin = isPrivate ? "PIN ATTIVO" : "PIN: ****";
  ctx.fillText(displayPin, 50, 340);

  // Logo in basso
  ctx.fillStyle = "#D4AF37";
  ctx.font = "italic bold 22px Sans-Serif";
  ctx.fillText("CHICAGO CITY RP - OFFICIAL CARD", 50, 400);

  return canvas.toBuffer("image/png");
}

async function pagareStipendiGuild(client) {
  const now = new Date();
  if (now.getDate() !== 1) return;
  const mese = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { rows } = await query("SELECT * FROM bank_accounts WHERE (salary_paid_month IS NULL OR salary_paid_month != $1)", [mese]);

  for (const acc of rows) {
    let guild = client.guilds.cache.get(acc.guild_id);
    if (!guild) continue;
    let member = await guild.members.fetch(acc.user_id).catch(() => null);
    if (!member) continue;

    const salaries = await getSalaries(acc.guild_id);
    const { totale, ruoli } = calcolaStipendio(member, salaries);

    if (totale <= 0) continue;

    await query("UPDATE bank_accounts SET balance=balance+$1, salary_paid_month=$2 WHERE user_id=$3 AND guild_id=$4", [totale, mese, acc.user_id, acc.guild_id]);
    await query("INSERT INTO transactions(to_user_id,guild_id,amount,reason,type) VALUES($1,$2,$3,'Stipendio automatico','stipendio')", [acc.user_id, acc.guild_id, totale]);
  }
}

const commands = [
  new SlashCommandBuilder().setName("apriconto").setDescription("Apri un conto bancario"),
  new SlashCommandBuilder().setName("creapin").setDescription("Crea il tuo PIN (4 cifre)").addIntegerOption(o => o.setName("pin").setDescription("PIN").setRequired(true).setMinValue(1000).setMaxValue(9999)),
  new SlashCommandBuilder().setName("modificapin").setDescription("Modifica il PIN").addIntegerOption(o => o.setName("vecchiopin").setRequired(true)).addIntegerOption(o => o.setName("nuovopin").setRequired(true)),
  new SlashCommandBuilder().setName("paga").setDescription("Paga un utente").addUserOption(o => o.setName("utente").setRequired(true)).addIntegerOption(o => o.setName("importo").setRequired(true)).addStringOption(o => o.setName("motivo").setRequired(true)).addIntegerOption(o => o.setName("pin").setRequired(true)),
  new SlashCommandBuilder().setName("saldo").setDescription("Controlla il tuo saldo"),
  new SlashCommandBuilder().setName("stipendio").setDescription("Vedi il tuo stipendio mensile"),
  new SlashCommandBuilder().setName("creacarta").setDescription("Genera la tua carta (visibile a tutti, dettagli nascosti)").addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true)).addStringOption(o => o.setName("cognome").setDescription("Cognome").setRequired(true)).addIntegerOption(o => o.setName("pin").setDescription("PIN per conferma").setRequired(true)),
  // Comandi Staff
  new SlashCommandBuilder().setName("setstipendio").setDescription("[STAFF] Imposta stipendio").addRoleOption(o => o.setName("ruolo").setRequired(true)).addIntegerOption(o => o.setName("importo").setRequired(true)),
  new SlashCommandBuilder().setName("rimuovistipendio").setDescription("[STAFF] Rimuove stipendio").addRoleOption(o => o.setName("ruolo").setRequired(true)),
  new SlashCommandBuilder().setName("listastipendi").setDescription("[STAFF] Lista stipendi"),
];

async function handleCommand(interaction) {
  const { commandName, user, guildId, member } = interaction;
  
  // Rimosso 'creacarta' da ephemeral per renderla pubblica
  const ephemeral = ["saldo", "paga", "stipendio", "setstipendio", "rimuovistipendio", "listastipendi"].includes(commandName);
  await interaction.deferReply({ ephemeral });

  if (commandName === "apriconto") {
    const existing = await getAccount(user.id, guildId);
    if (existing) return interaction.editReply({ embeds: [err("Hai già un conto!")] });
    await query("INSERT INTO bank_accounts(user_id, guild_id, balance) VALUES($1, $2, 500)", [user.id, guildId]);
    return interaction.editReply("🏦 Conto aperto con successo! Bonus di **500 €** accreditato.");
  }

  if (commandName === "creapin") {
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply({ embeds: [err("Usa /apriconto prima.")] });
    if (acc.pin_hash) return interaction.editReply({ embeds: [err("PIN già esistente.")] });
    const pin = interaction.options.getInteger("pin", true);
    await query("UPDATE bank_accounts SET pin_hash=$1 WHERE user_id=$2 AND guild_id=$3", [hashPin(pin), user.id, guildId]);
    return interaction.editReply("🔐 PIN impostato correttamente!");
  }

  if (commandName === "creacarta") {
    const nome = interaction.options.getString("nome", true);
    const cognome = interaction.options.getString("cognome", true);
    const pin = interaction.options.getInteger("pin", true);
    const acc = await getAccount(user.id, guildId);

    if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario.")] });
    if (hashPin(pin) !== acc.pin_hash) return interaction.editReply({ embeds: [err("PIN errato.")] });

    // Salva o aggiorna i dati nel DB
    await query(`INSERT INTO cards(user_id, guild_id, nome, cognome) VALUES($1,$2,$3,$4) 
                 ON CONFLICT (user_id, guild_id) DO UPDATE SET nome=EXCLUDED.nome, cognome=EXCLUDED.cognome`, 
                 [user.id, guildId, nome, cognome]);

    // Genera versione PUBBLICA (senza cognome e senza pin vero)
    const imgBuffer = await generateCardImage(user, nome, cognome, acc.created_at, false);
    const attachment = new AttachmentBuilder(imgBuffer, { name: "carta_pubblica.png" });

    const btn = new ButtonBuilder()
      .setCustomId(`mostra_piena_${user.id}`)
      .setLabel("🔐 Visualizza Carta Intera (Solo Proprietario)")
      .setStyle(ButtonStyle.Success);

    return interaction.editReply({
      content: `🎴 Ecco la carta di ${user}! (Dati sensibili oscurati)`,
      files: [attachment],
      components: [new ActionRowBuilder().addComponents(btn)]
    });
  }

  if (commandName === "saldo") {
    const acc = await getAccount(user.id, guildId);
    if (!acc) return interaction.editReply("Non hai un conto.");
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("🏦 Saldo").setDescription(`Il tuo saldo: ${euros(acc.balance)}`)] });
  }
  
  // Altri comandi (rimasti invariati rispetto alla tua logica originale...)
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) await handleCommand(interaction);

  if (interaction.isButton()) {
    const [action, ownerId] = interaction.customId.split("_mostra_piena_"); // Fix split logic
    const realOwnerId = interaction.customId.split("_").pop();

    if (interaction.customId.startsWith("mostra_piena_")) {
      if (interaction.user.id !== realOwnerId) {
        return interaction.reply({ content: "❌ Solo il proprietario può richiedere la versione intera in DM!", ephemeral: true });
      }

      const card = await getCard(interaction.user.id, interaction.guildId);
      const acc = await getAccount(interaction.user.id, interaction.guildId);

      if (!card || !acc) return interaction.reply({ content: "Errore nel recupero dati.", ephemeral: true });

      try {
        // Genera versione PRIVATA (con cognome e dettagli)
        const imgBuffer = await generateCardImage(interaction.user, card.nome, card.cognome, acc.created_at, true);
        const attachment = new AttachmentBuilder(imgBuffer, { name: "la_tua_carta.png" });

        const embed = new EmbedBuilder()
          .setColor(0xD4AF37)
          .setTitle("💳 La Tua Carta Completa")
          .setDescription("Ecco la tua carta con tutti i dettagli visibili. Mantienila al sicuro!")
          .setImage("attachment://la_tua_carta.png")
          .setTimestamp();

        await interaction.user.send({ embeds: [embed], files: [attachment] });
        return interaction.reply({ content: "✅ Ti ho inviato la carta intera in DM!", ephemeral: true });
      } catch (e) {
        return interaction.reply({ content: "❌ Non sono riuscito a inviarti un DM. Controlla le impostazioni della privacy!", ephemeral: true });
      }
    }
  }
});

client.once("ready", async (rc) => {
  console.log(`Bot pronto: ${rc.user.tag}`);
  await setupDb();
  for (const guild of rc.guilds.cache.values()) await seedDefaultSalaries(guild.id);
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(rc.user.id), { body: commands.map(c => c.toJSON()) });
  setInterval(() => pagareStipendiGuild(rc).catch(console.error), 60 * 60 * 1000);
});

client.login(token);
