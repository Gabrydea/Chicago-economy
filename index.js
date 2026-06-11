const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");


const { Pool } = require("pg");


const http = require("http");





// Tiny HTTP server so Render.com non spegne il processo


const PORT = process.env.PORT || 3000;


http.createServer((req, res) => { res.writeHead(200); res.end("Bot online!"); }).listen(PORT, () => {


  console.log(`Health check server su porta ${PORT}`);


});





const token = process.env.DISCORD_BOT_TOKEN;


const dbUrl = process.env.DATABASE_URL
