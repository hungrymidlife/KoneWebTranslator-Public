"""Experiment: pixel-measured balanced Korean lines with bounded DP.

Preserves explicit paragraph boundaries; returns None if a word is too wide.
Never called for manually edited layer rendering, only automatic typesetting.
"""
from functools import lru_cache

def balanced_lines(draw, text, font, max_width, stroke):
    paragraphs=str(text).replace('\r\n','\n').replace('\r','\n').split('\n')
    out=[]
    for paragraph in paragraphs:
        words=paragraph.split()
        if not words:
            out.append('');continue
        if len(words)>180:return None
        @lru_cache(maxsize=4096)
        def width(s):
            return draw.textlength(s,font=font)+2*stroke
        if any(width(w)>max_width for w in words):
            return None
        n=len(words)
        dp=[(float('inf'),[]) for _ in range(n+1)]
        dp[n]=(0,[])
        for i in range(n-1,-1,-1):
            line=''
            for j in range(i,min(n,i+45)):
                line=(line+' '+words[j]) if line else words[j]
                measured=width(line)
                if measured>max_width:break
                unused=max(0,max_width-measured)/max(1,max_width)
                # Non-final lines prefer even length; final lines may be short.
                penalty=unused**2*(0.20 if j==n-1 else 1.0)
                cost=penalty+dp[j+1][0]
                if cost<dp[i][0]:
                    dp[i]=(cost,[line]+dp[j+1][1])
        if not dp[0][1]:return None
        out.extend(dp[0][1])
    return out
