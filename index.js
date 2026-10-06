const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const express = require("express");
const QRCode = require("qrcode");
const googleTTS = require("google-tts-api");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

let sock;
let currentQR = null;
let status = "Starting";


// ===============================
// WEB PAGE
// ===============================

app.get("/", async (req, res) => {

  if (currentQR) {

    const qrImage =
      await QRCode.toDataURL(currentQR);

    return res.send(`
      <!DOCTYPE html>
      <html>

      <head>
        <title>WhatsApp Voice Reply Bot</title>
        <meta name="viewport"
              content="width=device-width, initial-scale=1">
      </head>

      <body style="
        font-family:Arial;
        text-align:center;
        padding:40px;
      ">

        <h1>WhatsApp Voice Reply Bot</h1>

        <p>Scan the QR code with WhatsApp</p>

        <img
          src="${qrImage}"
          style="max-width:300px"
        >

        <p>
          WhatsApp → Linked Devices → Link a Device
        </p>

      </body>

      </html>
    `);
  }


  res.send(`
    <html>

    <head>
      <meta http-equiv="refresh" content="5">
    </head>

    <body style="
      font-family:Arial;
      text-align:center;
      padding:50px;
    ">

      <h1>WhatsApp Voice Reply Bot</h1>

      <h2>Status: ${status}</h2>

      <p>
        Waiting for WhatsApp connection...
      </p>

    </body>

    </html>
  `);

});


// ===============================
// STATUS
// ===============================

app.get("/status", (req, res) => {

  res.json({
    bot: "WhatsApp Voice Reply Bot",
    status: status
  });

});


// ===============================
// WEB SERVER
// ===============================

app.listen(PORT, () => {

  console.log(
    `Web server running on port ${PORT}`
  );

});


// ===============================
// TEXT → VOICE
// ===============================

async function createVoice(text) {

  try {

    const url =
      googleTTS.getAudioUrl(
        text,
        {
          lang: "en",
          slow: false,
          host: "https://translate.google.com"
        }
      );

    const response =
      await axios.get(
        url,
        {
          responseType: "arraybuffer"
        }
      );

    const filePath =
      "/tmp/reply.mp3";

    fs.writeFileSync(
      filePath,
      response.data
    );

    return filePath;

  } catch (error) {

    console.log(
      "Voice generation error:",
      error.message
    );

    return null;

  }

}


// ===============================
// WHATSAPP BOT
// ===============================

async function startBot() {

  const {
    state,
    saveCreds
  } =
    await useMultiFileAuthState(
      "/app/auth_info"
    );


  sock =
    makeWASocket({

      auth: state,

      printQRInTerminal: false

    });


  // Save WhatsApp login
  sock.ev.on(
    "creds.update",
    saveCreds
  );


  // Connection status
  sock.ev.on(
    "connection.update",
    ({
      connection,
      lastDisconnect,
      qr
    }) => {


      if (qr) {

        currentQR = qr;

        status =
          "Waiting for QR scan";

        console.log(
          "New QR code generated."
        );

      }


      if (connection === "open") {

        currentQR = null;

        status = "Online";

        console.log(
          "WhatsApp Voice Reply Bot is online!"
        );

      }


      if (connection === "close") {

        status =
          "Disconnected";

        const shouldReconnect =
          lastDisconnect?.error
            ?.output?.statusCode !==
          DisconnectReason.loggedOut;


        if (shouldReconnect) {

          console.log(
            "WhatsApp disconnected. Reconnecting..."
          );

          setTimeout(
            startBot,
            3000
          );

        }

      }

    }
  );


  // =============================
  // RECEIVE MESSAGES
  // =============================

  sock.ev.on(
    "messages.upsert",
    async ({ messages }) => {

      const message =
        messages[0];


      if (!message) {
        return;
      }


      // Ignore messages sent by the bot
      if (message.key.fromMe) {
        return;
      }


      const remoteJid =
        message.key.remoteJid;


      // Ignore WhatsApp status
      if (
        remoteJid ===
        "status@broadcast"
      ) {
        return;
      }


      // Get incoming text
      const text =
        message.message
          ?.conversation ||
        message.message
          ?.extendedTextMessage
          ?.text;


      if (!text) {
        return;
      }


      console.log(
        `Message received: ${text}`
      );


      // =============================
      // CREATE REPLY
      // =============================

      const replyText =
        "Hello! Thanks for your message. " +
        "How can I help you today?";


      // =============================
      // CREATE VOICE
      // =============================

      const voiceFile =
        await createVoice(
          replyText
        );


      if (!voiceFile) {

        return;

      }


      // =============================
      // SEND VOICE MESSAGE
      // =============================

      try {

        await sock.sendMessage(
          remoteJid,
          {
            audio:
              fs.readFileSync(
                voiceFile
              ),

            mimetype:
              "audio/mpeg",

            ptt: true
          }
        );


        console.log(
          "Voice reply sent."
        );


      } catch (error) {

        console.log(
          "Send voice error:",
          error.message
        );

      }


      // Remove temporary file
      try {

        fs.unlinkSync(
          voiceFile
        );

      } catch (error) {}

    }
  );

}


// ===============================
// START
// ===============================

startBot();
