"""Photoshop JSX companion: preserve raster PSD and offer native editable text."""
from __future__ import annotations
import json
import re
from pathlib import Path

def collect(record, edits):
    typing={str(t.get('region_id')):t for t in record.get('typesetting', [])}
    entries=[]
    def plain(value):
        return re.sub(r'\[\[(?:color:#[0-9a-fA-F]{6}|/color)\]\]', '', str(value or '')).replace('**', '')
    for reg in record.get('regions', []):
        key=str(reg.get('id'))
        typ=typing.get(key,{})
        if typ.get('status') not in ('drawn','manual'):continue
        override=edits.get(key)
        if isinstance(override,dict) and override.get('deleted'):continue
        if override is None and typ.get('shape_line_placements'):
            for i,row in enumerate(typ['shape_line_placements']):
                entries.append({'name':f'{key}-row{i+1}','text':plain(row['text']),
                                'x':int(row['x']),'y':int(row['y']),'size':int(typ.get('font_size',24)),
                                'color':typ.get('text_color','#000000'),'align':'left'})
        else:
            e=override or typ
            bbox=e.get('bbox') if override else typ.get('typesetting_bbox') or reg.get('bbox')
            if not bbox:continue
            entries.append({'name':key,'text':plain(e.get('text') if override else reg.get('translated_text')),
                            'x':int(bbox[0]),'y':int(bbox[1]),'size':int(e.get('font_size',24)),
                            'color':e.get('text_color','#000000'),'align':e.get('align','left')})
    for rid,edit in edits.items():
        if not str(rid).startswith('manual-') or not isinstance(edit,dict) or edit.get('deleted'):continue
        bb=edit.get('bbox')
        if bb:entries.append({'name':rid,'text':plain(edit.get('text')),'x':int(bb[0]),'y':int(bb[1]),
                              'size':int(edit.get('font_size',24)),'color':edit.get('text_color','#000000'),
                              'align':edit.get('align','left')})
    return entries

def make_jsx(path,entries):
    if len(entries)>500:raise ValueError('Too many text layers')
    data=json.dumps(entries,ensure_ascii=False)
    filename=json.dumps(str(Path(path).resolve()),ensure_ascii=False)
    return f'''#target photoshop
// Photoshop > File > Scripts > Browse: use JSX, then Save As a new PSD.
(function () {{
  var source=new File({filename});
  if(!source.exists){{alert('PSD file not found');return;}}
  var doc=app.open(source);
  var rows={data};
  for(var k=0;k<doc.artLayers.length;k++) {{
    if(doc.artLayers[k].name==='Korean text (raster)')doc.artLayers[k].visible=false;
  }}
  for(var i=0;i<rows.length;i++) {{
    var item=rows[i];if(!item.text)continue;
    var layer=doc.artLayers.add();layer.kind=LayerKind.TEXT;
    layer.name='Korean editable '+item.name;
    layer.textItem.contents=item.text;
    layer.textItem.size=new UnitValue(Math.max(1,item.size),'px');
    layer.textItem.position=[new UnitValue(item.x,'px'),new UnitValue(item.y+item.size,'px')];
    if(item.align==='center')layer.textItem.justification=Justification.CENTER;
    else if(item.align==='right')layer.textItem.justification=Justification.RIGHT;
    var color=new SolidColor();var hex=String(item.color||'#000000').replace('#','');
    if(!/^[0-9A-Fa-f]{{6}}$/.test(hex))hex='000000';
    color.rgb.hexValue=hex;layer.textItem.color=color;
  }}
  alert(rows.length+' editable Korean text layers created. Save As a new PSD.');
}})();
'''
