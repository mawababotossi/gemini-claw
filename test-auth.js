"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var events_js_1 = require("@google/gemini-cli-core/dist/src/utils/events.js");
var oauth2_js_1 = require("@google/gemini-cli-core/dist/src/code_assist/oauth2.js");
var config_js_1 = require("@google/gemini-cli-core/dist/src/config/config.js");
events_js_1.coreEvents.on('user_feedback', function (fb) {
    console.log(fb.message);
});
var config = new config_js_1.Config({ noBrowser: true, targetDir: '.', model: 'gemini-2.5-pro' });
config.initialize().then(function () {
    return (0, oauth2_js_1.getOauthClient)(2, config); // AuthType.LOGIN_WITH_GOOGLE is usually enum value 1 or 2
}).then(function () {
    console.log('Login successful.');
    process.exit(0);
}).catch(console.error);
