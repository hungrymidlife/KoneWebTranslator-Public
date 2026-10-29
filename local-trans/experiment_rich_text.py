"""Opt-in Korean rich text runs for manually edited boxes."""
import re
from functools import lru_cache
TOKEN=re.compile(r'(\*\*|\[\[color:#[0-9a-fA-F]{6}\]\]|\[\[/color\]\])')
def runs(text,base='#000000'):
    color=base;bold=False;out=[]
    for t in TOKEN.split(str(text)):
        if not t:continue
        if t=='**':bold=not bold
        elif t.startswith('[[color:'):color=t[len('[[color:'):-2]
        elif t=='[[/color]]':color=base
        else:out.append((t,color,bold))
    return out
def render_rich(draw,edit,font_for,settings):
    x,y,w,h=edit['bbox'];size=int(edit['font_size']);font=font_for(size)
    stroke=int(edit.get('stroke_width',0));pad=min(4,max(1,w//20))
    @lru_cache(maxsize=2048)
    def width(ch):return float(draw.textlength(ch,font=font))+2*stroke
    lines=[[]];measures=[0.]
    for text,color,bold in runs(edit.get('text',''),edit['text_color']):
        for ch in text:
            if ch=='\n':lines.append([]);measures.append(0.);continue
            advance=width(ch)
            if lines[-1] and measures[-1]+advance>max(1,w-2*pad):
                lines.append([]);measures.append(0.)
            lines[-1].append((ch,color,bold,advance));measures[-1]+=advance
            if len(lines)>400:raise ValueError('Rich text line limit exceeded')
    line_h=max(size+2*stroke+2,round(size*settings['typeset_line_height_ratio'])+2*stroke)
    for i,row in enumerate(lines):
        alignment=edit.get('align','left')
        cursor=(x+pad if alignment=='left' else x+w-pad-measures[i] if alignment=='right' else x+(w-measures[i])/2)
        for ch,color,bold,advance in row:
            bb=draw.textbbox((0,0),ch,font=font,stroke_width=stroke)
            xx,yy=round(cursor-bb[0]),round(y+pad+i*line_h-bb[1])
            draw.text((xx,yy),ch,font=font,fill=color,stroke_width=stroke,stroke_fill=edit['stroke_color'])
            if bold:draw.text((xx+1,yy),ch,font=font,fill=color)
            cursor+=advance
