const express = require('express');
const { OpenAI } = require('openai');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Настраиваем DeepSeek с вашим ключом
const deepseek = new OpenAI({
  baseURL: 'https://deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

// 1. Проверка связи для Facebook (нужно один раз при подключении)
app.get('/instagram-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Кодовое слово, которое мы вставим в кабинете Facebook: my_secret_token_123
  if (mode && token === 'my_secret_token_123') {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 2. Сюда Instagram будет присылать сообщения клиентов
app.post('/instagram-webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'instagram') {
      for (const entry of body.entry) {
        if (entry.messaging && entry.messaging) {
          const messagingEvent = entry.messaging;
          const senderId = messagingEvent.sender.id;

          if (messagingEvent.message && messagingEvent.message.text) {
            const incomingText = messagingEvent.message.text;

            console.log(`📩 Пришло сообщение: "${incomingText}"`);

            // Просим DeepSeek найти данные заказа в тексте
            const completion = await deepseek.chat.completions.create({
              model: 'deepseek-chat',
              messages: [
                { 
                  role: 'system', 
                  content: 'Ты — помощник в магазине женской одежды больших размеров. Извлеки из сообщения клиента данные для заказа. Найди: 1. Что заказывают (товар/артикул), 2. Размер, 3. Номер телефона, 4. Имя. Если это просто приветствие или данных нет, ответь строго одним словом: НЕТ_ДАННЫХ. Если данные есть, напиши их красиво по пунктам.' 
                },
                { role: 'user', content: incomingText }
              ],
              temperature: 0.3
            });

            const aiResponse = completion.choices.message.content;

            // Если ИИ нашел данные, шлем в Телеграм
            if (aiResponse && !aiResponse.includes('НЕТ_ДАННЫХ')) {
              const tgMessage = `🛍 **Новый заказ из Instagram!**\n\n${aiResponse}\n\n👤 ID клиента в Insta: \`${senderId}\``;
              
              await axios.post(`https://telegram.org{process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: process.env.TELEGRAM_CHANNEL_ID,
                text: tgMessage,
                parse_mode: 'Markdown'
              });
              
              console.log('✅ Заказ отправлен в Telegram!');
            }
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('❌ Ошибка на сервере:', error.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен и слушает порт ${PORT}`));
