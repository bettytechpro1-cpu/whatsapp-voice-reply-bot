const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const express = require("express");
const QRCode = require("qrcode");
const googleTTS = require("google-tts-api");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
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
// CREATE WHATSAPP VOICE NOTE
// ===============================

async function createVoice(text) {

  const mp3File =
    "/tmp/reply.mp3";

  const oggFile =
    "/tmp/reply.ogg";


  try {

    console.log(
      "Creating voice audio..."
    );


    // Get Google TTS audio URL
    const url =
      googleTTS.getAudioUrl(
        text,
        {
          lang: "en",
          slow: false,
          host: "https://translate.google.com"
        }
      );


    // Download MP3
    const response =
      await axios.get(
        url,
        {
          responseType: "arraybuffer"
        }
      );


    fs.writeFileSync(
      mp3File,
      response.data
    );


    console.log(
      "MP3 audio created."
    );


    // Convert MP3 → OGG/Opus
    await new Promise(
      (resolve, reject) => {

        ffmpeg(mp3File)

          .audioCodec("libopus")

          .audioChannels(1)

          .audioFrequency(48000)

          .format("ogg")

          .on(
            "end",
            resolve
          )

          .on(
            "error",
            reject
          )

          .save(oggFile);

      }
    );


    console.log(
      "OGG/Opus voice note created."
    );


    return oggFile;

  } catch (error) {

    console.log(
      "Voice creation error:",
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


      // Ignore messages sent by bot
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
      // REPLY TEXT
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

        console.log(
          "Could not create voice file."
        );

        return;

      }


      // =============================
      // SEND WHATSAPP VOICE NOTE
      // =============================

      try {

        console.log(
          "Sending voice note..."
        );


        await sock.sendMessage(
          remoteJid,
          {
            audio:
              fs.readFileSync(
                voiceFile
              ),

            mimetype:
              "audio/ogg; codecs=opus",

            ptt: true
          }
        );


        console.log(
          "Voice reply sent successfully."
        );


      } catch (error) {

        console.log(
          "Send voice error:",
          error.message
        );

      }


      // Remove temporary files
      try {

        fs.unlinkSync(
          voiceFile
        );

      } catch (error) {}

      try {

        fs.unlinkSync(
          "/tmp/reply.mp3"
        );

      } catch (error) {}

    }
  );

}


// ===============================
// START BOT
// ===============================

startBot();
