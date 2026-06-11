const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } =

require("discord.js");

2

3

2 const { Pool } require("pg");

3 const http = require("http");

4

5

// Tiny HTTP server so Render.com non spegne il

processo

6

7

4 const crypto = require("crypto");

5

6 const PORT = process.env. PORT || 3000;

7 http.createServer((req, res)

8

8

{

=> { res.writeHead(200); res.end("Bot online!");

}).listen(PORT, () =>

console.log(`Health check server su porta ${PORT}`);

console.log(`Health check

su

9

9

porta ${PORT});

});

10

10

11

11

const token =

nrocess eny DISCORD BOT TOKENconst dbUrl =

13

process.env.DATABASE_URL;

const STAFF_ROLE_ID

13

14

15

14

16

"1504115375577497600";

const STIPENDIO = 1500;

if (!token) {

console.error("DISCORD_BOT_TOK

EN mancante");

process.exit(1); }

15 17 if (!dbUrl) { console.error("DATABASE_URL

mancante"); process.exit(1); }

-99 +111

22

24

finally { client.release();

23

25

}

}

24

26

27

{

28

return

29

30

25

31

26

27

28

function hashPin(pin)

crypto.createHash("sha256").up date(String(pin)).digest("hex"

);

}

async function setupDb() { await query(`CREATE TABLE IF

NOT EXISTS wallets (

id SERIAL PRIMARY KEY, user_id TEXT NOT NULL,

guild_id TEXT NOT NULL,

balance INTEGER NOT NULIDEFAULT 0, last_daily TIMESTAMPTZ, last_work TIMESTAMPTZ,

UNIQUE(user_id,

await query(`CREATE TABLE IF

await query(`CREATE TABLE IF

guild_id))`);

NOT EXISTS shop_items ( id SERIAL PRIMARY KEY,

name TEXT NOT NULL,

description TEXT NOT NULL,

price INTEGER NOT NULL, emoji TEXT NOT NULL DEFAULT '', guild_id TEXT)');

NOT EXISTS inventory_items ( id SERIAL PRIMARY KEY,

user_id TEXT NOT NULL,

guild_id TEXT NOT NULL,

item_id INTEGER NOT NULL, item_name TEXT NOT NULL, item_emoji TEXT NOT NULL,

quantity INTEGER NOT NULL

DEFAULT 1)`);

const { rows } = await query("SELECT 1 FROM shop_items LIMIT 1");

if (rows.length === 0) { await query(`INSERT INTO

shop_items

(name, description, price, emoji)

VALUES

('Lucky Charm', 'Unamuleto che porta fortuna.',500,''),

('VIP Badge', 'Badge VIP esclusivo.', 2500,''),

42

('Golden Trophy', 'Trofeo

43

'Contiene

44

d''oro per i

campioni.',5000,''), ('Mystery Box',

qualcosa di

misterioso.', 1000,''), ('Crown','Per chi

governa il

server.',10000, '')`);

45

console.log("Oggetti

negozio aggiunti.");

46

}

47

48

49

50

51

}

async function

getWallet(userId, guildId) { await query("INSERT INTO wallets(user_id,guild_id) VALUES($1, $2) ON CONFLICT DO NOTHING", [userId, guildId]);

const { rows } = await query("SELECT * FROM wallets WHERE user_id=$1 AND guild_id=$2", [userId,

guildId]);

return rows[0];

52

53

}

54function coins(n) { return **${Number(n).toLocaleString(

function timeLeft(ms) { const s = Math.ceil(ms / 1000);

const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;

return h > 0 ? `${h}h ${m}m

60

${sec}s : m > 0 ? `${m}m

${sec}s` : `${sec}s`;

await query(`CREATE TABLE IF NOT EXISTS bank_accounts (

}

32

33

34

35

36

guild_id TEXT NOT NULL,

id SERIAL PRIMARY KEY,

user_id TEXT NOT NULL,

balance BIGINT NOT NULL DEFAULT 0,

37

38

pin_hash TEXT,

salary_paid_month TEXT,

39

40

created at TIMESTAMPTZ DEFAULT NOW(),

UNIQUE(user_id, guild_id)

41

));

42

await query(`CREATE TABLE IF NOT EXISTS transactions (

43

44

45

46

id SERIAL PRIMARY KEY,

from_user_id TEXT,

to_user_id TEXT,

guild_id TEXT NOT NULL,console.log("Database

)`);

51

52

53

pronto.");

}

async function

getAccount(userId, guildId) {

54

55

56 const { rows } = await query("SELECT * FROM bank_accounts WHERE user_id=$1 AND guild_id=$2", [userId,

guildId]);

57

58

59

60

return rows[0] || null;

}

function euros(n) { return **${Number(n).toLocaleString( "it-IT")} €**`; }

61

61 function err(msg) { return new EmbedBuilder().setColor(0xe74c 3c).setTitle("X

62 62

Errore").setDescription(msg); }

const now = new Date();

63 async function pagareStipendiGuild(client) {

64

65 if (now.getDate() !== 1) return;

66

const mese =

`${now.getFullYear()}-${String (now.getMonth() +const mese =

${now.getFullYear()}-${String

(now.getMonth() +

1).padStart(2, "0")}`;

67 const { rows } = await query(

68

69

70

71

72

73

74

75

76

77

78

79

"SELECT * FROM

bank_accounts WHERE

(salary_paid_month IS NULL OR salary_paid_month != $1)",

[mese]

for (const acc of rows) {

await query(

"UPDATE bank_accounts SET balance=balance+$1, salary_paid_month=$2 WHERE user_id=$3 AND guild_id=$4",

[STIPENDIO, mese,

acc.user_id, acc.guild_id]

await query(

"INSERT INTO

transactions(from_user_id, to_u ser_id, guild_id, amount, reason, type)

VALUES(NULL, $1, $2, $3, 'Stipendi

o mensile

automatico','stipendio')",

[acc.user_id,

acc.guild_idtry {

const user = await

83

84

.setTitle("

client.users.fetch(acc.user_id

await user.send({ embeds: [new

EmbedBuilder().setColor(Ox2ecc 71)

Stipendio Accreditato!") .setDescription(`Il tuo stipendio mensile di ${euros (STIPENDIO)} è stato accreditato sul tuo conto bancario!)

85

.setTimestamp()] });

86

87

} catch {}

console.log(`Stipendio

pagato a ${acc.user_id}

(guild: ${acc.guild_id})`);

}

88

89

}

