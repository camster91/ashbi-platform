#!/usr/bin/env node
import { assessSandboxReadiness } from '../src/services/sandbox-readiness.service.js';

const report = assessSandboxReadiness(process.env);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ready ? 0 : 1;
