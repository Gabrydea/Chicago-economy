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
const STIPENDIO = 1500;

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
  console.log("Database pronto.");
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

// Funzione per generare l'immagine della carta
async function generateCardImage(user, member, nome, cognome, createdAt, pin) {
  try {
    // Scarica l'immagine di background se non esiste
    const bgPath = path.join(__dirname, "chicago-bg.jpg");
    if (!fs.existsSync(bgPath)) {
      const https = require("https");
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(bgPath);
        https.get("https://i.pinimg.com/originals/2e/4c/7d/2e4c7d8b8e4c7d8b8e4c7d8b8e4c7d8b.jpg", (response) => {
          response.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
      });
    }

    const canvas = createCanvas(800, 500);
    const ctx = canvas.getContext("2d");

    // Carica e disegna il background
    const bgImage = await loadImage(bgPath);
    ctx.drawImage(bgImage, 0, 0, 800, 500);

    // Overlay scuro
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
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

    // Logo Chicago Economy Bank
    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "#D4AF37";
    ctx.fillText("Chicago Economy Bank", 40, 450);

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
  for (const acc of rows) {
    await query(
      "UPDATE bank_accounts SET balance=balance+$1, salary_paid_month=$2 WHERE user_id=$3 AND guild_id=$4",
      [STIPENDIO, mese, acc.user_id, acc.guild_id]
    );
    await query(
      "INSERT INTO transactions(from_user_id,to_user_id,guild_id,amount,reason,type) VALUES(NULL,$1,$2,$3,'Stipendio mensile automatico','stipendio')",
      [acc.user_id, acc.guild_id, STIPENDIO]
    );
    try {
      const user = await client.users.fetch(acc.user_id);
      await user.send({ embeds: [new EmbedBuilder().setColor(0x2ecc71)
        .setTitle("💰 Stipendio Accreditato!")
        .setDescription(`Il tuo stipendio mensile di ${euros(STIPENDIO)} è stato accreditato sul tuo conto bancario! 🎉`)
        .setTimestamp()] });
    } catch {}
    console.log(`Stipendio pagato a ${acc.user_id} (guild: ${acc.guild_id})`);
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
    .setName("tassa")
    .setDescription("[SOLO STAFF] Applica una tassa a tutti i conti bancari del server")
    .addIntegerOption(o => o.setName("percentuale").setDescription("Percentuale da tassare (1-50%)").setRequired(true).setMinValue(1).setMaxValue(50))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo della tassa").setRequired(false)),

  new SlashCommandBuilder()
    .setName("creacarta")
    .setDescription("Crea la tua carta Chicago Economy Bank")
    .addStringOption(o => o.setName("nome").setDescription("Il tuo nome").setRequired(true))
    .addStringOption(o => o.setName("cognome").setDescription("Il tuo cognome").setRequired(true))
    .addIntegerOption(o => o.setName("pin").setDescription("Il tuo PIN a 4 cifre").setRequired(true).setMinValue(1000).setMaxValue(9999)),
];

async function handleCommand(interaction) {
  const { commandName, user, guildId, member } = interaction;
  const ephemeral = ["creapin", "modificapin", "paga", "creacarta"].includes(commandName);
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
      const imgBuffer = await generateCardImage(user, member, nome, cognome, acc.created_at, pin);
      const attachment = new AttachmentBuilder(imgBuffer, { name: "carta.png" });

      const showDetailsButton = new ButtonBuilder()
        .setCustomId(`mostra_dettagli_${user.id}`)
        .setLabel("🔐 Mostra Dettagli")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(showDetailsButton);

      return interaction.editReply({
        content: "",
        embeds: [new EmbedBuilder().setColor(0xD4AF37)
          .setTitle("💳 La Tua Carta Chicago Economy Bank")
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
    const prossimoStipendio = acc.pin_hash ? "✅ Attivo (1° del mese)" : "❌ Disattivato (imposta il PIN)";
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x3498db)
      .setTitle("🏦 Il Tuo Conto Bancario")
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "💶 Saldo", value: euros(acc.balance), inline: true },
        { name: "🔐 Sicurezza", value: pinStatus, inline: true },
        { name: "💰 Stipendio", value: prossimoStipendio, inline: false }
      ).setTimestamp()] });
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async (rc) => {
  console.log(`Bot online: ${rc.user.tag}`);
  await setupDb();
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
        const pinDisplay = card.cognome ? `**${interaction.options?.getInteger("pin") || "****"}**` : "Non disponibile";

        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xD4AF37)
            .setTitle("💳 Dettagli Carta (Privati)")
            .addFields(
              { name: "👤 Nome", value: `${card.nome} ${card.cognome}`, inline: false },
              { name: "🔐 PIN", value: pinDisplay, inline: false },
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
