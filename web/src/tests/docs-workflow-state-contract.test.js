import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const docs = readFileSync(resolve(process.cwd(), 'src/pages/Docs.jsx'), 'utf8');

describe('document workflow states', () => {
  it('distinguishes a document request failure from an empty library', () => {
    expect(docs).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(docs).toContain('notesError');
    expect(docs).toContain('refetchNotes');
    expect(docs).toMatch(/notesError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*notes\.length === 0/);
  });

  it('makes form dependency failures recoverable without clearing the draft', () => {
    for (const token of [
      'projectsError',
      'templatesError',
      'teamError',
      'retryNoteFormData',
      'noteFormDataFetching',
    ]) {
      expect(docs).toContain(token);
    }
    expect(docs).toMatch(/showNewNote[\s\S]*noteFormDataError[\s\S]*<QueryErrorState/);
  });
});
