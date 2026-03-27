// OpenClaw API Integration Routes
// Allows Hub AI to communicate with OpenClaw gateway

import { prisma } from '../index.js';

export default async function openclawRoutes(fastify) {
  // Health check - verify OpenClaw gateway is accessible
  fastify.get('/health', { onRequest: [fastify.authenticate] }, async () => {
    try {
      const response = await fetch('http://localhost:18789/health', {
        timeout: 5000
      });
      
      const data = await response.json().catch(() => ({}));
      
      return {
        status: response.ok ? 'healthy' : 'unhealthy',
        openclaw: data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unreachable',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  });

  // Send a message to OpenClaw
  fastify.post('/message', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { channel, content, metadata = {} } = request.body;

    if (!channel || !content) {
      return reply.status(400).send({ error: 'channel and content are required' });
    }

    try {
      const response = await fetch('http://localhost:18789/api/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel,
          content,
          metadata: {
            ...metadata,
            source: 'agency-hub',
            userId: request.user.id,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenClaw API error: ${response.status}`);
      }

      const result = await response.json();

      // Log the interaction
      await prisma.aiTeamMessage.create({
        data: {
          agentRole: 'OPENCLAW_INTEGRATION',
          role: 'ASSISTANT',
          content: `Message sent to OpenClaw channel "${channel}"`,
          metadata: JSON.stringify({
            channel,
            contentLength: content.length,
            result
          })
        }
      });

      return { success: true, result };
    } catch (error) {
      fastify.log.error('OpenClaw message error:', error);
      return reply.status(500).send({ 
        error: 'Failed to send message to OpenClaw', 
        message: error.message 
      });
    }
  });

  // Execute a command via OpenClaw
  fastify.post('/command', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { command, args = [], context = {} } = request.body;

    if (!command) {
      return reply.status(400).send({ error: 'command is required' });
    }

    try {
      const response = await fetch('http://localhost:18789/api/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command,
          args,
          context: {
            ...context,
            source: 'agency-hub',
            userId: request.user.id,
            userEmail: request.user.email,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenClaw command error: ${response.status}`);
      }

      const result = await response.json();

      // Log the command execution
      await prisma.aiTeamMessage.create({
        data: {
          agentRole: 'OPENCLAW_INTEGRATION',
          role: 'ASSISTANT',
          content: `Executed OpenClaw command: ${command}`,
          metadata: JSON.stringify({
            command,
            args,
            result
          })
        }
      });

      return { success: true, result };
    } catch (error) {
      fastify.log.error('OpenClaw command error:', error);
      return reply.status(500).send({ 
        error: 'Failed to execute OpenClaw command', 
        message: error.message 
      });
    }
  });

  // Spawn a specialist via OpenClaw
  fastify.post('/spawn', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { specialist, task, context = {} } = request.body;

    if (!specialist || !task) {
      return reply.status(400).send({ error: 'specialist and task are required' });
    }

    try {
      const response = await fetch('http://localhost:18789/api/spawn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          specialist,
          task,
          context: {
            ...context,
            source: 'agency-hub',
            userId: request.user.id,
            hubContext: {
              project: context.project,
              client: context.client,
              task: context.task
            },
            timestamp: new Date().toISOString()
          }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenClaw spawn error: ${response.status}`);
      }

      const result = await response.json();

      // Create a task in Hub to track this specialist work
      const hubTask = await prisma.task.create({
        data: {
          title: `AI Specialist: ${specialist} - ${task.substring(0, 50)}...`,
          description: `OpenClaw specialist spawned to handle: ${task}\n\nContext: ${JSON.stringify(context, null, 2)}`,
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          projectId: context.project?.id,
          assigneeId: request.user.id,
          metadata: JSON.stringify({
            type: 'openclaw_specialist',
            specialist,
            openclawTaskId: result.taskId,
            context
          })
        }
      });

      // Log the spawn
      await prisma.aiTeamMessage.create({
        data: {
          agentRole: 'OPENCLAW_INTEGRATION',
          role: 'ASSISTANT',
          content: `Spawned OpenClaw specialist: ${specialist}\nTask: ${task}\nHub Task: ${hubTask.id}`,
          metadata: JSON.stringify({
            specialist,
            task,
            hubTaskId: hubTask.id,
            openclawResult: result
          })
        }
      });

      return { 
        success: true, 
        result,
        hubTask: {
          id: hubTask.id,
          title: hubTask.title,
          link: `/tasks/${hubTask.id}`
        }
      };
    } catch (error) {
      fastify.log.error('OpenClaw spawn error:', error);
      return reply.status(500).send({ 
        error: 'Failed to spawn OpenClaw specialist', 
        message: error.message 
      });
    }
  });

  // Get available specialists from OpenClaw
  fastify.get('/specialists', { onRequest: [fastify.authenticate] }, async () => {
    try {
      const response = await fetch('http://localhost:18789/api/specialists', {
        timeout: 5000
      });

      if (!response.ok) {
        return { available: false, error: `OpenClaw error: ${response.status}` };
      }

      const specialists = await response.json();
      
      return { 
        available: true, 
        specialists,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return { 
        available: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  });

  // Query OpenClaw for information
  fastify.post('/query', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { query, context = {} } = request.body;

    if (!query) {
      return reply.status(400).send({ error: 'query is required' });
    }

    try {
      const response = await fetch('http://localhost:18789/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          context: {
            ...context,
            source: 'agency-hub',
            userId: request.user.id,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenClaw query error: ${response.status}`);
      }

      const result = await response.json();

      // Log the query
      await prisma.aiTeamMessage.create({
        data: {
          agentRole: 'OPENCLAW_INTEGRATION',
          role: 'ASSISTANT',
          content: `Query to OpenClaw: ${query.substring(0, 100)}...`,
          metadata: JSON.stringify({
            query,
            result
          })
        }
      });

      return { success: true, result };
    } catch (error) {
      fastify.log.error('OpenClaw query error:', error);
      return reply.status(500).send({ 
        error: 'Failed to query OpenClaw', 
        message: error.message 
      });
    }
  });

  // Get OpenClaw session status
  fastify.get('/sessions', { onRequest: [fastify.authenticate] }, async () => {
    try {
      const response = await fetch('http://localhost:18789/api/sessions', {
        timeout: 5000
      });

      if (!response.ok) {
        return { available: false, error: `OpenClaw error: ${response.status}` };
      }

      const sessions = await response.json();
      
      // Filter to show only relevant sessions
      const hubSessions = sessions.filter(s => 
        s.context?.source === 'agency-hub' || 
        s.metadata?.hubUserId === request.user.id
      );

      return { 
        available: true, 
        allSessions: sessions.length,
        hubSessions: hubSessions.length,
        sessions: hubSessions,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return { 
        available: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  });
}