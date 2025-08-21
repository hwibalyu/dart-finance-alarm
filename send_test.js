const { sendTelegramMessage } = require('./helper');

const message =
     '테스트 메시지입니다. 이 메시지는 send_test.js에서 보낸 것입니다';
const safeMessage = message.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');

sendTelegramMessage(`${safeMessage} ${new Date().toLocaleString()}`);
