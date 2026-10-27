# Contract PDF font assets

These pinned fonts are distributed under the included SIL Open Font License
files. `manifest.json` records each shipped binary and license checksum.
The provenance JSON files record upstream repositories, commits, URLs and
source hashes. The CJK font is a static weight-400 TrueType derivative, with
the family renamed and original copyright/license retained; its conversion
recipe and source manifest are included. FontTools is not a build dependency.

`node build-contract-fonts.mjs` verifies the committed inputs and generates
the ignored `contract-font-assets.generated.mjs` module. This standard ESM
module serves both Node tests and the compiled Worker. Font bytes decode
lazily, in bounded chunks, and are shared as immutable resource inputs;
shaping and PDF subsets remain local to each rendering request.

Do not replace fonts merely because text extraction passes. Font changes
require checks of visible glyphs, complex-script positioning, Unicode text
extraction and the actual Worker runtime. The old fontkit fork produced PDFs
whose text extracted correctly while some CJK glyphs were visibly missing.
The current candidate uses fontkit 2.0.4 with pdf-lib 1.17.1.

These assets do not establish complete Unicode coverage. Rendering must fail
explicitly for an unsupported grapheme instead of substituting a missing
glyph. Broad script coverage, runtime limits and representative contract
acceptance remain verification requirements for the PDF feature.
