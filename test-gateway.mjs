import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001');

ws.on('open', () => {
    console.log('CONNECTED to WebChat');
    const msg = {
        type: 'message',
        text: 'Hello! What is your model ID?'
    };
    ws.send(JSON.stringify(msg));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('RECV:', JSON.stringify(msg, null, 2));
    if (msg.text && !msg.thought) {
        console.log('SUCCESS: Received response from agent!');
        process.exit(0);
    }
});

ws.on('error', (err) => {
    console.error('WS ERROR:', err);
    process.exit(1);
});

setTimeout(() => {
    console.error('TIMED OUT waiting for response');
    process.exit(1);
}, 30000);
