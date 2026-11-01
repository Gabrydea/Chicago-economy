
import os
import discord
from discord.ext import commands, tasks
from datetime import time
from zoneinfo import ZoneInfo

TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = 1521213406609281024
CHANNEL_ID = 1529063190573617172

QUESTION = "𝐒𝖺𝗋𝖺𝗂 𝐒𝗍𝖺𝗌𝖾𝗋𝖺 𝐈𝗇 𝐑𝗉 𝐀𝗅𝗅𝖾 21🫧 ? ᝰ.ᐟ"

intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!", intents=intents)

@tasks.loop(time=time(hour=14, minute=0, tzinfo=ZoneInfo("Europe/Rome")))
async def daily_poll():
    channel = bot.get_channel(CHANNEL_ID)

    if channel is None:
        channel = await bot.fetch_channel(CHANNEL_ID)

    if channel.guild.id != GUILD_ID:
        print("Errore: server non corretto.")
        return

    poll = discord.Poll(
        question=QUESTION,
        duration=24,
        multiple=False
    )

    poll.add_answer(text="sɪ ࣪ ˖❄️")
    poll.add_answer(text="ɴᴏ ࣪ ˖⛄")

    await channel.send(poll=poll)

@bot.event
async def on_ready():
    print(f"Bot online: {bot.user}")
    if not daily_poll.is_running():
        daily_poll.start()

if not TOKEN:
    raise RuntimeError("Token mancante!")

bot.run(TOKEN)
