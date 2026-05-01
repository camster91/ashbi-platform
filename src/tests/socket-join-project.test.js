/**
 * Socket.IO join-project Authorization Tests
 *
 * Validates that the Socket.IO `join-project` event properly
 * authorizes users before allowing them to join project rooms.
 *
 * Issue #9: Any authenticated user could join any Socket.IO project room.
 * This test verifies the fix is in place.
 *
 * Run with: node --test src/tests/socket-join-project.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, '..', 'index.js');

describe('Socket.IO join-project Authorization', () => {
  it('should have authorization checks in join-project handler', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');

    // Verify the join-project event handler exists
    assert.ok(content.includes("socket.on('join-project'"), 'join-project event should be registered');

    // Verify that ADMIN/TEAM role check exists
    assert.ok(
      content.includes("socket.userRole === 'ADMIN'") || content.includes("socket.userRole === 'TEAM'"),
      'Should check for ADMIN or TEAM role before allowing unrestricted join'
    );

    // Verify client authorization exists (clientId check)
    assert.ok(
      content.includes('socket.clientId') || content.includes('socket.isClient'),
      'Should check client authorization before allowing client join'
    );

    // Verify that unauthorized joins are denied (not just silently accepted)
    assert.ok(
      content.includes('Not authorized') || content.includes('denied'),
      'Should emit error or deny unauthorized joins'
    );
  });

  it('should not allow unrestricted socket.join for project rooms', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');

    // Find all socket.join calls for project rooms
    const projectJoinRegex = /socket\.join\(`project:\$\{[^}]+\}`\)/g;
    const joins = content.match(projectJoinRegex) || [];

    // Each project room join should be preceded by a role/client check
    // (We verify this by ensuring there's no bare socket.join without
    // role check in the join-project handler)
    const joinProjectSection = content.substring(
      content.indexOf("socket.on('join-project'"),
      content.indexOf("});", content.indexOf("socket.on('join-project'")) + 3
    );

    // Ensure there's no simple `socket.join` without any condition
    // Pattern: socket.join immediately after 'join-project' without check
    const lines = joinProjectSection.split('\n');
    let insideConditional = false;

    for (const line of lines) {
      if (line.includes('socket.join') && line.includes('project:')) {
        // This join should be within a conditional block
        // Check that there's an if/return before it within the last few lines
        const idx = joinProjectSection.indexOf(line);
        const preceding = joinProjectSection.substring(Math.max(0, idx - 200), idx);
        assert.ok(
          preceding.includes('if (') || preceding.includes('return'),
          `socket.join for project room should be within a conditional: ${line.trim()}`
        );
      }
    }
  });

  it('should check project belongs to client for CLIENT role users', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');

    // Find the join-project handler section
    const handlerStart = content.indexOf("socket.on('join-project'");
    assert.ok(handlerStart > 0, 'join-project handler should exist');

    // Get the full handler (look for the closing of the event handler)
    // Search for the pattern that ends the handler - the next socket.on or closing of the connection handler
    const nextSocketOn = content.indexOf("socket.on('", handlerStart + 20);
    const handlerEnd = nextSocketOn > handlerStart ? nextSocketOn : handlerStart + 2000;
    const handler = content.substring(handlerStart, handlerEnd);

    // Verify that for client users, it checks project.clientId against socket.clientId
    assert.ok(
      handler.includes('project.clientId') && handler.includes('socket.clientId'),
      'Client users should have their project membership verified (project.clientId === socket.clientId)'
    );

    // Verify error is emitted for unauthorized clients
    assert.ok(
      handler.includes("socket.emit('error'") && handler.includes('Not authorized'),
      'Should emit error for clients trying to access other projects'
    );
  });

  it('should handle errors in join-project gracefully', () => {
    const content = fs.readFileSync(indexPath, 'utf-8');

    const handlerStart = content.indexOf("socket.on('join-project'");
    const nextSocketOn = content.indexOf("socket.on('", handlerStart + 20);
    const handlerEnd = nextSocketOn > handlerStart ? nextSocketOn : handlerStart + 2000;
    const handler = content.substring(handlerStart, handlerEnd);

    assert.ok(
      handler.includes('try') && handler.includes('catch'),
      'join-project handler should have try/catch error handling'
    );
  });
});