const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');

// -------------------------------------------------------------
// 1. قائمة الأدمنز (أضف أرقامك هنا بالصيغة الدولية)
// -------------------------------------------------------------
const ADMIN_NUMBERS = [
  "9647700000000@s.whatsapp.net", // استبدل هذا برقمك
  // "9647800000000@s.whatsapp.net" // يمكنك إضافة أرقام أخرى هنا
];

// -------------------------------------------------------------
// 2. خادم HTTP (مطلوب لخدمة Render لإبقاء البوت يعمل 24/7)
// -------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('بوت الواجبات المدرسية يعمل بنجاح 24/7!');
});

app.listen(PORT, () => {
  console.log(`[HTTP Server] Listening on port ${PORT}`);
});

// -------------------------------------------------------------
// 3. إدارة حفظ واسترجاع الواجبات
// -------------------------------------------------------------
const HOMEWORK_FILE = './homework.json';

function loadHomework() {
  if (fs.existsSync(HOMEWORK_FILE)) {
    try {
      const data = fs.readFileSync(HOMEWORK_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error('Error loading homework file:', e);
    }
  }
  return null;
}

function saveHomework(data) {
  fs.writeFileSync(HOMEWORK_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function formatHomeworkMessage(hwData) {
  if (!hwData) {
    return 'لم يتم تسجيل أي واجبات بعد.';
  }

  return `واجبات يوم *${hwData.day || 'N/A'}*
----------------
عربي: *${hwData.arabic || 'N/A'}*
رياضيات: *${hwData.math || 'N/A'}*
كيمياء: *${hwData.chemistry || 'N/A'}*
فيزياء: *${hwData.physics || 'N/A'}*
انجليزي: *${hwData.english || 'N/A'}*
اسلامية: *${hwData.islamic || 'N/A'}*
احياء: *${hwData.biology || 'N/A'}*`;
}

// -------------------------------------------------------------
// 4. تشغيل بوت الواتساب
// -------------------------------------------------------------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      console.log('تم اتصال البوت بنجاح!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      const senderJid = msg.key.participant || remoteJid; // يدعم المجموعات والمحادثات الخاصة

      const textMessage =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      const incomingText = textMessage.trim();

      // -----------------------------------------------------------
      // أمر إدخال الواجبات (خاص بالأدمن فقط)
      // -----------------------------------------------------------
      if (incomingText.startsWith('!اضافة_واجب') || incomingText.startsWith('!add_hw')) {
        // التحقق من صلاحيات الأدمن
        const isAdmin = ADMIN_NUMBERS.some(admin => senderJid.includes(admin.replace('@s.whatsapp.net', '')));
        
        if (!isAdmin) {
          await sock.sendMessage(remoteJid, { text: '❌ هذا الأمر مخصص للأدمن فقط.' });
          continue;
        }

        // تحليل النص المكتوب
        // الصيغة المطلوب إرسالها من الأدمن:
        // !اضافة_واجب
        // اليوم: الأحد
        // عربي: ص 12
        // رياضيات: تمارين 1-3
        // كيمياء: تحضير ص 45
        
        const lines = incomingText.split('\n');
        const hwData = {
          day: 'N/A',
          arabic: 'N/A',
          math: 'N/A',
          chemistry: 'N/A',
          physics: 'N/A',
          english: 'N/A',
          islamic: 'N/A',
          biology: 'N/A'
        };

        lines.forEach(line => {
          const lowerLine = line.trim();
          if (lowerLine.includes('اليوم:')) hwData.day = line.split('اليوم:')[1]?.trim() || 'N/A';
          else if (lowerLine.includes('عربي:')) hwData.arabic = line.split('عربي:')[1]?.trim() || 'N/A';
          else if (lowerLine.includes('رياضيات:')) hwData.math = line.split('رياضيات:')[1]?.trim() || 'N/A';
          else if (lowerLine.includes('كيمياء:')) hwData.chemistry = line.split('كيمياء:')[1]?.trim() || 'N/A';
          else if (lowerLine.includes('فيزياء:')) hwData.physics = line.split('فيزياء:')[1]?.trim() || 'N/A';
          else if (lowerLine.includes('انجليزي:')) hwData.english = line.split('انجليزي:')[1]?.trim() || 'N/A';
          else if (lowerLine.includes('اسلامية:')) hwData.islamic = line.split('اسلامية:')[1]?.trim() || 'N/A';
          else if (lowerLine.includes('احياء:')) hwData.biology = line.split('احياء:')[1]?.trim() || 'N/A';
        });

        saveHomework(hwData);
        
        const formattedMsg = formatHomeworkMessage(hwData);
        await sock.sendMessage(remoteJid, { 
          text: `✅ تم حفظ الواجب بنجاح!\n\n${formattedMsg}` 
        });
      }

      // -----------------------------------------------------------
      // أمر عرض الواجبات (متاح للجميع)
      // -----------------------------------------------------------
      else if (incomingText === '!واجبات' || incomingText === '!الواجبات' || incomingText.toLowerCase() === 'homework') {
        const currentHw = loadHomework();
        const formattedMsg = formatHomeworkMessage(currentHw);
        await sock.sendMessage(remoteJid, { text: formattedMsg });
      }

      // -----------------------------------------------------------
      // أمر المساعدة
      // -----------------------------------------------------------
      else if (incomingText === '!مساعدة' || incomingText === '!help') {
        const helpText = `🤖 *تعليمات بوت الواجبات*\n\n` +
          `• اكتب *!واجبات* لعرض الواجبات الحالية.\n\n` +
          `*للأدمن فقط:*
لإضافة أو تعديل الواجبات، أرسل الرسالة بالشكل التالي:\n\n` +
          `!اضافة_واجب\n` +
          `اليوم: الأحد\n` +
          `عربي: حل تمارين ص 15\n` +
          `رياضيات: ص 20\n` +
          `كيمياء: \n` +
          `فيزياء: \n` +
          `انجليزي: \n` +
          `اسلامية: \n` +
          `احياء: \n\n` +
          `*(أي مادة تتركها فارغة ستظهر تلقائياً N/A)*`;
        
        await sock.sendMessage(remoteJid, { text: helpText });
      }
    }
  });
}

startBot();