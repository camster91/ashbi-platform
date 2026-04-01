// Ash AI Chat — persistent conversations with the AI Chief of Staff

import { prisma } from '../index.js';
import env from '../config/env.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const ASH_SYSTEM_PROMPT = `You are Ash, Chief of Staff at Ashbi Design. You have access to the agency's Hub data. You are direct, smart, and get things done. Keep responses concise unless detail is needed.`;

async function callAI(messages) {
  // Use Kilo (OpenAI-compatible) if available
  const kiloKey = process.env.KILO_API_KEY;
  const kiloBase = process.env.KILO_API_BASE || 'https://api.kilo.ai/api/gateway/';
  const kiloModel = process.env.KILO_MODEL || 'anthropic/claude-haiku-4-5';

  if (kiloKey) {
    const response = await fetch(`${kiloBase}chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${kiloKey}`
      },
      body: JSON.stringify({
        model: kiloModel,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: ASH_SYSTEM_PROMPT },
          ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
        ]
      })
    });
    const data = await response.json();
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    throw new Error(data.error?.message || JSON.stringify(data));
  }

  // Use Gemini as fallback
  if (env.geminiApiKey) {
    const genAI = new GoogleGenerativeAI(env.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: ASH_SYSTEM_PROMPT,
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
    });

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({ history });
    const lastMsg = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMsg.content);
    return result.response.text();
  }

  // Anthropic fallback
  if (env.anthropicApiKey && env.anthropicApiKey !== 'placeholder') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2048,
        system: ASH_SYSTEM_PROMPT,
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      })
    });
    const data = await response.json();
    return data.content?.[0]?.text || 'No response from AI.';
  }

  return 'AI not configured. Please add a KILO_API_KEY or GEMINI_API_KEY to your environment.';
}

export default async function ashChatRoutes(fastify) {
  // POST /api/ash-chat/message
  fastify.post('/message', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          conversationId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { message, conversationId } = request.body;

    let conversation;
    if (conversationId) {
      conversation = await prisma.ashConversation.findUnique({ where: { id: conversationId } });
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });
    } else {
      // New conversation — title from first message (truncated)
      const title = message.length > 60 ? message.slice(0, 60) + '…' : message;
      conversation = await prisma.ashConversation.create({ data: { title } });
    }

    // Save user message
    await prisma.ashChatMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: message }
    });

    // Load conversation history
    const history = await prisma.ashChatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' }
    });

    // Call AI
    let aiResponse;
    try {
      aiResponse = await callAI(history.map(m => ({ role: m.role, content: m.content })));
    } catch (err) {
      fastify.log.error('AI call failed:', err);
      aiResponse = `Error calling AI: ${err.message}`;
    }

    // Save assistant response
    const assistantMsg = await prisma.ashChatMessage.create({
      data: { conversationId: conversation.id, role: 'assistant', content: aiResponse }
    });

    // Update conversation updatedAt
    await prisma.ashConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() }
    });

    return { conversationId: conversation.id, response: aiResponse, messageId: assistantMsg.id };
  });

  // GET /api/ash-chat/conversations
  fastify.get('/conversations', {
    onRequest: [fastify.authenticate]
  }, async () => {
    const conversations = await prisma.ashConversation.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    return conversations.map(c => ({
      id: c.id,
      title: c.title || 'New conversation',
      lastMessage: c.messages[0]?.content?.slice(0, 100) || '',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));
  });

  // GET /api/ash-chat/conversations/:id/messages
  fastify.get('/conversations/:id/messages', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const conversation = await prisma.ashConversation.findUnique({ where: { id } });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    const messages = await prisma.ashChatMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' }
    });

    return { conversation, messages };
  });

  // DELETE /api/ash-chat/conversations/:id
  fastify.delete('/conversations/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    await prisma.ashConversation.delete({ where: { id } }).catch(() => null);
    return { success: true };
  });
}
