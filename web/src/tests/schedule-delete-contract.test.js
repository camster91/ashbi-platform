import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Schedule.jsx'), 'utf8');

describe('calendar event deletion contract', () => {
  it('requires shared confirmation from both event surfaces', () => {
    expect(source).toContain("import ConfirmDialog from '../components/ConfirmDialog'");
    expect(source.match(/<ConfirmDialog/g)).toHaveLength(2);
    expect(source.match(/This permanently removes the calendar event and cannot be undone\./g)).toHaveLength(2);
    expect(source.match(/Permanently delete “\$\{.*\.title\}”\?/g)).toHaveLength(2);
  });

  it('guards duplicate requests and keeps errors in the confirmation', () => {
    expect(source.match(/pending=\{deleteMutation\.isPending\}/g)).toHaveLength(2);
    expect(source.match(/error=\{deleteMutation\.error\?\.message\}/g)).toHaveLength(2);
    expect(source.match(/disabled=\{deleteMutation\.isPending\}/g).length).toBeGreaterThanOrEqual(2);
  });

  it('removes direct destructive mutation handlers', () => {
    expect(source).not.toContain('onClick={() => deleteMutation.mutate()}');
    expect(source.match(/confirmingDelete/g).length).toBeGreaterThanOrEqual(4);
  });
});
