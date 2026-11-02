const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const OpenAI = require('openai');
const { Api } = require("telegram"); // Добавили для чтения описания канала

const apiId = 34226265; 
const apiHash = "77ca868d4f2d9d886361b19a56ab57f4"; 
const supabaseUrl = 'https://wjrnzvqfxgmlppdzidtf.supabase.co';
const supabaseKey = 'sb_publishable_WYXYrZAVnjNFUQXh8hwqvA_yE-4TLB9';
const supabase = createClient(supabaseUrl, supabaseKey);

const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY 
});

const stringSession = new StringSession(process.env.TELEGRAM_SESSION || ""); 

// Обновленная функция работы с ИИ
async function extractWithAI(postText, channelDescription) {
    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Ты умный парсер товаров. Твоя задача — извлечь артикул, цену и адрес.
                    
                    ВАЖНО:
                    1. Артикул ищи в ТЕКСТЕ поста. Производители пишут по-разному: "Артикул", "Арт", "Мод", "Модель", "#", просто цифры или буквы с цифрами. Игнорируй размеры (S, M, L, 42, 44) и объемы. 
                    2. Цену ищи в ТЕКСТЕ поста. Если несколько цен — бери минимальную.
                    3. Адрес ищи в ОПИСАНИИ КАНАЛА (например, "7 км", "Голуба 2054", "Ряд 5, место 10"). Если в описании нет, посмотри в тексте поста. Если нигде нет — напиши "Не указан".
                    
                    Верни ТОЛЬКО JSON строго в формате: {"article": "...", "price": "...", "address": "..."}` 
                },
                { 
                    role: "user", 
                    content: `ОПИСАНИЕ КАНАЛА:\n${channelDescription}\n\nТЕКСТ ПОСТА:\n${postText}` 
                }
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
    console.log("✅ Подключились! Начинаем умный сбор...");

    let channels = [];
    try {
        channels = fs.readFileSync('channels.txt', 'utf8').split('\n').map(c => c.trim()).filter(c => c);
    } catch (err) {
        console.error("Ошибка чтения channels.txt:", err.message);
        process.exit(1);
    }

    for (const channel of channels) {
        let cleanChannel = channel.replace('https://t.me/', '').replace('@', '');
        console.log(`Читаем канал: ${cleanChannel}`);
        
        let channelAbout = ""; // Здесь будет храниться описание канала
        let channelTitle = cleanChannel;

        try {
            // Получаем полную информацию о канале (включая описание)
            const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: channel }));
            channelAbout = fullChannel.fullChat.about || "";
            channelTitle = fullChannel.chats[0].title || cleanChannel;
            
            const messages = await client.getMessages(channel, { limit: 100 });
            
            for (const msg of messages) {
                if (!msg.text || msg.text.length < 15) continue; 
                
                // Передаем ИИ и текст поста, и описание канала
                const extractedData = await extractWithAI(msg.text, channelAbout);
                
                if (!extractedData || !extractedData.article) continue; 
                
                const article = extractedData.article.toString().trim();
                if (article === '-' || article === '' || article.length > 15) continue; // Защита от мусора

                const price = extractedData.price || 'Не указана';
                const address = extractedData.address || channelTitle; // Если ИИ не нашел, берем название

                const link = `https://t.me/${cleanChannel}/${msg.id}`;

                // Проверка дублей
                const { data: existing } = await supabase.from('products').select('id')
                    .eq('article', article)
                    .eq('channel_name', channelTitle);

                if (existing && existing.length > 0) {
                    continue; 
                }

                const { error } = await supabase.from('products').insert([{
                    article,
                    price,
                    address,
                    link,
                    channel_name: channelTitle
                }]);

                if (error) {
                    console.error(`Ошибка сохранения ${article}:`, error.message);
                } else {
                    console.log(`Сохранено: ${article} | ${price} | ${address} | ${channelTitle}`);
                }
                
                await new Promise(r => setTimeout(r, 1000)); // Пауза для ИИ
            }
        } catch (err) {
            console.log(`Ошибка доступа к каналу ${cleanChannel}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 3000)); 
    }

    await client.disconnect();
    process.exit(0);
}

startParsing();
