#!/usr/bin/env node
// Security check script for production deployment

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '../src');

function findSecurityIssues() {
  const issues = [];
  
  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Check for console.log statements
      if (line.includes('console.log') || line.includes('console.error') || line.includes('console.warn')) {
        if (!line.trim().startsWith('//')) { // Ignore commented lines
          issues.push({
            type: 'DEBUG_CODE',
            file: filePath,
            line: index + 1,
            content: line.trim(),
            severity: 'MEDIUM'
          });
        }
      }
      
      // Check for TODO/FIXME comments
      if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK')) {
        issues.push({
          type: 'TODO_COMMENT',
          file: filePath,
          line: index + 1,
          content: line.trim(),
          severity: 'LOW'
        });
      }
      
      // Check for hardcoded passwords or keys
      if (line.match(/password\s*[:=]\s*['"][^'"]*['"]/) || line.match(/secret\s*[:=]\s*['"][^'"]*['"]/)) {
        if (!line.includes('process.env') && !line.includes('placeholder')) {
          issues.push({
            type: 'HARDCODED_SECRET',
            file: filePath,
            line: index + 1,
            content: '[REDACTED]',
            severity: 'HIGH'
          });
        }
      }
      
      // Check for old SHA256 hashing
      if (line.includes('createHash') && line.includes('sha256')) {
        issues.push({
          type: 'WEAK_HASHING',
          file: filePath,
          line: index + 1,
          content: line.trim(),
          severity: 'HIGH'
        });
      }
    });
  }
  
  function scanDirectory(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory() && !item.name.startsWith('.')) {
        scanDirectory(fullPath);
      } else if (item.isFile() && (item.name.endsWith('.js') || item.name.endsWith('.jsx'))) {
        scanFile(fullPath);
      }
    }
  }
  
  scanDirectory(srcDir);
  return issues;
}

function generateReport(issues) {
  console.log('🔍 Security Check Report\n');
  
  const groupedIssues = issues.reduce((acc, issue) => {
    if (!acc[issue.severity]) acc[issue.severity] = [];
    acc[issue.severity].push(issue);
    return acc;
  }, {});
  
  const severityOrder = ['HIGH', 'MEDIUM', 'LOW'];
  const severityEmojis = {
    HIGH: '🚨',
    MEDIUM: '⚠️',
    LOW: '💡'
  };
  
  for (const severity of severityOrder) {
    if (groupedIssues[severity] && groupedIssues[severity].length > 0) {
      console.log(`${severityEmojis[severity]} ${severity} PRIORITY (${groupedIssues[severity].length} issues)\n`);
      
      const typeGroups = groupedIssues[severity].reduce((acc, issue) => {
        if (!acc[issue.type]) acc[issue.type] = [];
        acc[issue.type].push(issue);
        return acc;
      }, {});
      
      for (const [type, typeIssues] of Object.entries(typeGroups)) {
        console.log(`  ${type.replace(/_/g, ' ')}:`);
        typeIssues.forEach(issue => {
          const relativeFile = path.relative(process.cwd(), issue.file);
          console.log(`    ${relativeFile}:${issue.line} - ${issue.content}`);
        });
        console.log('');
      }
    }
  }
  
  if (issues.length === 0) {
    console.log('✅ No security issues found!');
  } else {
    const highIssues = (groupedIssues.HIGH || []).length;
    const mediumIssues = (groupedIssues.MEDIUM || []).length;
    const lowIssues = (groupedIssues.LOW || []).length;
    
    console.log(`\n📊 Summary: ${highIssues} high, ${mediumIssues} medium, ${lowIssues} low priority issues`);
    
    if (highIssues > 0) {
      console.log('\n❌ High priority issues must be resolved before production deployment');
      process.exit(1);
    } else if (mediumIssues > 0) {
      console.log('\n⚠️  Medium priority issues should be reviewed before production');
    } else {
      console.log('\n✅ No critical security issues found');
    }
  }
}

// Run the security check
const issues = findSecurityIssues();
generateReport(issues);