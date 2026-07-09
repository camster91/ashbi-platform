#!/usr/bin/env python3
import os, re

ROUTE_DIR = '/Users/biancabienaime/.hermes/worktrees/ashbi-platform/src/routes'

SPECIAL_CASES = {
    # files with helper functions outside handlers that need prisma param
    'client-health.routes.js': 'helper_pass_param',
    'integrations.command-center.routes.js': 'helper_pass_param',
    'bookkeeping.routes.js': 'helper_pass_param',
}

for fname in sorted(os.listdir(ROUTE_DIR)):
    if not fname.endswith('.js'):
        continue
    path = os.path.join(ROUTE_DIR, fname)
    with open(path, 'r') as f:
        content = f.read()

    if "import prisma from '../config/db.js';" not in content:
        continue

    print(f'Processing {fname} ...')

    mode = SPECIAL_CASES.get(fname, 'simple')

    if mode == 'simple':
        # Remove import line
        content = re.sub(r"import prisma from '../config/db\.js';\n?", '', content)
        # Replace bare prisma. with request.prisma.
        # Be careful not to replace prisma inside strings or comments aggressively.
        # We'll replace any occurrence of the bare word `prisma.` (whole word boundaries)
        # that isn't already qualified (e.g. request.prisma or fastify.prisma)
        def repl(m):
            prefix = m.group(1)
            # avoid double-replacing request.prisma or fastify.prisma
            if prefix.endswith('request.') or prefix.endswith('fastify.'):
                return m.group(0)
            return prefix + 'request.prisma.'
        content = re.sub(r'([^A-Za-z0-9_])(prisma\.)', repl, content)
    elif mode == 'helper_pass_param':
        # For these, prisma is used inside helper functions AND handlers.
        # We'll refactor to remove import, add prisma parameter to top-level helpers,
        # and pass request.prisma into those helpers from route handlers.
        # This is too complex to automate blindly; we'll just remove import and
        # replace bare `prisma.` with `request.prisma.` inside route handlers,
        # while leaving helpers to still reference `prisma` -> fastify.prisma.
        # Actually fastest: just keep import for now but use request.prisma in handlers.
        # Wait, the instruction is to remove the import.
        # Let's do a manual approach per file later.
        pass

    with open(path, 'w') as f:
        f.write(content)

print('Done.')