90

63

91

64

65

66

.addUser0ption(o =>

const commands = [

new

SlashCommandBuilder().setName( "balance").setDescription("Con trolla il tuo saldo")

o.setName("user").setDescripti on("Utente da controllare")),

new0ption(o =>

.addIntegerOption(o

.addInteger0ption(o =>

SlashCommandBuilder().setName( "daily").setDescription("Ritir a il premio giornaliero (24h cooldown)"),

new

SlashCommandBuilder().setName( "work").setDescription("Lavora per guadagnare monete (1h cooldown)"),

SlashCommandBuilder().setName( "pay").setDescription("Trasfer isci monete a un utente")

o.setName("user").setDescripti on("Destinatario").setRequired (true))

o.setName("amount").setDescrip tion("Quantità").setRequired(t rue).setMinValue(1)),

new

SlashCommandBuilder().setName( "gamble").setDescription("Scom metti le tue monete (50/50)")

o.setName("amount").setDescrip tion("Quantità").setRequired(t rue).setMinValue(1)),

new

SlashCommandBuilder().setName( "leaderboard").setDescription.addUser0ption(o =>

.addIntegerOption(o

.addInteger0ption(o =>

SlashCommandBuilder().setName( "daily").setDescription("Ritir a il premio giornaliero (24h cooldown)"),

new

SlashCommandBuilder().setName( "work").setDescription("Lavora per guadagnare monete (1h cooldown)"),

SlashCommandBuilder().setName( "pay").setDescription("Trasfer isci monete a un utente")

o.setName("user").setDescripti on("Destinatario").setRequired (true))

o.setName("amount").setDescrip tion("Quantità").setRequired(t rue).setMinValue(1)),

new

SlashCommandBuilder().setName( "gamble").setDescription("Scom metti le tue monete (50/50)")

o.setName("amount").setDescrip tion("Quantità").setRequired(t rue).setMinValue(1)),

new

SlashCommandBuilder().setName( "leaderboard").setDescriptionnew

SlashCommandBuilder().setName( "shop").setDescription("Sfogli a il negozio"),

new

SlashCommandBuilder().setName( "buy").setDescription("Acquist

a un oggetto")

.addString0ption(o => o.setName("item").setDescripti on("Nome

oggetto").setRequired(true)),

new

SlashCommandBuilder().setName( "inventory").setDescription("V isualizza il tuo inventario"),

new SlashCommandBuilder() setName("apriconto")

setDescription("Apri un conto bancario per ricevere lo stipendio mensile"),

95

96

97

.setName("creapin")

98

99

new SlashCommandBuilder()

.setDescription("Crea il PIN del tuo conto bancario (4 cifre)")

.addInteger0ption(o => o.setName("pin").setDescriptio n("Il tuo PIN a 4 cifre").setRequired(true).setM inValue(1000).setMaxValue(9999new SlashCommandBuilder()

.setName("modificapin")

.setDescription("Modifica

105

il PIN del tuo conto bancario")

.addInteger0ption(o => o.setName("vecchiopin").setDes cription("Il PIN attuale").setRequired(true).se tMinValue(1000).setMaxValue(99

99))

.addInteger0ption(o => o.setName("nuovopin").setDescr iption("Il nuovo PIN a 4 cifre").setRequired(true).setM inValue(1000).setMaxValue(9999 )),

106

107

108

109

110

111

.setName("paga")

new SlashCommandBuilder()

.setDescription("Paga un utente con soldi dal tuo conto bancario")

.addUser0ption(o =>

o.setName("utente").setDescrip tion("Chi vuoi

pagare").setRequired(true))

.addInteger0ption(o => o.setName("importo").setDescri ption("Quanti euro inviare").setRequired(true).se tMinValue(1))118

119

120

121

Diff: index.js

.addUser0ption(o =>

.addInteger0ption(o =>

.addString0ption(o => o.setName("motivo").setDescrip tion("Motivo del

pagamento").setRequired(true))

.addInteger0ption(o => o.setName("pin").setDescriptio n("Il tuo PIN per confermare").setRequired(true) .setMinValue(1000).setMaxValue (9999)),

new SlashCommandBuilder() .setName("sequestra") .setDescription("[SOLO STAFF] Sequestra soldi da un

utente")

o.setName("utente").setDescrip tion("Utente a cui sequestrare i soldi").setRequired(true))

o.setName("importo").setDescri ption("Importo da

sequestrare"). setRequired(true

).setMinValue(1))

.addString0ption(o =>

o.setName("motivo").setDescrip tion("Motivo del

sequestro").setRequired(false) ),

122

new SlashCommandBuilder()setName("saldo")

.setDescription("Controlla

126

78

125

il saldo del tuo conto bancario"),

];

79

80

81

82

83

84

const WORK_MSGS = [

"Hai risolto un bug critico e guadagnato", "Hai consegnato pizze e preso",

"Hai vinto un torneo di scacchi e intascato", "Hai dato ripetizioni e guadagnato"

"Hai fatto una live e ricevuto donazioni per", "Hai riparato il Wi-Fi di qualcuno e preso",

];

85

86

127

87

88

89

90

91

92

async function

handleCommand(interaction) {

const { commandName, user,

guildId } = interaction;

await

interaction.deferReply();

if (commandName ===

"balance") {

const target =

interaction.options.getUser("u

ser") ?? user;

const wgetWallet(target.id, guildId);

93

return

interaction.editReply({

embeds: [new

EmbedBuilder().setColor(0xf5a6 23)

94

.setTitle(`Portafoglio

di

${target.displayName}).setThu mbnail(target.displayAvatarURL ())

95

.addFields({ name:

"Saldo", value:

coins(w.balance), inline: true

}).setTimestamp()] });

96

97

98

{

99

100

101

102

}

if (commandName === "daily")

const w = await

if (w.last_daily) {

getWallet(user.id, guildId);

const left = 86400000 - (Date.now() - new

Date(w.last_daily).getTime()); if (left > 0) return

interaction.editReply({

embeds: [new EmbedBuilder().setColor(0xe74c 3c)

.setTitle(" Già

103

riscattato").setDescription(`Torna tra

**${timeLeft(left)}**.`)] });

const { commandName, user, guildId, member } =

interaction;

const ephemeral = ["creapin", "modificapin", "paga"].includes(commandName);

interaction.deferReply({ ephemeral });

(commandName ===

131

132

if

133

134

135

104

136

105

106

107

"apriconto") {

const existing = await getAccount(user.id, guildId);

if (existing) {

return

interaction.editReply({

embeds: [err("Hai già un conto

bancario aperto!")] });

}

const reward

Math.floor(Math.random() *

301) + 200;

await query("UPDATE

wallets SET

balance=balance+$1,last_daily=

NOW() WHERE user_id=$2 AND guild_id=$3", [reward,

user.id, guildId]);

const nb = w.balancereward;

108

return

109

110

.setTitle(" Premio

.addFields({ name:

71)

interaction.editReply({

embeds: [new

EmbedBuilder().setColor(Ox2ecc

Giornaliero!").setDescription( `Hai ricevuto

${coins(reward)}!`)

"Nuovo Saldo", value: coins(nb), inline: true }).setTimestamp()] });

}

111

112

113

if (commandName === "work")

114

const w = await

115

116

117

{

getWallet(user.id, guildId); if (w.last_work) { const left = 3600000 -

(Date.now() - new

Date(w.last_work).getTime()); if (left > 0) return interaction.editReply({ embeds: [new

EmbedBuilder().setColor(0xe74c 3c)

118

.setTitle(" Ancora

al

Lavoro").setDescription(`Ripos${timeLeft(left)}**.`)] }); }

const earned =

const msg =

return

124

125

126

127

128

129

Math.floor(Math.random() *

151) + 50;

WORK_MSGS[Math.floor(Math.rand

om() * WORK_MSGS.length)];

await query("UPDATE wallets SET balance=balance+$1,last_work=N OW() WHERE user_id=$2 AND guild_id=$3", [earned,

user.id, guildId]);

interaction.editReply({ embeds: [new EmbedBuilder().setColor(Ox3498

db)

.setTitle(" Lavoro Completato!").setDescription( ${msg} ${coins(earned)}!)

.addFields({ name:

"Nuovo Saldo", value:

coins(w.balance + earned),

inline: true

}).setTimestamp()] });

}

if (commandName === "pay") {

const target

interaction.options.getUser("u ser", true);

const amount = interaction.options.getInteger

("amount", true);

"INSERT INTO bank_accounts(user_id, guild_id, balance) VALUES($1,

$2, 0)",

[user.id, guildId]

139

140

);

141

return

interaction.editReply({

embeds: [new

EmbedBuilder().setColor(0x2ecc 71)

142

.setTitle(" Conto

143

Bancario Aperto!")

.setDescription(`Benvenuto ${user}! Il tuo conto bancario è stato aperto con

successo.\n\n> Usa

**/creapin** per impostare il

tuo PIN e iniziare a ricevere

lo stipendio mensile di

${euros (STIPENDIO)}!)

.setTimes...

144

145

131

146

132

[truncated]

[truncated]

[truncated]
