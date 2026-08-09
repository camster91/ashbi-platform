// Enterprise OpenTelemetry Configuration - Modern Stable Version

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import * as resources from '@opentelemetry/resources';
import * as sc from '@opentelemetry/semantic-conventions';

const endpoint = process.env.OTLP_ENDPOINT;
const serviceRole = process.env.SERVICE_ROLE
  || (process.argv.some((arg) => arg.includes('jobs/worker')) ? 'worker' : 'api');

let sdk;
if (endpoint) {
  sdk = new NodeSDK({
    resource: resources.resourceFromAttributes({
      [sc.ATTR_SERVICE_NAME]: `ashbi-platform-${serviceRole}`,
      [sc.ATTR_SERVICE_VERSION]: process.env.APP_REVISION || 'unknown',
      [sc.ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
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
      console.error('Error terminating tracing', error);
    }
  });
}
