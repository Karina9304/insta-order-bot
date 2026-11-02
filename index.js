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
            // Увеличиваем лимит до 100 (максимум для одного запроса API)
            const messages = await client.getMessages(channel, { limit: 100 });
            
            for (const msg of messages) {
                if (!msg.text) continue;
                
                // Улучшенный поиск артикула (добавили "Номер" и точку)
                const articleMatch = msg.text.match(/(?:Артикул|Арт|Код|Модель|Мод|В|#|Номер)[\s:\.]*([A-Za-z0-9\/\-]+)/i);
                if (!articleMatch) continue;
                const article = articleMatch[1];

                // Если артикул пустой или это просто дефис - пропускаем
                if (article === '-' || article === '') continue;

                const priceMatch = msg.text.match(/(\d+[\s\d]*)\s*(грн|гр|₴|uah|\$|usd|дол)/i);
                const price = priceMatch ? priceMatch[1].trim() + (priceMatch[2].includes('$') || priceMatch[2].toLowerCase() === 'usd' || priceMatch[2].toLowerCase().includes('дол') ? '$' : ' грн') : 'Не указана';

                // ПРАВИЛЬНОЕ формирование ссылки
                let cleanChannel = channel.replace('https://t.me/', '').replace('@', '');
                let link = msg.chat.username ? `https://t.me/${msg.chat.username}/${msg.id}` : `https://t.me/c/${msg.chat.id.toString().replace('-100', '')}/${msg.id}`;
                
                // Получаем нормальное имя канала
                const channelName = msg.chat.title || cleanChannel;

                // ПРОВЕРКА ДУБЛИКАТОВ: ищем по артикулу И названию канала
                const { data: existing } = await supabase.from('products').select('id')
                    .eq('article', article)
                    .eq('channel_name', channelName);

                if (existing && existing.length > 0) {
                    continue; // Уже есть такой товар в этом канале - пропускаем
                }

                const { error } = await supabase.from('products').insert([{
                    article,
                    price,
                    address: channelName, // Берем адрес из названия канала
                    link,
                    channel_name: channelName
                }]);

                if (error) {
                    console.error(`Ошибка сохранения ${article}:`, error.message);
                } else {
                    console.log(`Сохранено: ${article} | ${price} | ${channelName}`);
                }
            }
        } catch (err) {
            console.log(`Ошибка доступа к каналу ${channel}`);
        }
        // Пауза 5 секунд
        await new Promise(r => setTimeout(r, 5000)); 
    }

    await client.disconnect();
    process.exit(0);
}

startParsing();
