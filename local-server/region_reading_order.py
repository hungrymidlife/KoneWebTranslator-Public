"""Deterministic manga-text region order; keep mixed-orientation model order."""
def reading_order(regions):
    regions=list(regions)
    if len(regions)<2: return regions
    vertical=[r for r in regions if r.height>1.25*max(1,r.width)]
    if len(vertical)==len(regions):
        # Japanese vertical columns run right to left, then top to bottom.
        return sorted(regions,key=lambda r:(-(r.x+r.width/2),r.y,-r.confidence))
    if not vertical:
        median=sorted(r.height for r in regions)[len(regions)//2]
        band=max(8,round(median*0.6))
        return sorted(regions,key=lambda r:(r.y//band,r.x,r.y))
    return regions
