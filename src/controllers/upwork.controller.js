// src/controllers/upwork.controller.js
import prisma from '../prisma.js';

class UpworkController {
  
  // Main sync endpoint - agent POSTs data here
  static async syncData(req, res) {
    try {
      const { profile, contracts = [], jobs = [], messages = [], earnings = [] } = req.body;
      
      if (!profile || !profile.username) {
        return res.status(400).json({ error: 'Missing profile data' });
      }
      
      // Ensure profile exists or update
      const upworkProfile = await prisma.upworkProfile.upsert({
        where: { username: profile.username },
        update: {
          email: profile.email || undefined,
          hourlyRate: profile.hourlyRate || undefined,
          totalEarnings: profile.totalEarnings || undefined,
          totalContracts: profile.totalContracts || undefined,
          successRate: profile.successRate || undefined,
          responsRate: profile.responsRate || undefined,
          lastSyncedAt: new Date(),
        },
        create: {
          username: profile.username,
          email: profile.email || `${profile.username}@freelancer.com`,
          hourlyRate: profile.hourlyRate || null,
          totalEarnings: profile.totalEarnings || 0,
          totalContracts: profile.totalContracts || 0,
          successRate: profile.successRate || null,
          responsRate: profile.responsRate || null,
          lastSyncedAt: new Date(),
        },
      });
      
      let contractCount = 0;
      let jobCount = 0;
      let messageCount = 0;
      let earningCount = 0;
      
      // Sync contracts
      for (const contract of contracts) {
        try {
          await prisma.upworkContract.upsert({
            where: { upworkContractId: contract.id },
            update: {
              status: contract.status || undefined,
              spent: contract.spent || undefined,
              escrowAmount: contract.escrow || undefined,
              completedMilestones: contract.completedMilestones || undefined,
              lastStatusUpdate: new Date(),
              syncedAt: new Date(),
            },
            create: {
              upworkContractId: contract.id,
              profileId: upworkProfile.id,
              clientName: contract.clientName || 'Unknown',
              clientId: contract.clientId || null,
              title: contract.title || 'Untitled',
              description: contract.description || null,
              status: contract.status || 'ACTIVE',
              budget: contract.budget || null,
              spent: contract.spent || 0,
              currency: contract.currency || 'USD',
              totalMilestones: contract.totalMilestones || 0,
              completedMilestones: contract.completedMilestones || 0,
              escrowAmount: contract.escrow || 0,
              skills: JSON.stringify(contract.skills || []),
              jobCategory: contract.category || null,
              hourlyRate: contract.hourlyRate || null,
              lastStatusUpdate: new Date(),
              syncedAt: new Date(),
            },
          });
          contractCount++;
        } catch (e) {
          console.error(`Error syncing contract ${contract.id}:`, e.message);
        }
      }
      
      // Sync jobs
      for (const job of jobs) {
        try {
          await prisma.upworkJob.upsert({
            where: { upworkJobId: job.id },
            update: {
              status: job.status || undefined,
              proposalStatus: job.proposalStatus || undefined,
              syncedAt: new Date(),
            },
            create: {
              upworkJobId: job.id,
              profileId: upworkProfile.id,
              title: job.title || 'Untitled',
              description: job.description || null,
              budget: job.budget || 0,
              currency: job.currency || 'USD',
              skills: JSON.stringify(job.skills || []),
              category: job.category || null,
              postedAt: job.postedAt ? new Date(job.postedAt) : new Date(),
              expiresAt: job.expiresAt ? new Date(job.expiresAt) : null,
              status: job.status || 'POSTED',
              proposalStatus: job.proposalStatus || null,
              clientTier: job.clientTier || null,
              budget_type: job.budget_type || null,
              syncedAt: new Date(),
            },
          });
          jobCount++;
        } catch (e) {
          console.error(`Error syncing job ${job.id}:`, e.message);
        }
      }
      
      // Sync messages
      for (const msg of messages) {
        try {
          await prisma.upworkMessage.upsert({
            where: { upworkMessageId: msg.id || msg.upworkMessageId },
            update: {
              isRead: msg.isRead || undefined,
              syncedAt: new Date(),
            },
            create: {
              upworkMessageId: msg.id || msg.upworkMessageId,
              profileId: upworkProfile.id,
              contractId: msg.contractId || null,
              jobId: msg.jobId || null,
              threadId: msg.threadId || null,
              clientName: msg.clientName || 'Unknown',
              clientId: msg.clientId || null,
              direction: msg.direction || 'INCOMING',
              content: msg.content || '',
              isRead: msg.isRead || false,
              attachments: JSON.stringify(msg.attachments || []),
              receivedAt: msg.receivedAt ? new Date(msg.receivedAt) : new Date(),
              sentAt: msg.sentAt ? new Date(msg.sentAt) : null,
              syncedAt: new Date(),
            },
          });
          messageCount++;
        } catch (e) {
          console.error(`Error syncing message ${msg.id}:`, e.message);
        }
      }
      
      // Sync earnings
      for (const earning of earnings) {
        try {
          await prisma.upworkEarning.create({
            data: {
              profileId: upworkProfile.id,
              amount: earning.amount || 0,
              currency: earning.currency || 'USD',
              source: earning.source || 'CONTRACT',
              sourceId: earning.sourceId || null,
              description: earning.description || null,
              earnedAt: earning.earnedAt ? new Date(earning.earnedAt) : new Date(),
              syncedAt: new Date(),
            },
          });
          earningCount++;
        } catch (e) {
          console.error(`Error syncing earning:`, e.message);
        }
      }
      
      res.json({
        success: true,
        profile: {
          id: upworkProfile.id,
          username: upworkProfile.username,
        },
        synced: {
          contracts: contractCount,
          jobs: jobCount,
          messages: messageCount,
          earnings: earningCount,
        },
        timestamp: new Date(),
      });
      
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({ 
        error: 'Sync failed',
        message: error.message 
      });
    }
  }
  
