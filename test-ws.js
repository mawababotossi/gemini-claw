import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001');

const clientId = 'test-client-' + Date.now();

ws.on('open', () => {
    console.log('Connected to WebChat WebSocket');
    ws.send(JSON.stringify({
        type: 'message',
        clientId,
        text: 'What time is it right now? Use the getCurrentTime tool.'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg);
    if (msg.type === 'message') {
        console.log('\nFINAL RESPONSE:', msg.text);
        ws.close();
    }
});

ws.on('error', (err) => console.error('WebSocket error:', err));
ws.on('close', () => console.log('WebSocket closed.'));
