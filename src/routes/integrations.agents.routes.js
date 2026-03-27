// OpenClaw Agent Control Routes
// GET  /api/agents/status       - list running agents
// POST /api/agents/run/:name    - trigger an agent run
// GET  /api/agents/logs/:name   - view agent output logs

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

// Path to overnight batch script
const BATCH_SCRIPT = process.env.BATCH_SCRIPT_PATH || 'C:\\Users\\camst\\.openclaw\\workspace\\scripts\\overnight-batch.ps1';
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || 'C:\\Users\\camst\\.openclaw\\workspace';

// Known agents definition
const KNOWN_AGENTS = [
  { name: 'overnight-batch', displayName: 'Overnight Batch', description: 'Runs email triage, Upwork, Penny/Stan agents', script: BATCH_SCRIPT },
  { name: 'email-triage', displayName: 'Email Triage', description: 'Triages Gmail inbox', type: 'openclaw' },
  { name: 'upwork', displayName: 'Upwork Monitor', description: 'Checks Upwork messages and milestones', type: 'openclaw' },
];

export default async function agentsRoutes(fastify) {

  // List all agents and their status
  fastify.get('/status', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      // Check if OpenClaw process is running via tasklist
      let openclawRunning = false;
      try {
        const { stdout } = await execFileAsync('tasklist', ['/fi', 'IMAGENAME eq node.exe', '/fo', 'csv', '/nh'], { timeout: 5000 });
        openclawRunning = stdout.includes('node.exe');
      } catch {
        // can't determine
      }

      // Get recent log files from workspace memory
      const memoryDir = path.join(WORKSPACE, 'memory');
      let recentLogs = [];
      try {
        const files = await fs.readdir(memoryDir);
        const logFiles = files.filter(f => f.endsWith('.md')).sort().reverse().slice(0, 5);
        recentLogs = logFiles.map(f => ({
          date: f.replace('.md', ''),
          path: path.join(memoryDir, f)
        }));
      } catch { /* no logs */ }

      return {
        openclawRunning,
        agents: KNOWN_AGENTS.map(agent => ({
          ...agent,
          status: openclawRunning ? 'idle' : 'offline',
        })),
        recentLogs,
        checkedAt: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err, 'Agent status check error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // Trigger an agent by name
  fastify.post('/run/:name', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { name } = request.params;
    const agent = KNOWN_AGENTS.find(a => a.name === name);

    if (!agent) {
      return reply.status(404).send({ error: `Unknown agent: ${name}`, available: KNOWN_AGENTS.map(a => a.name) });
    }

    try {
      if (agent.script) {
        // Fire-and-forget the PowerShell script
        const child = execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', agent.script], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        return {
          success: true,
          agent: name,
          message: `Agent ${name} triggered`,
          triggeredAt: new Date().toISOString()
        };
      } else if (agent.type === 'openclaw') {
        // Could invoke openclaw CLI
        const child = execFile('openclaw', ['run', name], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        return { success: true, agent: name, triggeredAt: new Date().toISOString() };
      }

      return reply.status(400).send({ error: 'Agent has no runnable script configured' });
    } catch (err) {
      fastify.log.error(err, `Agent run error: ${name}`);
      return reply.status(500).send({ error: err.message });
    }
  });

  // Get agent log content
  fastify.get('/logs/:date', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { date } = request.params;
    // Validate date format to prevent path traversal
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const logPath = path.join(WORKSPACE, 'memory', `${date}.md`);
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      return { date, content, path: logPath };
    } catch {
      return reply.status(404).send({ error: `No log found for ${date}` });
    }
  });

  // List available log dates
  fastify.get('/logs', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const memoryDir = path.join(WORKSPACE, 'memory');
      const files = await fs.readdir(memoryDir);
      const logs = files
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
        .slice(0, 30)
        .map(f => ({ date: f.replace('.md', '') }));
      return { logs };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
