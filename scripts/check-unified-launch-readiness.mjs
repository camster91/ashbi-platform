#!/usr/bin/env node
import { loadUnifiedLaunchReadiness } from '../src/services/unifiedLaunchReport.service.js';

const index = process.argv.indexOf('--manifest');
const manifestPath = index >= 0 ? process.argv[index + 1] : null;
const report = loadUnifiedLaunchReadiness(manifestPath);

process.stdout.write(`${JSON.stringify({ ready: report.ready, checks: report.checks }, null, 2)}\n`);
process.exitCode = report.ready ? 0 : 1;
