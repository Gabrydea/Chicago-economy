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

// ID dell'utente da contattare se non si ha un ruolo lavorativo
const CONTACT_USER_ID = "1141049314433573044";

// Stipendi per ruolo di DEFAULT. La chiave è l'ID del ruolo, il valore è lo stipendio mensile.
// Questi valori vengono inseriti nel database al primo avvio. Dopodiché gli stipendi
// possono essere modificati a runtime con i comandi staff (/setstipendio, /rimuovistipendio).
// Se un utente ha più ruoli, gli stipendi vengono SOMMATI.
const DEFAULT_ROLE_SALARIES = {
  "1514961491433099386": 150, // canta
  "1514960724626116721": 100, // aggiusta le macchine
  "1512153845373993001": 200, // forze dell'ordine
  "1512029409211715715": 200, // curano i cittadini
  "1504115591676559533": 250, // controllano la città
  "1504115627844042905": 100, // vende gelati
  "1504115690116874311": 100, // vende pizze
  "1504115728859529371": 150, // vende bevande
  "1504115619291730041": 100, // vende cibo
};

// Cache in memoria degli stipendi: Map<guildId, Map<roleId, importo>>
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
  console.log("Database pronto.");
}

// Carica gli stipendi di una guild dal DB nella cache in memoria.
async function loadSalaries(guildId) {
  const { rows } = await query("SELECT role_id, amount FROM role_salaries WHERE guild_id=$1", [guildId]);
  const map = new Map();
  for (const r of rows) map.set(r.role_id, Number(r.amount));
  salaryCache.set(guildId, map);
  return map;
}

// Ritorna la mappa stipendi di una guild (dalla cache o caricandola dal DB).
async function getSalaries(guildId) {
  if (salaryCache.has(guildId)) return salaryCache.get(guildId);
  return await loadSalaries(guildId);
}

// Inserisce gli stipendi di default per una guild solo se non ne ha ancora nessuno.
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

// Calcola lo stipendio di un membro sommando lo stipendio di ogni ruolo lavorativo posseduto.
// "salaries" è la Map<roleId, importo> della guild.
// Ritorna { totale, ruoli } dove "ruoli" è l'elenco dei ruoli lavorativi posseduti.
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

// Funzione per generare l'immagine della carta
async function generateCardImage(user, member, nome, cognome, createdAt) {
  try {
    const canvas = createCanvas(800, 500);
    const ctx = canvas.getContext("2d");

    // Sfondo con gradiente "tramonto di Chicago" (disegnato, nessun file esterno)
    const gradient = ctx.createLinearGradient(0, 0, 0, 500);
    gradient.addColorStop(0, "#1a1a2e");   // cielo notturno in alto
    gradient.addColorStop(0.45, "#7b3f1d"); // arancione scuro
    gradient.addColorStop(0.7, "#c2671f");  // arancione tramonto
    gradient.addColorStop(1, "#0d0d14");    // acqua scura in basso
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 500);

    // Overlay scuro per leggibilità del testo
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(0, 0, 800, 500);

    // Disegna il bordo della carta (oro)
    ctx.strokeStyle = "#D4AF37";
    ctx.lineWidth = 3;
    ctx.strokeRect(15, 15, 770, 470);

    // Carica la foto del profilo Discord
    const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256 });
    const avatarImage = await loadImage(avatarUrl);

    // Disegna la foto a destra (circolare)
    const avatarX = 680;
    const avatarY = 150;
    const avatarRadius = 90;

    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#D4AF37";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#D4AF37";
    ctx.stroke();

    // Disegna l'avatar dentro il cerchio
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarRadius - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatarImage, avatarX - avatarRadius + 4, avatarY - avatarRadius + 4, (avatarRadius - 4) * 2, (avatarRadius - 4) * 2);
    ctx.restore();

    // Testo a sinistra
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 32px Arial";
    ctx.fillText(nome, 40, 120);

    ctx.font = "bold 32px Arial";
    ctx.fillStyle = "#D4AF37";
    ctx.fillText(cognome, 40, 170);

    // Data di creazione
    const dataCreazione = new Date(createdAt).toLocaleDateString("it-IT");
    ctx.font = "16px Arial";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`Data apertura: ${dataCreazione}`, 40, 250);

    // Username Discord
    ctx.font = "16px Arial";
    ctx.fillStyle = "#D4AF37";
    ctx.fillText(`@${user.username}`, 40, 280);

    // PIN (nascosto con asterischi per l'anteprima)
    ctx.font = "20px Arial";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("PIN: ****", 40, 350);

    // Logo Chicago City Rp Card
    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "#D4AF37";
    ctx.fillText("Chicago City Rp Card", 40, 450);

    return canvas.toBuffer("image/png");
  } catch (error) {
    console.error("Errore nella generazione della carta:", error);
    throw error;
  }
}

