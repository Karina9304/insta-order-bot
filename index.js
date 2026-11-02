const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const apiId = 34226265; 
const apiHash = "77ca868d4f2d9d886361b19a56ab57f4"; 
const supabaseUrl = 'https://wjrnzvqfxgmlppdzidtf.supabase.co';
const supabaseKey = 'sb_publishable_WYXYrZAVnjNFUQXh8hwqvA_yE-4TLB9';
const supabase = createClient(supabaseUrl, supabaseKey);

const stringSession = new StringSession(process.env.TELEGRAM_SESSION || ""); 

async function startParsing() {
    console.log("Подключение к Telegram...");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.connect();
    console.log("✅ Подключились! Начинаем сбор...");

    let channels = [];
    try {
        channels = fs.readFileSync('channels.txt', 'utf8').split('\n').map(c => c.trim()).filter(c => c);
    } catch (err) {
        console.error("Ошибка чтения channels.txt:", err.message);
        process.exit(1);
    }

    for (const channel of channels) {
        console.log(`Читаем канал: ${channel}`);
        try {
            // БЕРЕМ 50 ПОСТОВ ВМЕСТО 10
            const messages = await client.getMessages(channel, { limit: 50 });
            for (const msg of messages) {
                if (!msg.text) continue;
                
                const articleMatch = msg.text.match(/(?:Артикул|Арт|Код|Модель|Мод|В|#)[\s:]*([A-Za-z0-9\/\-]+)/i);
                if (!articleMatch) continue;
                const article = articleMatch[1];

                const priceMatch = msg.text.match(/(\d+[\s\d]*)\s*(грн|гр|₴|uah|\$|usd|дол)/i);
                const price = priceMatch ? priceMatch[1].trim() + (priceMatch[2].includes('$') || priceMatch[2].toLowerCase() === 'usd' || priceMatch[2].toLowerCase().includes('дол') ? '$' : ' грн') : 'Не указана';

                const link = `https://t.me/${channel.replace('@','')}/${msg.id}`;
                
                const { data: existing } = await supabase.from('products').select('id').eq('link', link);
                if (existing && existing.length > 0) {
                    continue; // Пропускаем без вывода в консоль, чтобы не засорять логи
                }

                const { error } = await supabase.from('products').insert([{
                    article,
                    price,
                    address: 'См. канал',
                    link,
                    channel_name: channel
                }]);

                if (error) {
                    console.error(`Ошибка сохранения артикула ${article}:`, error.message);
                } else {
                    console.log(`Сохранено в базу: ${article} | ${price}`);
                }
            }
        } catch (err) {
            console.log(`Ошибка доступа к каналу ${channel}`);
        }
        // Пауза 5 секунд перед следующим каналом
        await new Promise(r => setTimeout(r, 5000)); 
    }

    await client.disconnect();
    process.exit(0);
}

startParsing();
