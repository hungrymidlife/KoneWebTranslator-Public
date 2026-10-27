"""Apply the selected Studio default font to existing auto-typeset layers.

Uses Project.save() deliberately: preserves its ZIP/sidecar/metadata backups and
all other layer attributes. Manual layers are not modified.
"""
from font_library import default_font_id


def apply_default_font(project):
    target=default_font_id()
    if project.state != 'completed' or not project.result.is_file():
        raise ValueError('완료된 번역 ZIP에서만 폰트를 일괄 적용할 수 있습니다.')
    processed=0
    changed=0
    skipped=0
    errors=[]
    # Project.save holds project.lock and persists each completed page using
    # the existing backup/metadata convention; no new file format.
    with project.lock:
        for index, name in enumerate(project.names):
            record=project.records.get(name)
            if not record:
                skipped+=1
                continue
            if not project.background_path(name,record).is_file():
                skipped+=1
                errors.append(f'{name}: 복원 배경 없음')
                continue
            page=project.page_data(index)
            # Leave manually-created text boxes unchanged.
            auto=[layer for layer in page['layers']
                  if not layer['region_id'].startswith('manual-')]
            edits=[{**layer,'font_id':target} for layer in auto
                   if layer.get('font_id','system') != target]
            if not edits:
                processed+=1
                continue
            try:
                project.save(index,edits)
            except Exception as exc:
                errors.append(f'{name}: {type(exc).__name__}: {exc}')
                skipped+=1
                continue
            processed+=1
            changed+=len(edits)
    return {'ok':not errors, 'font_id':target,'processed_pages':processed,
            'changed_boxes':changed,'skipped_pages':skipped,'errors':errors[:15]}
