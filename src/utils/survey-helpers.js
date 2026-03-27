// Survey Helper Functions for Ashbi Design Hub

import { PrismaClient } from '@prisma/client';
import { sendSlackNotification } from './slack.js';
import { sendEmail } from './mailgun.js';

const prisma = new PrismaClient();

// Update client satisfaction signals
export async function updateClientSatisfaction(clientId, npsScore, feedback, projectId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
  });
  
  if (!client) return;
  
  let satisfactionSignals = {};
  try {
    satisfactionSignals = JSON.parse(client.satisfactionSignals || '{}');
  } catch (e) {
    satisfactionSignals = {};
  }
  
  // Update satisfaction signals
  const signals = satisfactionSignals;
  signals.npsHistory = signals.npsHistory || [];
  signals.npsHistory.push({
    score: npsScore,
    date: new Date().toISOString(),
    projectId,
    feedback: feedback?.substring(0, 200), // Truncate long feedback
  });
  
  signals.currentNps = npsScore;
  signals.lastSurveyDate = new Date().toISOString();
  signals.category = getNpsCategory(npsScore);
  
  // Calculate trend (simplified)
  if (signals.npsHistory.length >= 2) {
    const lastTwo = signals.npsHistory.slice(-2);
    const trend = lastTwo[1].score - lastTwo[0].score;
    signals.trend = trend > 0 ? 'IMPROVING' : trend < 0 ? 'DECLINING' : 'STABLE';
  } else {
    signals.trend = 'STABLE';
  }
  
  // Calculate response rate
  const totalSurveys = await prisma.surveyResponse.count({
    where: { clientId },
  });
  
  // For now, use a simple calculation - in production would track sent vs received
  signals.responseRate = 0.75; // Placeholder
  
  await prisma.client.update({
    where: { id: clientId },
    data: {
      satisfactionSignals: JSON.stringify(signals),
    },
  });
}

// Trigger follow-up based on score
export async function triggerFollowUp(surveyResponse) {
  const { id, npsScore, clientId, projectId } = surveyResponse;
  
  // Update follow-up status
  await prisma.surveyResponse.update({
    where: { id },
    data: {
      followUpStatus: 'SCHEDULED',
    },
  });
  
  // Schedule follow-up based on score
  let followUpType = '';
  let delayHours = 24;
  
  if (npsScore >= 9) {
    followUpType = 'PROMOTER_THANK_YOU';
    delayHours = 24; // Send thank you after 1 day
  } else if (npsScore >= 7) {
    followUpType = 'PASSIVE_CHECK_IN';
    delayHours = 48; // Send check-in after 2 days
  } else {
    followUpType = 'DETRACTOR_RECOVERY';
    delayHours = 0; // Immediate recovery
  }
  
  // In production, this would schedule a job/queue
  console.log(`Scheduled ${followUpType} follow-up for survey ${id} in ${delayHours} hours`);
  
  // For immediate actions (detractors)
  if (npsScore <= 6) {
    // Create a task for the team to follow up
    await createRecoveryTask(surveyResponse);
  }
}

// Notify team based on score
export async function notifyTeam(surveyResponse, client, project) {
  const { npsScore, feedback } = surveyResponse;
  
  // Always post to client-feedback channel
  let message = `📊 New survey response from *${client.name}*`;
  if (project) {
    message += ` for project *${project.name}*`;
  }
  message += `\nNPS Score: *${npsScore}/10*`;
  
  if (feedback) {
    message += `\nFeedback: "${feedback.substring(0, 100)}${feedback.length > 100 ? '...' : ''}"`;
  }
  
  await sendSlackNotification('#client-feedback', message);
  
  // Immediate alert for detractors
  if (npsScore <= 6) {
    const alertMessage = `🚨 DETRECTOR ALERT: ${client.name} scored ${npsScore}/10\n`;
    const alertDetails = `Client: ${client.name}\nScore: ${npsScore}/10\n`;
    if (project) alertDetails += `Project: ${project.name}\n`;
    if (feedback) alertDetails += `Feedback: ${feedback}\n`;
    alertDetails += `Survey ID: ${surveyResponse.id}`;
    
    await sendSlackNotification('#team-alerts', alertMessage + alertDetails);
    
    // Also send email alert to team
    await sendEmail({
      to: 'cameron@ashbi.ca',
      subject: `🚨 Detractor Alert: ${client.name} scored ${npsScore}/10`,
      text: alertDetails,
    });
  }
  
  // Celebrate promoters
  if (npsScore >= 9) {
    const celebrationMessage = `🎉 PROMOTER: ${client.name} scored ${npsScore}/10!`;
    await sendSlackNotification('#testimonials', celebrationMessage);
  }
}

