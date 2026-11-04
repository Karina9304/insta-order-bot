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

const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY 
});

const stringSession = new StringSession(process.env.TELEGRAM_SESSION || ""); 

async function extractWithAI(postText, channelDescription) {
    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Ты — эксперт-детектив по парсингу Telegram-каналов. Найди в тексте АРТИКУЛ (модель) и ЦЕНУ.

ПРАВИЛА ПОИСКА АРТИКУЛА:
1. Ищи цифры после слов: «Артикул», «Арт», «Мод», «Модель», «Код», «Номер», «В».
2. Обращай внимание на символы: «#», «№». Если видишь «№2640» или «# 2640» — артикул «2640».
3. Без слов: Если в начале поста или рядом с названием стоит просто набор цифр (например, «Платье 4567»), считай это артикулом.
4. Артикул может содержать цифры и английские буквы (например, «A-123»). Не бери размеры (S, M, L, 42, 44).

ПРАВИЛА ПОИСКА ЦЕНЫ:
1. Ищи число рядом с «грн», «гр», «₴», «$», «usd», «дол».
2. Если цен несколько, бери ту, что указана за товар.

ПРИМЕРЫ:
- "Платье. Мод. 1234. Цена 1500 грн" -> {"article": "1234", "price": "1500 грн"}
- "Костюм #5678. 25$" -> {"article": "5678", "price": "25$"}
- "Жакет №2640. 37$" -> {"article": "2640", "price": "37$"}
- "Джемпер 890. Размеры 42-44. 800 грн" -> {"article": "890", "price": "800 грн"}

Верни ТОЛЬКО JSON: {"article": "...", "price": "...", "address": "..."}. Если артикула нет — верни пустую строку.` 
                },
                { role: "user", content: `ОПИСАНИЕ КАНАЛА:\n${channelDescription}\n\nТЕКСТ ПОСТА:\n${postText}` }
            ],
            model: "deepseek-chat",
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        return null;
    }
}

async function startParsing() {
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    console.log("✅ Подключились! Начинаем глубокий сбор...");

    let channels = [];
    try {
        channels = fs.readFileSync('channels.txt', 'utf8').split('\n').map(c => c.trim()).filter(c => c);
    } catch (err) { process.exit(1); }

    for (const channel of channels) {
        let cleanChannel = channel.replace('https://t.me/', '').replace('@', '');
        console.log(`Читаем канал: ${cleanChannel}`);
        
        let channelAbout = ""; 
        let channelTitle = cleanChannel;

        try {
            const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel: channel }));
            channelAbout = fullChannel.fullChat.about || "";
            channelTitle = fullChannel.chats[0].title || cleanChannel;
            
            // УВЕЛИЧИЛИ ЛИМИТ ДО 200 ПОСТОВ
            const messages = await client.getMessages(channel, { limit: 200 });
            
            for (const msg of messages) {
                if (!msg.text || msg.text.length < 15) continue; 
                
                // Проверяем дубли по ссылке перед отправкой в ИИ (экономия)
                const link = `https://t.me/${cleanChannel}/${msg.id}`;
                const { data: existing } = await supabase.from('products').select('id').eq('link', link);
                if (existing && existing.length > 0) continue; 

                const extractedData = await extractWithAI(msg.text, channelAbout);
                
                if (!extractedData || !extractedData.article) continue; 
                
                const article = extractedData.article.toString().trim();
                if (article === '-' || article === '' || article.length > 15) continue;

                const price = extractedData.price || 'Не указана';
                const address = extractedData.address || channelTitle;

                const { error } = await supabase.from('products').insert([{
                    article, price, address, link, channel_name: channelTitle
                }]);

                if (!error) {
                    console.log(`Сохранено: ${article} | ${price} | ${address}`);
                }
                await new Promise(r => setTimeout(r, 1000)); 
            }
        } catch (err) {
            console.log(`Ошибка доступа к каналу ${cleanChannel}`);
        }
        await new Promise(r => setTimeout(r, 3000)); 
    }
    await client.disconnect();
    process.exit(0);
}
startParsing();
