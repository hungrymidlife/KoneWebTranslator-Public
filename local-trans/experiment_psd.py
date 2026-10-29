"""Minimal RGB 8-bit layered Photoshop PSD writer (uncompressed).

Keeps original, restored background and rasterized Korean text layers independent.
Text is rasterized, NOT a native editable Photoshop TySh text object.
"""
from __future__ import annotations
import io
import struct
from PIL import Image
P=lambda fmt,*args:struct.pack('>'+fmt,*args)

def _pascal(s):
    encoded=s.encode('mac_roman','replace')[:255]
    result=bytes([len(encoded)])+encoded
    return result+b'\x00'*((-len(result))%4)

def _unicode_layer_name(name):
    encoded=str(name).encode('utf-16-be')
    data=P('I',len(encoded)//2)+encoded
    return b'8BIM'+b'luni'+P('I',len(data))+data+b'\x00'*((-len(data))%2)

def write_psd(layers):
    """layers: bottom-to-top [(name,RGBA image)]. Returns valid PSD bytes."""
    if not isinstance(layers,list) or not (1<=len(layers)<=40):raise ValueError('PSD layers 1..40')
    w,h=layers[0][1].size
    if w<1 or h<1 or w>30000 or h>30000:raise ValueError('PSD image bounds invalid')
    rgba=[]
    for name,image in layers:
        if image.size!=(w,h):raise ValueError('Layer dimensions differ')
        rgba.append((str(name),image.convert('RGBA')))
    records=io.BytesIO();pixels=io.BytesIO()
    for name,image in reversed(rgba): # Photoshop records front/top first.
        channels=image.split()
        record=io.BytesIO()
        record.write(P('iiii',0,0,h,w))
        record.write(P('H',4))
        for channel_id,channel in [(-1,channels[3]),(0,channels[0]),(1,channels[1]),(2,channels[2])]:
            record.write(P('hI',channel_id,2+w*h))
            pixels.write(P('H',0));pixels.write(channel.tobytes())
        record.write(b'8BIMnorm'+bytes([255,0,0,0]))
        extra=P('I',0)+P('I',0)+_pascal(name)+_unicode_layer_name(name)
        record.write(P('I',len(extra)));record.write(extra)
        records.write(record.getvalue())
    info=P('h',len(rgba))+records.getvalue()+pixels.getvalue()
    if len(info)%2:info+=b'\x00'
    layer_mask=P('I',len(info))+info+P('I',0)
    result=io.BytesIO()
    result.write(b'8BPS'+P('H',1)+b'\x00'*6+P('HIIHH',3,h,w,8,3))
    result.write(P('I',0)) # color-mode data
    result.write(P('I',0)) # image resources
    result.write(P('I',len(layer_mask))+layer_mask)
    composite=Image.new('RGBA',(w,h),(0,0,0,0))
    for name,image in rgba:composite=Image.alpha_composite(composite,image)
    red,green,blue=composite.convert('RGB').split()
    result.write(P('H',0))
    for channel in (red,green,blue):result.write(channel.tobytes())
    return result.getvalue()
