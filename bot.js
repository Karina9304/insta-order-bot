const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');

const supabaseUrl = 'https://wjrnzvqfxgmlppdzidtf.supabase.co';
const supabaseKey = 'sb_publishable_WYXYrZAVnjNFUQXh8hwqvA_yE-4TLB9';
const supabase = createClient(supabaseUrl, supabaseKey);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("Ошибка: не задан TELEGRAM_BOT_TOKEN");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log("Бот запущен и слушает сообщения...");

bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || text === '/start') {
        bot.sendMessage(msg.chat.id, "Привет! Напиши артикул товара, и я найду его в базе.");
        return;
    }

    const match = text.match(/\d+/);
    if (!match) {
        bot.sendMessage(msg.chat.id, "Пожалуйста, напиши артикул (цифры).");
        return;
    }
    const article = match[0];

    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .ilike('article', `%${article}%`)
            .limit(5);

        if (error) throw error;

        if (data && data.length > 0) {
            let responseText = `🔍 Найдено по артикулу ${article}:\n\n`;
            data.forEach((item, index) => {
                responseText += `Артикул: ${item.article}\n`;
                responseText += `Цена: ${item.price || 'Не указана'}\n`;
                responseText += `Адрес: ${item.address || 'Не указан'}\n`;
                responseText += `Канал: ${item.channel_name || 'Неизвестно'}\n`;
                responseText += `Ссылка: ${item.link}\n`;
                if (index < data.length - 1) responseText += `-------------------\n`;
            });
            bot.sendMessage(msg.chat.id, responseText);
        } else {
            bot.sendMessage(msg.chat.id, `Товар с артикулом "${article}" не найден в базе.`);
        }
    } catch (err) {
        console.error("Ошибка поиска:", err.message);
        bot.sendMessage(msg.chat.id, "Произошла ошибка при поиске.");
    }
});