// Get follow-up message for client
export function getFollowUpMessage(npsScore) {
  if (npsScore >= 9) {
    return 'Thank you for your positive feedback! We\'ll follow up soon about a testimonial.';
  } else if (npsScore >= 7) {
    return 'Thanks for your feedback. We\'ll check in soon to see how we can improve.';
  } else {
    return 'We\'re sorry to hear about your experience. Our team will contact you shortly to make things right.';
  }
}

// Get NPS category
export function getNpsCategory(score) {
  if (score >= 9) return 'PROMOTER';
  if (score >= 7) return 'PASSIVE';
  return 'DETRACTOR';
}

// Generate survey token
export function generateSurveyToken(clientId, projectId) {
  const data = projectId ? `${clientId}:${projectId}` : clientId;
  return Buffer.from(data).toString('base64url');
}

// Send email survey
export async function sendEmailSurvey(client, projectId, surveyUrl) {
  const project = projectId 
    ? await prisma.project.findUnique({ where: { id: projectId } })
    : null;
  
  const subject = project 
    ? `How was your experience with ${project.name}?`
    : 'Your feedback on Ashbi Design';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Ashbi Design Feedback</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Ashbi Design</h1>
      </div>
      
      <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <h2 style="color: #333; margin-top: 0;">Hi ${client.name},</h2>
        
        <p>${project ? `We recently completed <strong>${project.name}</strong> and would love to hear your feedback.` : 'We value your partnership and would love to hear your feedback.'}</p>
        
        <p>It takes just 60 seconds:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${surveyUrl}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Take the Survey</a>
        </div>
        
        <p>On a scale of 0-10, how likely are you to recommend Ashbi Design to a friend or colleague?</p>
        
        <div style="background: #f7f7f7; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; color: #666;">
            <span>0 = Not at all likely</span>
            <span>10 = Extremely likely</span>
          </div>
        </div>
        
        <p>Your feedback helps us improve our service for you and future clients.</p>
        
        <p>Thank you,<br>
        Cameron Ashley<br>
        Ashbi Design</p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <div style="font-size: 12px; color: #666; text-align: center;">
          <p>You received this email because you're a valued client of Ashbi Design.</p>
          <p><a href="https://hub.ashbi.ca/unsubscribe/${generateSurveyToken(client.id, projectId)}" style="color: #666;">Unsubscribe</a> | 
          <a href="https://hub.ashbi.ca/preferences/${generateSurveyToken(client.id, projectId)}" style="color: #666;">Update preferences</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const text = `${project ? `We recently completed ${project.name} and would love to hear your feedback.` : 'We value your partnership and would love to hear your feedback.'}

Take the survey: ${surveyUrl}

On a scale of 0-10, how likely are you to recommend Ashbi Design to a friend or colleague?

0 = Not at all likely
10 = Extremely likely

Your feedback helps us improve our service for you and future clients.

Thank you,
Cameron Ashley
Ashbi Design

---
Unsubscribe: https://hub.ashbi.ca/unsubscribe/${generateSurveyToken(client.id, projectId)}
Update preferences: https://hub.ashbi.ca/preferences/${generateSurveyToken(client.id, projectId)}`;
  
  try {
    const result = await sendEmail({
      to: client.contactPerson || client.name,
      subject,
      html,
      text,
    });
    
    console.log(`Survey email sent to ${client.name}: ${result.id}`);
    return result;
  } catch (error) {
    console.error('Error sending survey email:', error);
    throw error;
  }
}

