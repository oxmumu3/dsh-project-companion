import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDotOverlay,registerDotOverlay} from '../src/client-overlay.js';

test('browser entry embeds the audited overlay factories without drift',async()=>{
 const source=await readFile(new URL('../src/client.js',import.meta.url),'utf8');
 for(const factory of [createDotOverlay,registerDotOverlay])assert.equal(source.includes(factory.toString()),true,`${factory.name} must match its tested source`);
 assert.match(source,/registerDotOverlay\(ctx,DotOverlay\)/);
 assert.match(source,/slotName:'dot.overlay.conversation'/);
 assert.match(source,/desktopConversationCanEmbed\(\{activePanelId,mainSessionId,mainViewEmpty\},target.sessionId\)/);
});
