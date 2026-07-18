#!/usr/bin/env python3
"""Fix the 3 remaining route files that have NO validators/schemas import
at all. Add the import line + the missing schema names."""
import pathlib

ROOT = pathlib.Path('/Users/biancabienaime/.mavis/sessions/mvs_7a4b7ef7561143b588c60f281374ad69/workspace/ashbi-platform/src/routes')

# (filename, missing schemas)
FIXES = [
    ('draft.routes.js', ['draftUpsertSchema']),
    ('landing.routes.js', ['landingLeadUpdateSchema']),
    ('time-session.routes.js', ['timeSessionStartNewSchema']),
]

for fname, missing in FIXES:
    f = ROOT / fname
    content = f.read_text()
    new_import = f"import {{ validateBody, {', '.join(missing)} }} from '../validators/schemas.js';\n"
    # Insert at the top after the comment block (find first 'import' line)
    lines = content.split('\n')
    insert_idx = 0
    for i, line in enumerate(lines):
        if line.startswith('import '):
            insert_idx = i
            break
    new_content = '\n'.join(lines[:insert_idx] + [new_import.rstrip()] + lines[insert_idx:])
    f.write_text(new_content)
    print(f"{fname}: added import with {', '.join(missing)}")
