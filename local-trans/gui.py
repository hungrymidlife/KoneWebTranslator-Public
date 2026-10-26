import io
import queue
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk
from PIL import Image, ImageTk, ImageOps
from zip_pipeline import request, process_zip
from review_viewer import ReviewViewer

class App:
    def __init__(self, root):
        self.root = root
        root.title('KoneWebTranslator | Local ZIP Translator V07 (검수 뷰어)')
        root.geometry('1160x850')
        root.minsize(830, 660)
        self.files = []
        self.events = queue.Queue()
        self.stop = threading.Event()
        self.running = False
        self.started = None
        self.current = (0, 0)
        self.viewer = None
        self.pending_sources = {}
        self.live_pages = {}
        self.photos = {}
        self.raw_previews = {}
        self.text_color_mode = tk.StringVar(value='auto')
        self.output = tk.StringVar(value=str(Path.home() / 'KoneWebTranslator_Output'))
        toolbar = ttk.Frame(root, padding=6)
        toolbar.pack(fill='x')
        ttk.Button(toolbar, text='ZIP 여러 개 추가', command=self.add).pack(side='left')
        ttk.Button(toolbar, text='선택 제거', command=self.remove).pack(side='left', padx=5)
        ttk.Button(toolbar, text='모두 비우기', command=self.clear).pack(side='left')
        ttk.Button(toolbar, text='서버 확인', command=self.health).pack(side='right')
        ttk.Button(toolbar, text='검수 뷰어 열기', command=self.open_review).pack(side='right', padx=8)
        out = ttk.Frame(root, padding=(6,2))
        out.pack(fill='x')
        ttk.Label(out, text='출력 폴더').pack(side='left')
        ttk.Entry(out, textvariable=self.output).pack(side='left', fill='x', expand=True, padx=6)
        ttk.Button(out, text='선택', command=self.choose_output).pack(side='left')
        ttk.Label(out, text='글자색').pack(side='left', padx=(12,3))
        self.color_select = ttk.Combobox(out, state='readonly', width=12, textvariable=self.text_color_mode,
                                         values=('auto','black','white'))
        self.color_select.pack(side='left')
        self.tree = ttk.Treeview(root, columns=('state','path'), show='headings', height=5)
        self.tree.heading('state', text='상태')
        self.tree.heading('path', text='ZIP 파일 경로')
        self.tree.column('state', width=175, stretch=False)
        self.tree.column('path', width=700)
        self.tree.pack(fill='x', padx=6, pady=5)
        command = ttk.Frame(root, padding=6)
        command.pack(fill='x')
        self.start_btn = ttk.Button(command, text='전체 순차 실행', command=self.start)
        self.start_btn.pack(side='left')
        ttk.Button(command, text='현재 작업 후 중지', command=self.cancel).pack(side='left', padx=5)
        self.state = tk.StringVar(value='대기 중 - OCR 서버(8765), Gemma 서버(18080)를 먼저 실행하세요.')
        ttk.Label(command, textvariable=self.state).pack(side='left', padx=10)
        self.bar = ttk.Progressbar(root, maximum=100, mode='determinate')
        self.bar.pack(fill='x', padx=10)
        self.detail = tk.StringVar(value='현재 페이지: -  |  단계: -  |  경과: 0초')
        ttk.Label(root, textvariable=self.detail).pack(fill='x', padx=10, pady=(4,2))
        previews = ttk.Frame(root, padding=6)
        previews.pack(fill='both', expand=True)
        previews.columnconfigure(0, weight=1)
        previews.columnconfigure(1, weight=1)
        previews.rowconfigure(0, weight=1)
        for col, title, kind in ((0,'원본 이미지','source'),(1,'식질 결과','result')):
            frame = ttk.LabelFrame(previews, text=title, padding=4)
            frame.grid(row=0,column=col,sticky='nsew',padx=3)
            label = tk.Label(frame, text='이미지 대기 중', bg='#292929', fg='#eeeeee')
            label.pack(fill='both', expand=True)
            label.bind('<Configure>', lambda event,k=kind:self.render(k))
            setattr(self, 'preview_'+kind, label)
        ttk.Label(root,text='작업 로그').pack(anchor='w',padx=10)
        self.log = tk.Text(root, height=6, wrap='word')
        self.log.pack(fill='x', padx=10, pady=(0,8))
        root.after(150,self.drain)
        root.after(1000,self.tick)

    def open_review(self):
        if self.viewer is None or not self.viewer.winfo_exists():
            self.viewer = ReviewViewer(self.root)
            for key, value in self.live_pages.items():
                self.viewer.add_live(*value)
        else:
            self.viewer.lift()
            self.viewer.focus_set()

    def add(self):
        for path in filedialog.askopenfilenames(title='ZIP 파일 선택', filetypes=[('ZIP files','*.zip')]):
            path = str(Path(path).resolve())
            if path not in self.files:
                self.files.append(path)
                self.tree.insert('', 'end', iid=str(len(self.files)-1), values=('대기',path))

    def remove(self):
        if self.running: return
        for iid in self.tree.selection(): self.tree.delete(iid)
        self.files = [self.tree.set(i,'path') for i in self.tree.get_children()]
        for iid in self.tree.get_children(): self.tree.delete(iid)
        for index,path in enumerate(self.files): self.tree.insert('','end',iid=str(index),values=('대기',path))

    def clear(self):
        if self.running: return
        self.files.clear()
        for iid in self.tree.get_children():self.tree.delete(iid)

    def choose_output(self):
        path=filedialog.askdirectory()
        if path:self.output.set(path)

    def health(self):
        try:self.state.set('OCR 서버 연결: '+str(request('/health'))[:240])
        except Exception as exc:self.state.set('OCR 서버 연결 실패: '+str(exc))

    def start(self):
        if self.running or not self.files:return
        self.running=True
        self.stop.clear()
        self.started=time.monotonic()
        self.current=(0,0)
        self.pending_sources.clear()
        self.live_pages.clear()
        if self.viewer and self.viewer.winfo_exists():
            self.viewer.live=True
            self.viewer.pages.clear()
            self.viewer.names.clear()
            self.viewer.render()
        self.start_btn.configure(state='disabled')
        self.color_select.configure(state='disabled')
        self.bar['value']=0
        threading.Thread(target=self.run,daemon=True).start()

    def cancel(self):
        if self.running:
            self.stop.set()
            self.state.set('중지 요청됨 (현재 서버 작업은 계속될 수 있음)')

    def run(self):
        try:
            for index,path in enumerate(self.files):
                if self.stop.is_set():break
                self.events.put(('row',index,'진행 중'))
                try:
                    result, meta = process_zip(path,self.output.get(), report=lambda msg:self.events.put(('log',msg)),cancelled=self.stop.is_set,progress=lambda **kw:self.events.put(('progress',index,kw)),
                                               text_color_mode=self.text_color_mode.get())
                    self.events.put(('row',index,'완료'))
                    self.events.put(('log',f'완료: {result}\n메타데이터: {meta}'))
                except InterruptedError:
                    self.events.put(('row',index,'중지됨'))
                    break
                except Exception as exc:
                    self.events.put(('row',index,'실패'))
                    self.events.put(('log',f'실패: {path}\n{type(exc).__name__}: {exc}'))
        finally:self.events.put(('done',))

    def render(self, kind):
        label=getattr(self,'preview_'+kind)
        raw=self.raw_previews.get(kind)
        if not raw:return
        width=max(80,label.winfo_width()-12)
        height=max(80,label.winfo_height()-12)
        try:
            with Image.open(io.BytesIO(raw)) as opened:
                im=ImageOps.exif_transpose(opened)
                im.thumbnail((width,height),Image.Resampling.LANCZOS)
                preview=im.convert('RGB')
            photo=ImageTk.PhotoImage(preview,master=self.root)
            self.photos[kind]=photo
            label.configure(image=photo,text='')
        except Exception as exc:
            label.configure(image='',text=f'미리보기 실패: {exc}')

    def drain(self):
        try:
            for _ in range(150):
                event=self.events.get_nowait()
                kind=event[0]
                if kind=='row':
                    index,status=event[1:]
                    if self.tree.exists(str(index)):
                        self.tree.set(str(index),'state',status)
                        self.tree.see(str(index))
                    self.state.set(f'{index+1}/{len(self.files)} - {status}')
                elif kind=='log':
                    self.log.insert('end',event[1]+'\n')
                    self.log.see('end')
                elif kind=='progress':
                    index,values=event[1:]
                    page,total=values.get('page',0),values.get('total',0)
                    stage=values.get('stage','진행 중')
                    detail=values.get('detail','')
                    self.current=(page,total)
                    # Count completed pages; a running page must not be marked completed.
                    completed=max(0,page-1) if stage not in ('페이지 완료','ZIP 검증 및 메타데이터 저장','ZIP 저장 완료') else page
                    self.bar['value']=round(100*completed/total,1) if total else 0
                    self.state.set(f'{index+1}/{len(self.files)} ZIP | {page}/{total} 페이지 | {stage}')
                    self._stage=stage+((' / '+detail) if detail else '')
                    self.detail.set(f'현재 페이지: {page}/{total}  |  단계: {self._stage}  |  경과: {int(time.monotonic()-self.started)}초')
                    if values.get('name') and values.get('image_kind')=='source' and values.get('image') is not None:
                        self.pending_sources[(index,values['name'])]=values['image']
                    if values.get('record') is not None and values.get('image_kind')=='result':
                        name=values.get('name')
                        source=self.pending_sources.pop((index,name),None)
                        result=values.get('image')
                        if source is not None and result is not None:
                            path=self.files[index]
                            rec=values['record']
                            self.live_pages[(path,name)]=(path,name,index,source,result,rec,rec.get('inpainting',{}).get('cache_path'))
                            if self.viewer and self.viewer.winfo_exists() and self.viewer.live:
                                self.viewer.add_live(*self.live_pages[(path,name)])
                    if values.get('image') is not None:
                        preview_kind=values.get('image_kind')
                        if preview_kind in ('source','result'):
                            if preview_kind=='source':
                                self.raw_previews.pop('result',None)
                                self.photos.pop('result',None)
                                self.preview_result.configure(image='',text='식질 처리 대기 중')
                            self.raw_previews[preview_kind]=values['image']
                            self.render(preview_kind)
                elif kind=='done':
                    self.running=False
                    self.start_btn.configure(state='normal')
                    self.color_select.configure(state='readonly')
                    self.state.set('작업 종료')
        except queue.Empty:pass
        self.root.after(150,self.drain)

    def tick(self):
        if self.running and self.started:
            page,total=self.current
            self.detail.set(f'현재 페이지: {page}/{total}  |  단계: {getattr(self,"_stage","대기")}  |  경과: {int(time.monotonic()-self.started)}초')
        self.root.after(1000,self.tick)

if __name__=='__main__':
    root=tk.Tk()
    App(root)
    root.mainloop()