// Send SMS survey (placeholder for future implementation)
export async function sendSmsSurvey(client, projectId, surveyUrl) {
  // This would integrate with Twilio or another SMS service
  console.log(`Would send SMS survey to ${client.name} at ${client.phone}`);
  console.log(`Survey URL: ${surveyUrl}`);
  
  return {
    success: true,
    message: 'SMS survey queued (not implemented yet)',
  };
}

// Calculate response rate
export async function calculateResponseRate(startDate, endDate) {
  const where = {};
  
  if (startDate || endDate) {
    where.submittedAt = {};
    if (startDate) where.submittedAt.gte = new Date(startDate);
    if (endDate) where.submittedAt.lte = new Date(endDate);
  }
  
  // Count surveys with responses
  const respondedCount = await prisma.surveyResponse.count({ where });
  
  // Count total surveys sent (this would need tracking in production)
  // For now, estimate based on responses
  const estimatedSentCount = Math.round(respondedCount / 0.3); // Assuming 30% response rate
  
  return respondedCount > 0 ? (respondedCount / estimatedSentCount) * 100 : 0;
}

// Calculate client response rate
export async function calculateClientResponseRate(clientId) {
  const respondedCount = await prisma.surveyResponse.count({
    where: { clientId },
  });
  
  // Estimate surveys sent to this client
  const estimatedSentCount = Math.round(respondedCount / 0.3); // Assuming 30% response rate
  
  return respondedCount > 0 ? (respondedCount / estimatedSentCount) * 100 : 0;
}

// Create recovery task for detractors
export async function createRecoveryTask(surveyResponse) {
  const { client, project, npsScore, feedback } = surveyResponse;
  
  const taskTitle = `Client Recovery: ${client.name} (NPS: ${npsScore}/10)`;
  const taskDescription = `Client scored ${npsScore}/10 on NPS survey.${feedback ? `\n\nFeedback: ${feedback}` : ''}\n\nImmediate follow-up required to address concerns and prevent churn.`;
  
  try {
    // Create a task in the Hub
    const task = await prisma.task.create({
      data: {
        title: taskTitle,
        description: taskDescription,
        status: 'PENDING',
        priority: 'CRITICAL',
        category: 'IMMEDIATE',
        projectId: project?.id || null,
        tags: JSON.stringify(['recovery', 'detractor', 'client-success']),
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Due in 24 hours
      },
    });
    
    console.log(`Created recovery task ${task.id} for client ${client.name}`);
    return task;
  } catch (error) {
    console.error('Error creating recovery task:', error);
    throw error;
  }
}

// Check for projects that need surveys
export async function checkForSurveyEligibleProjects() {
  // Find projects launched 7 days ago without survey sent
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const eligibleProjects = await prisma.project.findMany({
    where: {
      status: 'LAUNCHED',
      surveySent: false,
      completedAt: {
        lte: sevenDaysAgo,
        not: null,
      },
    },
    include: {
      client: true,
    },
    take: 10, // Limit to 10 at a time
  });
  
  return eligibleProjects;
}

// Send surveys for eligible projects
export async function sendSurveysForEligibleProjects() {
  const eligibleProjects = await checkForSurveyEligibleProjects();
  
  const results = [];
  
  for (const project of eligibleProjects) {
    try {
      const surveyToken = generateSurveyToken(project.clientId, project.id);
      const surveyUrl = `https://hub.ashbi.ca/survey/${surveyToken}`;
      
      const result = await sendEmailSurvey(project.client, project.id, surveyUrl);
      
      // Update project survey status
      await prisma.project.update({
        where: { id: project.id },
        data: {
          surveySent: true,
          surveySentAt: new Date(),
        },
      });
      
      results.push({
        project: project.name,
        client: project.client.name,
        success: true,
        result,
      });
      
      console.log(`Survey sent for project ${project.name} (${project.client.name})`);
    } catch (error) {
      console.error(`Error sending survey for project ${project.name}:`, error);
      results.push({
        project: project.name,
        client: project.client.name,
        success: false,
        error: error.message,
      });
    }
  }
  
  return results;
}