"""Read-only original/result comparison viewer for LocalTrans."""
import io
import json
import re
import tkinter as tk
import zipfile
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk


def natural_key(name):
    return [int(x) if x.isdecimal() else x.casefold() for x in re.split(r'(\d+)', name)]


class ReviewViewer(tk.Toplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.title('KoneWebTranslator | 검수 뷰어 V08 진단')
        self.geometry('1450x880')
        self.minsize(850, 520)
        self.pages = {}
        self.names = []
        self.index = 0
        self.scale = 1.0
        self.offset = [0, 0]
        self.images = {}
        self.photos = {}
        self.source_zip = None
        self.result_zip = None
        self.meta_path = None
        self.meta = {}
        self.live = True
        self.show_ocr = tk.BooleanVar(value=False)
        self.show_layout = tk.BooleanVar(value=False)
        self.show_mask = tk.BooleanVar(value=False)
        self.show_crop = tk.BooleanVar(value=False)
        self.show_roi = tk.BooleanVar(value=False)
        self.show_confidence = tk.BooleanVar(value=False)
        self.show_numbers = tk.BooleanVar(value=False)
        self.selected_region = None
        self.region_info = tk.StringVar(value='영역을 클릭하면 OCR·번역·식질 정보를 표시합니다.')
        self.status = tk.StringVar(value='작업 중 완료된 페이지가 표시됩니다. 별도 파일도 열 수 있습니다.')
        toolbar = ttk.Frame(self, padding=5)
        toolbar.pack(fill='x')
        ttk.Button(toolbar, text='완료 파일 열기', command=self.open_files).pack(side='left')
        ttk.Button(toolbar, text='이전', command=lambda:self.step(-1)).pack(side='left', padx=(12,2))
        ttk.Button(toolbar, text='다음', command=lambda:self.step(1)).pack(side='left')
        self.page_label = ttk.Label(toolbar, text='0/0')
        self.page_label.pack(side='left', padx=9)
        ttk.Button(toolbar, text='화면 맞춤', command=self.fit).pack(side='left')
        ttk.Button(toolbar, text='확대 +', command=lambda:self.zoom(1.25)).pack(side='left')
        ttk.Button(toolbar, text='축소 -', command=lambda:self.zoom(.8)).pack(side='left')
        for label,var in [('OCR 영역',self.show_ocr),('OCR 인식 crop',self.show_crop),('식질 영역',self.show_layout),('제거 마스크',self.show_mask),('LaMa ROI',self.show_roi),('신뢰도/ID',self.show_confidence),('좌표값',self.show_numbers)]:
            ttk.Checkbutton(toolbar, text=label, variable=var, command=self.render).pack(side='left',padx=4)
        ttk.Button(toolbar, text='최대화', command=lambda:self.state('zoomed')).pack(side='right')
        body = ttk.Frame(self)
        body.pack(fill='both',expand=True)
        for col,kind,title in [(0,'source','원본'),(1,'result','한국어 식질 결과')]:
            frame=ttk.LabelFrame(body,text=title)
            frame.grid(row=0,column=col,sticky='nsew',padx=4,pady=4)
            c=tk.Canvas(frame,bg='#252525',highlightthickness=0)
            c.pack(fill='both',expand=True)
            c.bind('<Configure>',lambda e:self.render())
            c.bind('<ButtonPress-1>',lambda e,k=kind:self.drag_start(e,k))
            c.bind('<ButtonRelease-1>',lambda e,k=kind:self.select_region(e,k))
            c.bind('<B1-Motion>',lambda e,k=kind:self.drag_motion(e,k))
            c.bind('<Enter>',lambda e:self.focus_set())
            self.images[kind]=c
        body.columnconfigure(0,weight=1)
        body.columnconfigure(1,weight=1)
        body.rowconfigure(0,weight=1)
        details = ttk.LabelFrame(self,text='선택 영역 상세 진단 (이미지에서 영역 클릭)')
        details.pack(fill='x',padx=6,pady=3)
        ttk.Label(details,textvariable=self.region_info,anchor='w',justify='left',wraplength=1400).pack(fill='x',padx=6,pady=3)
        ttk.Button(details,text='선택 영역 JSON 복사',command=self.copy_selected).pack(side='right',padx=5,pady=3)
        ttk.Label(self,textvariable=self.status,anchor='w').pack(fill='x',padx=6)
        self.bind('<Left>',lambda e:self.step(-1))
        self.bind('<Right>',lambda e:self.step(1))
        self.bind('<Prior>',lambda e:self.step(-1))
        self.bind('<Next>',lambda e:self.step(1))
        self.bind('<Home>',lambda e:self.goto(0))
        self.bind('<End>',lambda e:self.goto(len(self.names)-1))
        self.bind('<MouseWheel>',self.wheel)
        self.bind('<F11>',self.fullscreen)
        self.bind('<Escape>',lambda e:self.attributes('-fullscreen',False))
        self.bind('r',lambda e:self.fit())
        self.bind('R',lambda e:self.fit())
        self.after(150,self.fit)

    def fullscreen(self,event=None):
        self.attributes('-fullscreen',not bool(self.attributes('-fullscreen')))

    def wheel(self,event):
        if event.state & 0x0004:
            self.zoom(1.25 if event.delta>0 else .8)
        else:
            self.step(-1 if event.delta>0 else 1)
        return 'break'

    def drag_start(self,event,kind):
        self.drag=(kind,event.x,event.y)
    def drag_motion(self,event,kind):
        if not hasattr(self,'drag'):return
        prior_kind,x,y=self.drag
        if kind!=prior_kind:return
        self.offset[0]+=event.x-x
        self.offset[1]+=event.y-y
        self.drag=(kind,event.x,event.y)
        self.render()

    def select_region(self,event,kind):
        if not self.names or not hasattr(self,'drag'):return
        prev_kind,px,py=self.drag
        if prev_kind!=kind or abs(event.x-px)+abs(event.y-py)>8:return
        data=self.pages[self.names[self.index]]
        record=data.get('record') or {}
        raw=data.get(kind)
        if not raw:return
        with Image.open(io.BytesIO(raw)) as im: iw,ih=im.size
        canvas=self.images[kind]
        cw=max(100,canvas.winfo_width());ch=max(100,canvas.winfo_height())
        ratio=min((cw-15)/iw,(ch-15)/ih)*self.scale
        x=(event.x-(cw//2+self.offset[0]-iw*ratio/2))/ratio
        y=(event.y-(ch//2+self.offset[1]-ih*ratio/2))/ratio
        found=None
        for region in sorted(record.get('regions',[]),key=lambda r:(r.get('bbox') or [0,0,100000,100000])[2]*(r.get('bbox') or [0,0,100000,100000])[3]):
            box=region.get('bbox')
            if box and box[0]<=x<=box[0]+box[2] and box[1]<=y<=box[1]+box[3]:
                found=region;break
        if not found:
            self.region_info.set(f'좌표 ({int(x)}, {int(y)}) | 검출 영역 바깥')
            return
        rid=found.get('id')
        typ=next((t for t in record.get('typesetting',[]) if t.get('region_id')==rid),{})
        self.selected_region = {'page':str(self.names[self.index][1]),'region':found,'typesetting':typ,'inpainting':record.get('inpainting',{})}
        ip=record.get('inpainting') or {}
        tiles=ip.get('tiles') or []
        x1,y1,w,h=found.get('bbox') or (0,0,0,0)
        hits=[t for t in tiles if len(t.get('roi',[]))==4 and x1 < t['roi'][0]+t['roi'][2] and x1+w > t['roi'][0] and y1 < t['roi'][1]+t['roi'][3] and y1+h > t['roi'][1]]
        mask_stats='저장된 마스크 없음'
        cache=data.get('cache_dir')
        p=Path(cache)/'mask.png' if cache else None
        if p and p.is_file() and w>0 and h>0:
            try:
                with Image.open(p) as mm:
                    mm=mm.convert('L'); tile=mm.crop((x1,y1,x1+w,y1+h))
                    hist=tile.histogram(); coverage=sum(hist[1:])/max(1,w*h)
                    mask_stats=f'{coverage:.1%} ({sum(hist[1:])}/{w*h} px, 마스크 PNG 실측)'
            except Exception as exc:mask_stats=f'마스크 읽기 실패: {exc}'
        detail=(f'영역 #{rid} | 검출 신뢰도: {found.get("detection_confidence","기록 없음")} | OCR: {found.get("selected_engine","기록 없음")}\n'
                f'OCR bbox: {found.get("bbox")} | OCR crop: {found.get("ocr_crop_bbox")} | polygon: {found.get("polygon")}\n'
                f'원문: {found.get("text","")}\n번역: {found.get("translated_text","")}\n'
                f'제거 마스크 커버리지: {mask_stats} | LaMa ROI: {[t.get("roi") for t in hits]} | 입력 배율: {[t.get("scale") for t in hits]}\n'
                f'LaMa: {ip.get("status","기록 없음")} / {ip.get("device","기록 없음")} | 글자: {typ.get("font_size","?")}px {typ.get("text_color","?")} | 외곽선: {typ.get("stroke_color")}, {typ.get("stroke_width",0)}px | 배경명도: {typ.get("background_luma","기록 없음")}')
        self.region_info.set(detail)
        self.render()

    def copy_selected(self):
        if self.selected_region is None:return
        self.clipboard_clear()
        self.clipboard_append(json.dumps(self.selected_region,ensure_ascii=False,indent=2))

    def zoom(self,factor):
        self.scale=max(.2,min(5.0,self.scale*factor))
        self.render()

    def fit(self):
        self.scale=1.0
        self.offset=[0,0]
        self.render()

    def goto(self,n):
        if not self.names:return
        self.index=min(max(0,n),len(self.names)-1)
        self.selected_region=None
        self.region_info.set('영역을 클릭하면 OCR·마스크·LaMa 입력 배율·식질 정보를 표시합니다.')
        self.fit()

    def step(self,d):self.goto(self.index+d)

    def add_live(self,source_path,entry,index,source,result,record=None,cache_dir=None):
        if not self.live:return
        key=(str(source_path),entry)
        if key not in self.pages:
            self.names.append(key)
        self.pages[key]={'source':source,'result':result,'record':record or {},'cache_dir':cache_dir}
        self.names.sort(key=lambda x:(x[0],natural_key(x[1])))
        if len(self.names)==1:
            self.goto(0)
        else:
            self.page_label.configure(text=f'{self.index+1}/{len(self.names)}')
        # Do not automatically change the selected page during active review.

    def open_files(self):
        source=filedialog.askopenfilename(parent=self,title='원본 일본어 ZIP',filetypes=[('ZIP','*.zip')])
        if not source:return
        result=filedialog.askopenfilename(parent=self,title='한국어 결과 ZIP',filetypes=[('ZIP','*.zip')])
        if not result:return
        proposed=str(Path(result).with_suffix(''))+'.metadata.json'
        meta=proposed if Path(proposed).exists() else filedialog.askopenfilename(parent=self,title='메타데이터 JSON (취소하면 영역 표시 제외)',filetypes=[('JSON','*.json')])
        try:
            with zipfile.ZipFile(source) as za, zipfile.ZipFile(result) as zb:
                orig={n for n in za.namelist() if not n.endswith('/')}
                done={n for n in zb.namelist() if not n.endswith('/')}
                names=sorted(orig&done,key=natural_key)
                if not names:raise ValueError('두 ZIP 사이에 일치하는 이미지 경로가 없습니다.')
                data=json.loads(Path(meta).read_text(encoding='utf-8')) if meta else {}
                records={r.get('entry_name'):r for r in data.get('images',[])}
                pages={}
                for n in names:
                    if Path(n).suffix.lower() not in ('.png','.jpg','.jpeg','.webp','.bmp'):continue
                    if za.getinfo(n).file_size > 64*1024*1024 or zb.getinfo(n).file_size > 64*1024*1024:continue
                    cache_dir=Path(str(result)+'.layers')/f'page_{records[n]["index"]+1:04d}' if n in records else None
                    pages[(source,n)]={'source':za.read(n),'result':zb.read(n),'record':records.get(n,{}),'cache_dir':cache_dir}
            if not pages:raise ValueError('비교 가능한 이미지가 없습니다.')
            self.live=False
            self.pages=pages
            self.names=list(pages)
            self.source_zip=source
            self.result_zip=result
            self.meta_path=meta
            self.meta=data
            self.goto(0)
        except Exception as exc:
            messagebox.showerror('파일 열기 실패',str(exc),parent=self)

    def render(self):
        if not self.names:
            for c in self.images.values():
                c.delete('all'); c.create_text(max(40,c.winfo_width()//2),max(40,c.winfo_height()//2),text='검수할 페이지가 없습니다',fill='#ddd')
            return
        key=self.names[self.index]
        data=self.pages[key]
        record=data.get('record') or {}
        self.page_label.configure(text=f'{self.index+1}/{len(self.names)} · {key[1]}')
        for kind,canvas in self.images.items():
            canvas.delete('all')
            raw=data.get(kind)
            if not raw:
                canvas.create_text(canvas.winfo_width()//2,canvas.winfo_height()//2,text='이미지 없음',fill='white')
                continue
            try:
                with Image.open(io.BytesIO(raw)) as original:
                    im=original.convert('RGB')
                iw,ih=im.size
                cw=max(100,canvas.winfo_width())
                ch=max(100,canvas.winfo_height())
                ratio=min((cw-15)/iw,(ch-15)/ih)*self.scale
                dw=max(1,round(iw*ratio));dh=max(1,round(ih*ratio))
                if dw*dh>24_000_000:
                    canvas.create_text(cw//2,ch//2,text='확대 크기가 너무 큽니다. 축소해 주세요.',fill='white');continue
                im=im.resize((dw,dh),Image.Resampling.LANCZOS)
                # Masks and rectangles are overlays and never modify the saved output image.
                if self.show_mask.get():
                    cache_dir=data.get('cache_dir')
                    mask_path=Path(cache_dir)/'mask.png' if cache_dir else None
                    if mask_path and mask_path.is_file():
                        from PIL import Image as PILImage
                        with PILImage.open(mask_path) as mask:
                            mask=mask.convert('L').resize((dw,dh),PILImage.Resampling.NEAREST)
                        layer=PILImage.new('RGB',(dw,dh),(255,170,20))
                        im=PILImage.composite(layer,im,mask.point(lambda x:min(105,int(x*.35))))
                photo=ImageTk.PhotoImage(im,master=canvas)
                self.photos[kind]=photo
                cx=cw//2+self.offset[0];cy=ch//2+self.offset[1]
                canvas.create_image(cx,cy,image=photo)
                left=cx-dw/2;top=cy-dh/2
                if self.show_roi.get():
                    for ti,t in enumerate((record.get('inpainting') or {}).get('tiles') or []):
                        roi=t.get('roi') or []
                        if len(roi)!=4:continue
                        x,y,w,h=roi
                        canvas.create_rectangle(left+x*ratio,top+y*ratio,left+(x+w)*ratio,top+(y+h)*ratio,outline='#b96bff',dash=(6,3),width=2)
                        canvas.create_text(left+x*ratio,top+y*ratio,anchor='sw',text=f'ROI{ti+1} scale={t.get("scale","?")}',fill='#ddacff')
                for check,regions,color in [
                    (self.show_ocr.get(),record.get('regions',[]),'#ff4d4d'),
                    (self.show_crop.get(),[{**r,'bbox':r.get('ocr_crop_bbox')} for r in record.get('regions',[])],'#43a5ff'),
                    (self.show_layout.get(),record.get('typesetting',[]),'#42df78')]:
                    if not check:continue
                    for r in regions:
                        bbox=r.get('bbox')
                        if not isinstance(bbox,(list,tuple)) or len(bbox)!=4:continue
                        x,y,w,h=bbox
                        canvas.create_rectangle(left+x*ratio,top+y*ratio,left+(x+w)*ratio,top+(y+h)*ratio,outline=color,width=2)
                        canvas.create_text(left+x*ratio,top+y*ratio,anchor='sw',text=str(r.get('id',r.get('region_id',''))),fill=color)
                        if self.show_numbers.get():canvas.create_text(left+x*ratio,top+(y+h)*ratio,anchor='nw',text=f'({x},{y}) {w}x{h}',fill=color)
                if self.show_confidence.get():
                    for r in record.get('regions',[]):
                        bb=r.get('bbox') or []
                        if len(bb)!=4:continue
                        x,y,w,h=bb
                        canvas.create_text(left+x*ratio,top+y*ratio,anchor='sw',text=f'#{r.get("id","?")} conf={r.get("detection_confidence","?")}',fill='#facc15')
            except Exception as exc:
                canvas.create_text(canvas.winfo_width()//2,canvas.winfo_height()//2,text=str(exc),fill='white')
        regions=record.get('regions',[])
        self.status.set(f'{key[1]} | 영역 {len(regions)}개 | LaMa {record.get("inpainting",{}).get("status","정보 없음")} | 마우스 휠/← →: 페이지 이동 · Ctrl+휠: 확대 · 드래그: 이동 · R: 화면 맞춤')
