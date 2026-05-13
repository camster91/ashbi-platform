const fs = require('fs');
const path = require('path');

const files = require('child_process')
  .execSync("grep -rl 'import prisma from' src/routes/", { cwd: '/home/camst/.hermes/worktrees/ashbi-platform' })
  .toString()
  .trim()
  .split('\n')
  .map(f => path.resolve('/home/camst/.hermes/worktrees/ashbi-platform', f));

const results = {
  modified: [],
  importRemoved: [],
  flagged: [],
  noChangeNeeded: [],
  errors: []
};

for (const file of files) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    const importRegex = /import\s+prisma\s+from\s+['"][^'"]*config\/db\.js['"];?\n?/;
    if (!importRegex.test(content)) {
      results.noChangeNeeded.push(file);
      continue;
    }

    // Find export default async function ... {
    let exportLineIdx = -1;
    let braceDepth = 0;
    let exportStarted = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^export\s+default\s+async\s+function\s+/.test(lines[i]) || /^export\s+default\s+function\s+/.test(lines[i])) {
        exportLineIdx = i;
        break;
      }
    }

    if (exportLineIdx === -1) {
      // No export default function found. Flag the file and skip.
      results.flagged.push({ file, reason: 'No export default function block found' });
      continue;
    }

    // Simple split: everything before export line is "beforeExport", after is "afterExport"
    const beforeExport = lines.slice(0, exportLineIdx).join('\n');
    const afterExport = lines.slice(exportLineIdx).join('\n');

    // Replace bare prisma. in afterExport with fastify.prisma.
    // Use negative lookbehind to avoid matching fastify.prisma. or request.prisma. or tx.prisma.
    const barePrismaRegex = /(?<![A-Za-z0-9_$])prisma\./g;
    const afterExportReplaced = afterExport.replace(barePrismaRegex, 'fastify.prisma.');

    let newContent = beforeExport + '\n' + afterExportReplaced;

    // Check if any bare prisma. remains in the whole file
    const remainingBare = [...newContent.matchAll(barePrismaRegex)];
    if (remainingBare.length === 0) {
      newContent = newContent.replace(importRegex, '');
      results.importRemoved.push(file);
    } else {
      // Check if remaining bare are only in beforeExport (standalone functions)
      const beforeBare = [...beforeExport.matchAll(barePrismaRegex)];
      const afterBare = [...afterExportReplaced.matchAll(barePrismaRegex)];
      if (afterBare.length === 0 && beforeBare.length > 0) {
        // Import still needed for standalone functions
        results.flagged.push({ file, reason: `Standalone functions still use bare prisma. (${beforeBare.length} occurrences)` });
      } else if (afterBare.length > 0) {
        // Some bare prisma. still inside route handlers — this shouldn't happen, log error
        results.errors.push({ file, reason: `Still has bare prisma. inside route handlers after replacement (${afterBare.length} occurrences)` });
      } else {
        results.noChangeNeeded.push(file);
      }
    }

    if (newContent !== content) {
      fs.writeFileSync(file, newContent, 'utf8');
      if (!results.importRemoved.includes(file) && !results.flagged.find(f => f.file === file) && !results.errors.find(f => f.file === file)) {
        results.modified.push(file);
      }
    }
  } catch (err) {
    results.errors.push({ file, reason: err.message });
  }
}

console.log('=== IMPORTS REMOVED ===');
results.importRemoved.forEach(f => console.log(path.relative('/home/camst/.hermes/worktrees/ashbi-platform', f)));

console.log('\n=== FLAGGED (standalone functions still need import) ===');
results.flagged.forEach(r => console.log(path.relative('/home/camst/.hermes/worktrees/ashbi-platform', r.file) + ' — ' + r.reason));

console.log('\n=== ERRORS ===');
results.errors.forEach(r => console.log(path.relative('/home/camst/.hermes/worktrees/ashbi-platform', r.file) + ' — ' + r.reason));

console.log('\n=== MODIFIED (prisma. replaced in handlers) ===');
results.modified.forEach(f => console.log(path.relative('/home/camst/.hermes/worktrees/ashbi-platform', f)));

console.log('\n=== NO CHANGE NEEDED ===');
results.noChangeNeeded.forEach(f => console.log(path.relative('/home/camst/.hermes/worktrees/ashbi-platform', f)));
