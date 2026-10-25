from pathlib import Path
import json,hashlib,fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
source=TTFont('fonts/NotoSansCJKsc-VF.ttf')
font=instantiateVariableFont(source,{'wght':400},inplace=False)
for record in list(font['name'].names):
 if record.nameID in [1,3,4,6,16,17]:
  value={1:'Ashbi CJK Probe',3:'AshbiCJKProbe-Regular-derived',4:'Ashbi CJK Probe Regular',6:'AshbiCJKProbe-Regular',16:'Ashbi CJK Probe',17:'Regular'}[record.nameID]
  font['name'].setName(value,record.nameID,record.platformID,record.platEncID,record.langID)
font.save('fonts/AshbiCJK-Regular.ttf')
result={'fontTools':fontTools.__version__,'axes':{'wght':400},'source':'cjk-variable-source.json','output':'fonts/AshbiCJK-Regular.ttf','size':Path('fonts/AshbiCJK-Regular.ttf').stat().st_size,'sha256':hashlib.sha256(Path('fonts/AshbiCJK-Regular.ttf').read_bytes()).hexdigest(),'nameChange':'Ashbi CJK Probe; copyright/license retained; derived static TrueType, no variable axes','glyphCount':font['maxp'].numGlyphs,'hasFvar':'fvar' in font,'hasGlyf':'glyf' in font}
Path('derived-cjk-manifest.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result,indent=2))
