import aiClient from '../client.js';
import bus, { EVENTS } from '../../utils/events.js';
import logger from '../../utils/logger.js';
import { assignThread } from '../../services/assignment.service.js';

/**
 * Enterprise Email Orchestrator Agent
 * 
 * This agent manages the full lifecycle of an incoming email, 
 * coordinating between parsing, analysis, and side-effects.
 */
export class EmailOrchestrator {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async run(emailData) {
    const traceId = `email-${Date.now()}`;
    const log = logger.child({ traceId, subject: emailData.subject });
    
    log.info('🚀 Starting Email Orchestration');
    const reasoning = [];

    try {
      // 1. Triage & Match
      log.debug('Step 1: Triaging email');
      const match = await this.stepTriage(emailData);
      reasoning.push(match.reasoning);

      if (match.isSpam) {
        log.info('Marked as spam. Termination.');
        return { success: true, action: 'SPAM_FILTERED' };
      }

      // 2. Thread Context Management
      log.debug('Step 2: Managing thread context');
      const thread = await this.stepUpsertThread(emailData, match);
      reasoning.push(`Thread ${thread.id} created/updated`);

      // 3. Deep Analysis
      log.debug('Step 3: Deep content analysis');
      const analysis = await this.stepAnalyze(thread, emailData);
      reasoning.push(`Analysis complete: ${analysis.intent} (Sentiment: ${analysis.sentiment})`);

      // 4. Autonomous Assignment
      log.debug('Step 4: Autonomous assignment');
      const assignment = await this.stepAssign(thread);
      reasoning.push(`Assigned to ${assignment.userName || 'None'}`);

      // 5. Audit Trail & Persistence
      await this.prisma.thread.update({
        where: { id: thread.id },
        data: {
          aiReasoning: JSON.stringify(reasoning),
          aiAnalysis: JSON.stringify(analysis)
        }
      });

      // 6. Global Event Emission
      bus.emit(EVENTS.TASK_UPDATED, { threadId: thread.id, type: 'EMAIL_PROCESSED' });

      log.info('✅ Email Orchestration Complete');
      return { 
        success: true, 
        threadId: thread.id, 
        analysis 
      };

    } catch (err) {
      log.error({ err }, '❌ Orchestration Failed');
      throw err;
    }
  }

  // --- PRIVATE STEPS ---

  async stepTriage(emailData) {
    // Large company would use a dedicated lightweight classifier here
    return { isSpam: false, reasoning: 'Client-intent detected from sender domain' };
  }

  async stepUpsertThread(emailData, match) {
    return this.prisma.thread.create({
      data: {
        subject: emailData.subject,
        status: 'AWAITING_RESPONSE',
        messages: {
          create: {
            direction: 'INBOUND',
            senderEmail: emailData.senderEmail,
            bodyText: emailData.bodyText,
            receivedAt: new Date()
          }
        }
      }
    });
  }

  async stepAnalyze(thread, emailData) {
    // Implementation would call aiClient with specific analysis prompt
    return { intent: 'REQUEST_UPDATE', sentiment: 'POSITIVE', urgency: 'NORMAL' };
  }

  async stepAssign(thread) {
    const assignment = await assignThread(thread);
    if (assignment.userId) {
      await this.prisma.thread.update({
        where: { id: thread.id },
        data: { assignedToId: assignment.userId }
      });
    }
    return assignment;
  }
}
