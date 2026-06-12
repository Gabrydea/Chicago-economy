const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");
const http = require("http");
const crypto = require("crypto");

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
  console.log("Database pronto.");
}

async function getAccount(userId, guildId) {
  const { rows } = await query("SELECT * FROM bank_accounts WHERE user_id=$1 AND guild_id=$2", [userId, guildId]);
  return rows[0] || null;
}

function euros(n) { return `**${Number(n).toLocaleString("it-IT")} €**`; }
function err(msg) { return new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Errore").setDescription(msg); }

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
];

async function handleCommand(interaction) {
  const { commandName, user, guildId, member } = interaction;
  const ephemeral = ["creapin", "modificapin", "paga"].includes(commandName);
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
      .setDescription(`Benvenuto ${user}! Il tuo conto bancario è stato aperto con successo con un bonus di **500 €**! 🎉\n\n> Usa **/creapin** per impostare il tuo PIN e iniziare a ricevere lo stipendio mensile di ${euros(STIPENDIO)}!`)
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
  if (!interaction.isChatInputCommand()) return;
  try { await handleCommand(interaction); }
  catch (e) {
    console.error(e);
    const msg = "Si è verificato un errore. Riprova.";
    if (interaction.replied || interaction.deferred) interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
    else interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

client.login(token);
Diff: index.js


bot-standalone/index.js
-0+24


      ).setTimestamp()] });}
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

await query("UPDATE cards SET nome=$1, cognome=$2 WHERE user_id=$3 AND guild_id=$4", [nome, cognome, user.id, guildId]);} else {
await query("INSERT INTO cards(user_id,guild_id,nome,cognome) VALUES($1,$2,$3,$4)", [user.id, guildId, nome, cognome]);}
await interaction.editReply({ content: "🎴 Generazione carta in corso..." });

const imgBuffer = await generateCardImage(user, member, nome, cognome, acc.created_at);
const attachment = new AttachmentBuilder(imgBuffer, { name: "carta.png" });

return interaction.editReply({ content: "", embeds: [new EmbedBuilder().setColor(0xD4AF37)

.setTitle("💳 La Tua Carta Chicago Economy Bank")
.setDescription(`${user} la tua carta è pronta!`)
.setImage("attachment://carta.png")
.setTimestamp()], files: [attachment] });}

if (commandName === "saldo") {

const acc = await getAccount(user.id, guildId);

if (!acc) return interaction.editReply({ embeds: [err("Non hai un conto bancario. Usa **/apriconto** per aprirne uno.")] });
