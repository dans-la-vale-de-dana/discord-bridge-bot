// Bot Discord <-> FileDrop
// Relaye les messages entre un salon Discord et le chat du site FileDrop,
// via une table Supabase partagée ("bridge_messages").
//
// Inclut un mini serveur web (juste pour répondre "OK") car l'hébergement
// gratuit (Render Web Service) exige un port HTTP ouvert pour rester actif ;
// un service externe (UptimeRobot) vient ensuite le "réveiller" régulièrement.

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

// ---- Configuration (variables d'environnement, voir .env.example) ----
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // clé secrète, jamais publique
const PORT = process.env.PORT || 3000;

if (!DISCORD_TOKEN || !DISCORD_CHANNEL_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Variables d\'environnement manquantes. Vérifie DISCORD_TOKEN, DISCORD_CHANNEL_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

// ---- Mini serveur HTTP : juste pour que Render considère le service "actif" ----
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('FileDrop <-> Discord bridge : en ligne ✅');
}).listen(PORT, () => {
  console.log(`🌐 Serveur de health-check actif sur le port ${PORT}`);
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot connecté en tant que ${c.user.tag}`);
  listenToFileDropMessages();
});

// ---- Discord -> Supabase (donc -> FileDrop) ----
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== DISCORD_CHANNEL_ID) return;

  const { error } = await supabase.from('bridge_messages').insert({
    source: 'discord',
    author: message.author.username,
    text: message.content || '(message sans texte, ex: image/fichier)'
  });

  if (error) console.error('Erreur insertion Supabase :', error.message);
});

// ---- Supabase (donc FileDrop) -> Discord ----
function listenToFileDropMessages() {
  supabase
    .channel('bridge_messages_to_discord')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bridge_messages', filter: 'source=eq.filedrop' },
      async (payload) => {
        const row = payload.new;
        try {
          const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
          await channel.send(`**${row.author} (FileDrop) :** ${row.text}`);
        } catch (e) {
          console.error('Erreur envoi Discord :', e.message);
        }
      }
    )
    .subscribe((status) => {
      console.log('Abonnement temps réel Supabase :', status);
    });
}

client.login(DISCORD_TOKEN);