  // Get profile overview
  static async getProfile(req, res) {
    try {
      const { profileId } = req.params;
      
      const profile = await prisma.upworkProfile.findUnique({
        where: { id: profileId },
        include: {
          _count: {
            select: {
              contracts: true,
              jobs: true,
              messages: true,
              earnings: true,
            },
          },
        },
      });
      
      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      
      res.json(profile);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
  
  // Get contracts with milestones
  static async getContracts(req, res) {
    try {
      const contracts = await prisma.upworkContract.findMany({
        include: { milestones: true },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      
      res.json(contracts);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
  
  // Get active jobs
  static async getJobs(req, res) {
    try {
      const jobs = await prisma.upworkJob.findMany({
        where: {
          status: { notIn: ['EXPIRED', 'WITHDRAWN'] },
        },
        orderBy: { postedAt: 'desc' },
        take: 50,
      });
      
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
  
  // Get unread messages
  static async getMessages(req, res) {
    try {
      const messages = await prisma.upworkMessage.findMany({
        where: { isRead: false },
        orderBy: { receivedAt: 'desc' },
        take: 50,
      });
      
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
  
  // Get earnings summary
  static async getEarnings(req, res) {
    try {
      const earnings = await prisma.upworkEarning.findMany({
        orderBy: { earnedAt: 'desc' },
        take: 100,
      });
      
      const total = earnings.reduce((sum, e) => sum + e.amount, 0);
      
      res.json({ 
        total, 
        earnings, 
        count: earnings.length 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
  
  // Get dashboard overview
  static async getDashboard(req, res) {
    try {
      const [profiles, activeContracts, openJobs, unreadMessages, recentEarnings] = await Promise.all([
        prisma.upworkProfile.findMany({
          include: {
            _count: {
              select: { contracts: true, jobs: true, messages: true },
            },
          },
        }),
        prisma.upworkContract.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        }),
        prisma.upworkJob.findMany({
          where: { status: { notIn: ['EXPIRED', 'WITHDRAWN'] } },
          orderBy: { postedAt: 'desc' },
          take: 5,
        }),
        prisma.upworkMessage.findMany({
          where: { isRead: false },
          orderBy: { receivedAt: 'desc' },
          take: 10,
        }),
        prisma.upworkEarning.findMany({
          orderBy: { earnedAt: 'desc' },
          take: 10,
        }),
      ]);
      
      const totalEarnings = recentEarnings.reduce((sum, e) => sum + e.amount, 0);
      
      res.json({
        profiles,
        stats: {
          activeContracts: activeContracts.length,
          openJobs: openJobs.length,
          unreadMessages: unreadMessages.length,
          totalEarnings,
        },
        contracts: activeContracts,
        jobs: openJobs,
        messages: unreadMessages,
        earnings: recentEarnings,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default UpworkController;
