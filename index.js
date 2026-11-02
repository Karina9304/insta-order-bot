const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const OpenAI = require('openai');

const apiId = 34226265; 
const apiHash = "77ca868d4f2d9d886361b19a56ab57f4"; 
const supabaseUrl = 'https://wjrnzvqfxgmlppdzidtf.supabase.co';
const supabaseKey = 'sb_publishable_WYXYrZAVnjNFUQXh8hwqvA_yE-4TLB9';
const supabase = createClient(supabaseUrl, supabaseKey);

// Подключаем DeepSeek
const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY // Берем из настроек Google Cloud
});

const stringSession = new StringSession(process.env.TELEGRAM_SESSION || ""); 

async function extractWithAI(text) {
    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "Ты парсер товаров. Извлеки из текста артикул (модель) и цену. Если есть несколько цен, возьми минимальную. Если цены нет, верни 'Не указана'. Верни ТОЛЬКО JSON строго в формате: {\"article\": \"...\", \"price\": \"...\"}" },
                { role: "user", content: text }
            ],
            model: "deepseek-chat",
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error("Ошибка DeepSeek:", error.message);
        return null;
    }
}

async function startParsing() {
    console.log("Подключение к Telegram...");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.connect();
    console.log("✅ Подключились! Начинаем сбор с ИИ...");

    let channels = [];
    try {
        channels = fs.readFileSync('channels.txt', 'utf8').split('\n').map(c => c.trim()).filter(c => c);
    } catch (err) {
        console.error("Ошибка чтения channels.txt:", err.message);
        process.exit(1);
    }

    for (const channel of channels) {
        // Очищаем имя канала от лишних символов
        let cleanChannel = channel.replace('https://t.me/', '').replace('@', '');
        
        console.log(`Читаем канал: ${cleanChannel}`);
        try {
            const messages = await client.getMessages(channel, { limit: 100 });
            
            for (const msg of messages) {
                if (!msg.text || msg.text.length < 20) continue; // Пропускаем пустые или слишком короткие посты
                
                // Отправляем текст в DeepSeek
                const extractedData = await extractWithAI(msg.text);
                
                if (!extractedData || !extractedData.article) continue; // Если ИИ не нашел артикул
                
                const article = extractedData.article.toString().trim();
                const price = extractedData.price || 'Не указана';

                // Идеальная ссылка
                const link = `https://t.me/${cleanChannel}/${msg.id}`;
                // Имя канала (название) 
                const channelName = msg.chat.title || cleanChannel;

                // Проверка дублей
                const { data: existing } = await supabase.from('products').select('id')
                    .eq('article', article)
                    .eq('channel_name', channelName);

                if (existing && existing.length > 0) {
                    continue; 
                }

                const { error } = await supabase.from('products').insert([{
                    article,
                    price,
                    address: channelName,
                    link,
                    channel_name: channelName
                }]);

                if (error) {
                    console.error(`Ошибка сохранения ${article}:`, error.message);
                } else {
                    console.log(`Сохранено ИИ: ${article} | ${price} | ${channelName}`);
                }
                
                // Небольшая пауза, чтобы не спамить DeepSeek
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (err) {
            console.log(`Ошибка доступа к каналу ${cleanChannel}`);
        }
        await new Promise(r => setTimeout(r, 5000)); 
    }

    await client.disconnect();
    process.exit(0);
}

startParsing();
