import { spawn } from 'node:child_process';
import readline from 'node:readline';

const gemini = spawn('gemini', ['--experimental-acp', '-m', 'gemini-3.1-pro-preview']);

const rl = readline.createInterface({
    input: gemini.stdout,
    terminal: false
});

let requestId = 1;

function send(method, params = {}) {
    const msg = {
        jsonrpc: '2.0',
        id: requestId++,
        method,
        params
    };
    console.log('SENT:', JSON.stringify(msg));
    gemini.stdin.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
    try {
        const msg = JSON.parse(line);
        console.log('RECV:', JSON.stringify(msg, null, 2));

        if (msg.id === 1 && msg.result) { // Response to initialize
            send('authenticate', { methodId: 'oauth-personal' });
        } else if (msg.id === 2 && msg.result) { // Response to authenticate
            send('session/new', { cwd: process.cwd(), mcpServers: [] });
        } else if (msg.id === 3 && msg.result) { // Response to session/new
            const sessionId = msg.result.sessionId;
            send('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Hello! What is your model name?' }] });
        } else if (msg.method === 'sessionUpdate') {
            console.log('NOTIFICATION:', JSON.stringify(msg.params.update, null, 2));
        }
    } catch (err) {
        console.error('Error parsing response:', line, err);
    }
});

gemini.stderr.on('data', (data) => {
    console.error('STDERR:', data.toString());
});

gemini.on('exit', (code) => {
    console.log('Gemini exited with code:', code);
    process.exit(code);
});

// Start the protocol
send('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
        fs: { read: true, write: true, list: true }
    }
});

setTimeout(() => {
    console.log('Timeout - closing');
    gemini.kill();
    process.exit(0);
}, 60000);
