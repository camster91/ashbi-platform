// Enterprise OpenTelemetry Configuration - Modern Stable Version

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import * as resources from '@opentelemetry/resources';
import * as sc from '@opentelemetry/semantic-conventions';
import env from './config/env.js';

// SERVICE_ROLE and APP_REVISION are intentionally read directly from
// process.env: SERVICE_ROLE is a per-process label injected by the
// orchestrator (not a config concern), and APP_REVISION is the image
// digest baked into the deploy (set at build time, not at runtime).
const endpoint = env.otlpEndpoint;
const serviceRole = process.env.SERVICE_ROLE
  || (process.argv.some((arg) => arg.includes('jobs/worker')) ? 'worker' : 'api');

let sdk;
if (endpoint) {
  sdk = new NodeSDK({
    resource: resources.resourceFromAttributes({
      [sc.ATTR_SERVICE_NAME]: `ashbi-platform-${serviceRole}`,
      [sc.ATTR_SERVICE_VERSION]: process.env.APP_REVISION || 'unknown',
      [sc.ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env.nodeEnv,
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
}

// Flush telemetry on shutdown without taking ownership of process exit. The
// API and worker lifecycle handlers remain responsible for draining work.
if (sdk) {
  process.once('beforeExit', async () => {
    try {
      await sdk.shutdown();
    } catch (error) {
      // Import the shared Pino instance only after sdk.start() has registered
      // its instrumentation, otherwise ESM's eager imports prevent log/trace
      // correlation from being attached to the application logger.
      const { default: logger } = await import('./utils/logger.js');
      logger.error({ err: error }, 'Error terminating tracing');
    }
  });
}