async function pagareStipendiGuild(client) {
  const now = new Date();
  if (now.getDate() !== 1) return;
  const mese = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { rows } = await query(
    "SELECT * FROM bank_accounts WHERE (salary_paid_month IS NULL OR salary_paid_month != $1)",
    [mese]
  );

  // Cache delle guild per non rifare il fetch ogni volta
  const guildCache = new Map();

  for (const acc of rows) {
    // Recupera la guild
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

    // Recupera il membro per leggere i suoi ruoli
    let member;
    try {
      member = await guild.members.fetch(acc.user_id);
    } catch {
      member = null;
    }
    if (!member) continue;

    const salaries = await getSalaries(acc.guild_id);
    const { totale, ruoli } = calcolaStipendio(member, salaries);

    // Nessun ruolo lavorativo: avvisa in DM di contattare il referente
    if (totale <= 0) {
      try {
        const user = await client.users.fetch(acc.user_id);
        await user.send({ embeds: [new EmbedBuilder().setColor(0xe67e22)
          .setTitle("⚠️ Nessuno Stipendio Questo Mese")
          .setDescription(`Non hai nessun ruolo lavorativo assegnato, quindi non puoi ricevere lo stipendio mensile.\n\n> Contatta <@${CONTACT_USER_ID}> per farti assegnare un ruolo e iniziare a guadagnare!`)
          .setTimestamp()] });
      } catch {}
      console.log(`Nessun ruolo lavorativo per ${acc.user_id} (guild: ${acc.guild_id}) - avviso inviato`);
      continue;
    }

    // Accredita lo stipendio sommato dei ruoli
    await query(
      "UPDATE bank_accounts SET balance=balance+$1, salary_paid_month=$2 WHERE user_id=$3 AND guild_id=$4",
      [totale, mese, acc.user_id, acc.guild_id]
    );
    await query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES(NULL,$1,$2,$3,'Stipendio mensile automatico','stipendio')",
      [acc.user_id, acc.guild_id, totale]
    );

    // Dettaglio dei ruoli per il messaggio
    const dettaglioRuoli = ruoli.map(r => `<@&${r.roleId}> → ${euros(r.importo)}`).join("\n");

    try {
      const user = await client.users.fetch(acc.user_id);
      await user.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
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

async function handleCommand(interaction) {
  const { commandName, user, guildId, member } = interaction;
  const ephemeral = ["saldo", "paga", "creacarta", "stipendio", "setstipendio", "rimuovistipendio", "listastipendi"].includes(commandName);
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

    const { rows: existing } = await query("SELECT * FROM cards WHERE user_id=$1 AND guild_id=$2", [user.id, guildId]);

    if (existing.length) {
      await query("UPDATE cards SET nome=$1, cognome=$2 WHERE user_id=$3 AND guild_id=$4", [nome, cognome, user.id, guildId]);
    } else {
      await query("INSERT INTO cards(user_id,guild_id,nome,cognome) VALUES($1,$2,$3,$4)", [user.id, guildId, nome, cognome]);
    }

    await interaction.editReply({ content: "🎴 Generazione carta in corso..." });

    try {
      const imgBuffer = await generateCardImage(user, member, nome, cognome, acc.created_at);
      const attachment = new AttachmentBuilder(imgBuffer, { name: "carta.png" });

      const showDetailsButton = new ButtonBuilder()
        .setCustomId(`mostra_dettagli_${user.id}`)
        .setLabel("🔐 Mostra Dettagli")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(showDetailsButton);

      return interaction.editReply({
        content: "",
        embeds: [new EmbedBuilder().setColor(0xD4AF37)
          .setTitle("💳 La Tua Carta Chicago City Rp Card")
          .setDescription(`${user} la tua carta è pronta!`)
          .setImage("attachment://carta.png")
          .setTimestamp()],
        files: [attachment],
        components: [row]
      });
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

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once("ready", async (rc) => {
  console.log(`Bot online: ${rc.user.tag}`);
  await setupDb();
  // Inserisce gli stipendi di default e popola la cache per ogni guild
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

    if (interaction.isButton()) {
      const buttonId = interaction.customId;

      if (buttonId.startsWith("mostra_dettagli_")) {
        const cardOwnerId = buttonId.split("_")[2];

        // Controlla se il button è cliccato dal proprietario della carta
        if (interaction.user.id !== cardOwnerId) {
          return interaction.reply({ content: "❌ Puoi solo vedere i tuoi dettagli!", ephemeral: true });
        }

        const card = await getCard(interaction.user.id, interaction.guildId);
        if (!card) {
          return interaction.reply({ embeds: [err("Carta non trovata.")] , ephemeral: true });
        }

        const acc = await getAccount(interaction.user.id, interaction.guildId);

        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xD4AF37)
            .setTitle("💳 Dettagli Carta (Privati)")
            .addFields(
              { name: "👤 Nome", value: `${card.nome} ${card.cognome}`, inline: false },
              { name: "🔐 PIN", value: `**${acc.pin_hash ? "Protetto" : "Non impostato"}**`, inline: false },
              { name: "💶 Saldo Conto", value: `**${acc.balance} €**`, inline: false },
              { name: "📅 Data Creazione", value: new Date(card.created_at).toLocaleDateString("it-IT"), inline: false }
            )
            .setThumbnail(interaction.user.displayAvatarURL())
            .setTimestamp()],
          ephemeral: true
        });
      }
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
