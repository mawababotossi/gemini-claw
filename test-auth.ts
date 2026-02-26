import { coreEvents } from '@google/gemini-cli-core/dist/src/utils/events.js';
import { getOauthClient } from '@google/gemini-cli-core/dist/src/code_assist/oauth2.js';
import { Config } from '@google/gemini-cli-core/dist/src/config/config.js';

coreEvents.on('user_feedback', (fb) => {
    console.log(fb.message);
});

const config = new Config({ noBrowser: true, targetDir: '.', model: 'gemini-2.5-pro' });
config.initialize().then(() => {
    return getOauthClient(2, config); // AuthType.LOGIN_WITH_GOOGLE is usually enum value 1 or 2
}).then(() => {
    console.log('Login successful.');
    process.exit(0);
}).catch(console.error);
