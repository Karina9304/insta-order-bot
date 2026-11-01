const express = require('express');
const { OpenAI } = require('openai');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Настраиваем DeepSeek
const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

// 1. Проверка связи для Facebook
app.get('/instagram-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === 'my_secret_token_123') {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 2. Прием сообщений
app.post('/instagram-webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'instagram') {
      for (const entry of body.entry) {
        if (entry.messaging) {
          for (const messagingEvent of entry.messaging) {
            const senderId = messagingEvent.sender.id;

            if (messagingEvent.message && messagingEvent.message.text) {
              const incomingText = messagingEvent.message.text;
              console.log(`📩 Пришло сообщение: "${incomingText}"`);

              const completion = await deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [
                  { 
                    role: 'system', 
                    content: 'Ты — помощник в магазине женской одежды. Извлеки данные заказа: 1. Товар, 2. Размер, 3. Телефон, 4. Имя. Если данных нет, ответь строго: НЕТ_ДАННЫХ.' 
                  },
                  { role: 'user', content: incomingText }
                ],
                temperature: 0.3
              });

              const aiResponse = completion.choices[0].message.content;

              if (aiResponse && !aiResponse.includes('НЕТ_ДАННЫХ')) {
                const tgMessage = `🛍 **Новый заказ!**\n\n${aiResponse}\n\n👤 ID: \`${senderId}\``;
                
                await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
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
    }
    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
