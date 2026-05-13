// Stuck Orders Routes
// POST /api/stuck-orders              - get all stuck orders across stores
// POST /api/stuck-orders/check        - manually trigger a fresh scan
// GET  /api/stuck-orders/stores/:id   - get stuck orders for a specific store
// POST /api/stuck-orders/:storeId/:orderId/resolve - resolve a single order
// POST /api/stuck-orders/:storeId/bulk - bulk resolve orders for a store

import {
  scanAllStores,
  getStuckOrdersForStoreExport,
  resolveOrder,
  bulkResolveStoreOrders,
} from '../services/stuck-orders-service.js';

export default async function stuckOrdersRoutes(fastify) {

  // POST /api/stuck-orders — get all stuck orders across stores
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['all', 'critical', 'warning', 'normal'] },
          minAgeHours: { type: 'number', default: 24 },
        }
      }
    }
  }, async (request, reply) => {
    const { severity = 'all', minAgeHours = 24 } = request.body || {};

    try {
      const result = await scanAllStores();

      // Filter by severity if requested
      if (severity !== 'all') {
        result.stores = result.stores.map(store => ({
          ...store,
          orders: store.orders?.filter(o => o.severity === severity || o.severity === 'critical') || []
        }));
      }

      // Filter by min age
      if (minAgeHours > 24) {
        result.stores = result.stores.map(store => ({
          ...store,
          orders: store.orders?.filter(o => (o.age_in_hours || 0) >= minAgeHours) || []
        }));
      }

      // Recompute summary after filtering
      const filteredStores = result.stores;
      result.summary = {
        ...result.summary,
        total_stuck_orders: filteredStores.reduce((sum, s) => sum + (s.orders?.length || 0), 0),
        critical_count: filteredStores.reduce((sum, s) =>
          sum + (s.orders?.filter(o => o.severity === 'critical').length || 0), 0),
        warning_count: filteredStores.reduce((sum, s) =>
          sum + (s.orders?.filter(o => o.severity === 'warning').length || 0), 0),
        stores_with_orders: filteredStores.filter(s => (s.orders?.length || 0) > 0).length,
      };

      return result;
    } catch (err) {
      fastify.log.error(err, 'Stuck orders scan error');
      return reply.status(500).send({ error: 'Failed to scan stuck orders', detail: err.message });
    }
  });

  // POST /api/stuck-orders/check — manually trigger a fresh scan
  fastify.post('/check', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['all', 'critical', 'warning', 'normal'] },
          minAgeHours: { type: 'number', default: 24 },
        }
      }
    }
  }, async (request, reply) => {
    const { severity = 'all', minAgeHours = 24 } = request.body || {};

    try {
      const result = await scanAllStores();

      if (severity !== 'all') {
        result.stores = result.stores.map(store => ({
          ...store,
          orders: store.orders?.filter(o => o.severity === severity || o.severity === 'critical') || []
        }));
      }

      if (minAgeHours > 24) {
        result.stores = result.stores.map(store => ({
          ...store,
          orders: store.orders?.filter(o => (o.age_in_hours || 0) >= minAgeHours) || []
        }));
      }

      const filteredStores = result.stores;
      result.summary = {
        ...result.summary,
        total_stuck_orders: filteredStores.reduce((sum, s) => sum + (s.orders?.length || 0), 0),
        critical_count: filteredStores.reduce((sum, s) =>
          sum + (s.orders?.filter(o => o.severity === 'critical').length || 0), 0),
        warning_count: filteredStores.reduce((sum, s) =>
          sum + (s.orders?.filter(o => o.severity === 'warning').length || 0), 0),
        stores_with_orders: filteredStores.filter(s => (s.orders?.length || 0) > 0).length,
      };

      return {
        status: 'scan_complete',
        ...result,
        triggeredBy: request.user?.email || request.user?.id || 'unknown',
        triggeredAt: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error(err, 'Manual stuck orders check error');
      return reply.status(500).send({ error: 'Failed to run stuck orders check', detail: err.message });
    }
  });

  // GET /api/stuck-orders/stores/:domain — get stuck orders for a specific store
  fastify.get('/stores/:domain', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { domain } = request.params;

    try {
      const result = await getStuckOrdersForStoreExport(domain);
      return result;
    } catch (err) {
      fastify.log.error(err, 'Store stuck orders error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/stuck-orders/:storeId/:orderId/resolve — resolve a single order
  fastify.post('/:storeId/:orderId/resolve', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['storeId', 'orderId'],
        properties: {
          storeId: { type: 'string' },
          orderId: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['complete', 'cancel', 'on-hold', 'processing', 'pending'] }
        }
      }
    }
  }, async (request, reply) => {
    const { storeId, orderId } = request.params;
    const { action } = request.body;

    try {
      const result = await resolveOrder(storeId, parseInt(orderId, 10), action);
      return result;
    } catch (err) {
      fastify.log.error(err, 'Resolve order error');
      return reply.status(400).send({ error: err.message });
    }
  });

  // POST /api/stuck-orders/:storeId/bulk — bulk resolve orders for a store
  fastify.post('/:storeId/bulk', {
    onRequest: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['storeId'],
        properties: {
          storeId: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['complete', 'cancel'] },
          severity: { type: 'string', enum: ['all', 'critical', 'warning'] }
        }
      }
    }
  }, async (request, reply) => {
    const { storeId } = request.params;
    const { action = 'cancel', severity = 'all' } = request.body || {};

    try {
      const result = await bulkResolveStoreOrders(storeId, severity, action);
      return result;
    } catch (err) {
      fastify.log.error(err, 'Bulk resolve error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
