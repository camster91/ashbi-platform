#!/usr/bin/env python3
"""
One-shot fix for the audit claim that was wrong.

The PR #238 commit 934f7e1 claims "ZERO endpoints without Zod validation"
but it left a wave of `validateBody(<schemaName>)` calls in route handlers
where the schema is REFERENCED but NEVER IMPORTED from ../validators/schemas.js.

At runtime, this throws ReferenceError on every route registration at server
startup, which means the new build won't start at all.

This script:
  1. For each src/routes/*.js file
  2. Find all `*Schema` references in the file body
  3. Check which are imported from '../validators/schemas.js'
  4. Insert the missing ones into the FIRST import block from that module

Idempotent — running it twice produces the same output.
"""
import re
import pathlib
import sys

ROOT = pathlib.Path('/opt/ashbi-platform')
ROUTES = ROOT / 'src' / 'routes'

def find_schemas_import_block(content):
    """Return (open_pos, close_pos, imported_set) for the FIRST import from
    '../validators/schemas.js' in the file. The block may span multiple lines."""
    # Find each '... } from ... validators/schemas.js' end-marker
    for end_m in re.finditer(r"\}\s*from\s*['\"]\.{1,2}/validators/schemas(?:\.js)?['\"];?", content):
        # Walk back to find matching 'import {'
        prefix = content[:end_m.start()]
        open_matches = list(re.finditer(r"^import\s*\{", prefix, re.MULTILINE))
        if not open_matches:
            continue
        last_open = open_matches[-1]
        # The import block is from last_open.start() to end_m.start()
        block = content[last_open.start():end_m.start()]
        # Parse names
        imported = set()
        for n in block.split(','):
            n = re.sub(r'\s+as\s+\w+', '', n).strip()
            n = n.replace('...', '').strip()
            if n.startswith('import'):
                n = n[6:].strip().lstrip('{').strip()
            if n and n not in ('{', '}', '', 'import'):
                imported.add(n)
        # Return the } position to insert before
        brace_pos = content.rfind('}', 0, end_m.end())
        return last_open.start(), brace_pos, imported
    return None

def fix_file(path):
    content = path.read_text()
    block = find_schemas_import_block(content)
    if not block:
        return None  # No import from validators/schemas.js
    open_pos, brace_pos, imported = block
    used = set(re.findall(r'\b[a-z][A-Za-z]*Schema\b', content))
    missing = sorted(used - imported)
    if not missing:
        return []
    # Insert "  <missing>,\n" right before the closing brace
    insert = ',\n  ' + ',\n  '.join(missing)
    new_content = content[:brace_pos] + insert + '\n' + content[brace_pos:]
    path.write_text(new_content)
    return missing

def main():
    total = 0
    files = 0
    for f in sorted(ROUTES.glob('*.js')):
        try:
            added = fix_file(f)
            if added:
                files += 1
                total += len(added)
                print(f"{f.name}: +{len(added)}: {', '.join(added[:4])}{'...' if len(added)>4 else ''}")
        except Exception as e:
            print(f"ERROR {f.name}: {e}")
    print(f"\n=== Fixed {total} imports across {files} files ===")

if __name__ == '__main__':
    main()
