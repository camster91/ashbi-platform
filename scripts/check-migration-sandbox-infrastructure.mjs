#!/usr/bin/env node
import fs from 'node:fs';
import { assessMigrationSandboxInfrastructure } from '../src/services/migrationSandboxInfrastructure.service.js';

const report = assessMigrationSandboxInfrastructure({
  composeText: fs.readFileSync('docker-compose.migration-sandbox.yml', 'utf8'),
  environmentTemplate: fs.readFileSync('docs/migration-sandbox.env.example', 'utf8'),
  runbookText: fs.readFileSync('docs/migration-sandbox-deployment.md', 'utf8'),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ready ? 0 : 1;
