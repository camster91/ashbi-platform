import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/Notes.jsx'), 'utf8');

describe('project notes destructive recovery', () => {
  it('requires confirmation before a soft delete while preserving the existing undo path', () => {
    expect(source).toContain("import ConfirmDialog from './ConfirmDialog'");
    expect(source).toContain('const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);');
    expect(source).toContain('<Modal isOpen={!showDeleteConfirm}');
    expect(source).toContain('onClick={() => setShowDeleteConfirm(true)}');
    expect(source).toContain('<ConfirmDialog');
    expect(source).toContain('isOpen={showDeleteConfirm}');
    expect(source).toContain('onConfirm={onDelete}');
    expect(source).toContain('error={deleteError}');
    expect(source).toContain('Undo delete ${title}');
  });
});
