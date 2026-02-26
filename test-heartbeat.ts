
import { ACPBridge } from './packages/core/src/ACPBridge.js';

async function testHeartbeat() {
    console.log('--- Testing ACP Heartbeat ---');
    const bridge = new ACPBridge('gemini-1.5-flash');

    try {
        await bridge.start();
        console.log('Bridge started.');

        // Attempt a custom ping
        console.log('Sending ping...');
        try {
            // We use the private request method via (bridge as any) for testing
            const result = await (bridge as any).request('ping', {});
            console.log('Ping result:', result);
        } catch (err: any) {
            console.warn('Ping failed (as expected if not implemented):', err.message);
        }

        // Attempt a standard 'get_capabilities' or similar if it exists
        console.log('Sending session/list...');
        try {
            const result = await (bridge as any).request('session/list', {});
            console.log('Session list result:', result);
        } catch (err: any) {
            console.warn('session/list failed:', err.message);
        }

        console.log('Heartbeat test complete.');
    } catch (err) {
        console.error('Fatal test error:', err);
    } finally {
        bridge.stop();
    }
}

testHeartbeat();
