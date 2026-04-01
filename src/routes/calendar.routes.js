// Calendar & Meeting routes

import { prisma } from '../index.js';

export default async function calendarRoutes(fastify) {
  // Get calendar events
  fastify.get('/calendar', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate, projectId, type } = request.query;

    const where = {};

    // Date range filter
    if (startDate || endDate) {
      where.OR = [
        {
          startTime: {
            gte: startDate ? new Date(startDate) : undefined,
            lte: endDate ? new Date(endDate) : undefined
          }
        },
        {
          endTime: {
            gte: startDate ? new Date(startDate) : undefined,
            lte: endDate ? new Date(endDate) : undefined
          }
        }
      ];
    }

    if (projectId) where.projectId = projectId;
    if (type) where.type = type;

    const events = await prisma.calendarEvent.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attendees: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });

    return events.map(e => ({
      ...e,
      recurrence: e.recurrence ? JSON.parse(e.recurrence) : null
    }));
  });

  // Get my calendar events
  fastify.get('/calendar/my', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { startDate, endDate } = request.query;

    const dateWhere = {};
    if (startDate) dateWhere.gte = new Date(startDate);
    if (endDate) dateWhere.lte = new Date(endDate);

    const events = await prisma.calendarEvent.findMany({
      where: {
        OR: [
          { createdById: request.user.id },
          { attendees: { some: { userId: request.user.id } } }
        ],
        startTime: Object.keys(dateWhere).length > 0 ? dateWhere : undefined
      },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attendees: {
          include: {
            user: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });

    return events;
  });

  // Get single event
  fastify.get('/calendar/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const event = await prisma.calendarEvent.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        attendees: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });

    if (!event) {
      return reply.status(404).send({ error: 'Event not found' });
    }

    return {
      ...event,
      recurrence: event.recurrence ? JSON.parse(event.recurrence) : null
    };
  });

  // Create event / meeting
  fastify.post('/calendar', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const {
      title,
      description,
      startTime,
      endTime,
      type = 'MEETING',
      location,
      isAllDay = false,
      color,
      projectId,
      attendeeIds = []
    } = request.body;

    if (!title?.trim()) {
      return reply.status(400).send({ error: 'Title is required' });
    }

    if (!startTime) {
      return reply.status(400).send({ error: 'Start time is required' });
    }

    const event = await prisma.calendarEvent.create({
      data: {
        title,
        description,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : new Date(startTime),
        type,
        location,
        isAllDay,
        color: color || '#3B82F6',
        projectId,
        createdById: request.user.id,
        attendees: {
          create: attendeeIds.map(userId => ({ userId }))
        }
      },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attendees: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });

    // Log activity
    if (projectId) {
      await prisma.activity.create({
        data: {
          type: 'EVENT_CREATED',
          action: 'created',
          entityType: 'CALENDAR_EVENT',
          entityId: event.id,
          entityName: title,
          projectId,
          userId: request.user.id
        }
      });
    }

    // Notify attendees
    for (const attendeeId of attendeeIds) {
      if (attendeeId !== request.user.id) {
        await prisma.notification.create({
          data: {
            type: 'EVENT_INVITE',
            title: 'Meeting Invitation',
            message: `${request.user.name} invited you to "${title}"`,
            data: JSON.stringify({ eventId: event.id, projectId }),
            userId: attendeeId
          }
        });

        fastify.notify(attendeeId, 'EVENT_INVITE', { eventId: event.id });
      }
    }

    return reply.status(201).send(event);
  });

  // Update event
  fastify.put('/calendar/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      title,
      description,
      startTime,
      endTime,
      type,
      location,
      isAllDay,
      color,
      attendeeIds
    } = request.body;

    const existing = await prisma.calendarEvent.findUnique({
      where: { id },
      include: { attendees: true }
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Event not found' });
    }

    // Only creator or admin can update
    if (existing.createdById !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot edit this event' });
    }

    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (startTime !== undefined) data.startTime = new Date(startTime);
    if (endTime !== undefined) data.endTime = new Date(endTime);
    if (type !== undefined) data.type = type;
    if (location !== undefined) data.location = location;
    if (isAllDay !== undefined) data.isAllDay = isAllDay;
    if (color !== undefined) data.color = color;

    // Handle attendee updates
    if (attendeeIds !== undefined) {
      // Remove old attendees
      await prisma.eventAttendee.deleteMany({ where: { eventId: id } });

      // Add new attendees
      if (attendeeIds.length > 0) {
        await prisma.eventAttendee.createMany({
          data: attendeeIds.map(userId => ({ eventId: id, userId }))
        });

        // Notify new attendees
        const existingAttendeeIds = existing.attendees.map(a => a.userId);
        const newAttendeeIds = attendeeIds.filter(id => !existingAttendeeIds.includes(id));

        for (const attendeeId of newAttendeeIds) {
          if (attendeeId !== request.user.id) {
            await prisma.notification.create({
              data: {
                type: 'EVENT_INVITE',
                title: 'Meeting Invitation',
                message: `${request.user.name} invited you to "${title || existing.title}"`,
                data: JSON.stringify({ eventId: id }),
                userId: attendeeId
              }
            });
          }
        }
      }
    }

    const event = await prisma.calendarEvent.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        attendees: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });

    return event;
  });

  // Delete event
  fastify.delete('/calendar/:id', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.calendarEvent.findUnique({ where: { id } });

    if (!existing) {
      return reply.status(404).send({ error: 'Event not found' });
    }

    // Only creator or admin can delete
    if (existing.createdById !== request.user.id && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Cannot delete this event' });
    }

    await prisma.calendarEvent.delete({ where: { id } });

    return { success: true };
  });

  // RSVP to event
  fastify.post('/calendar/:id/rsvp', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const { status } = request.body; // ACCEPTED, DECLINED, TENTATIVE

    if (!['ACCEPTED', 'DECLINED', 'TENTATIVE'].includes(status)) {
      return reply.status(400).send({ error: 'Invalid RSVP status' });
    }

    const attendee = await prisma.eventAttendee.findUnique({
      where: {
        eventId_userId: {
          eventId: id,
          userId: request.user.id
        }
      }
    });

    if (!attendee) {
      return reply.status(404).send({ error: 'You are not invited to this event' });
    }

    await prisma.eventAttendee.update({
      where: { id: attendee.id },
      data: { status }
    });

    // Notify event creator
    const event = await prisma.calendarEvent.findUnique({
      where: { id },
      select: { title: true, createdById: true }
    });

    if (event && event.createdById !== request.user.id) {
      await prisma.notification.create({
        data: {
          type: 'EVENT_RSVP',
          title: 'Meeting RSVP',
          message: `${request.user.name} ${status.toLowerCase()} your meeting "${event.title}"`,
          data: JSON.stringify({ eventId: id, status }),
          userId: event.createdById
        }
      });
    }

    return { success: true, status };
  });

  // Get upcoming events (widget/dashboard)
  fastify.get('/calendar/upcoming', {
    onRequest: [fastify.authenticate]
  }, async (request) => {
    const { limit: limitParam = '5' } = request.query;
    const limit = parseInt(limitParam);

    const events = await prisma.calendarEvent.findMany({
      where: {
        startTime: { gte: new Date() },
        OR: [
          { createdById: request.user.id },
          { attendees: { some: { userId: request.user.id } } }
        ]
      },
      include: {
        project: { select: { id: true, name: true } },
        attendees: {
          include: {
            user: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { startTime: 'asc' },
      take: limit
    });

    return events;
  });
}
