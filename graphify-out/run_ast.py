import sys, json
from graphify.extract import collect_files, extract
from pathlib import Path

code_files = []
try:
    with open('graphify-out/.graphify_detect.json', 'r', encoding='utf-8-sig') as f:
        detect = json.loads(f.read())
    for f in detect.get('files', {}).get('code', []):
        p = Path(f)
        code_files.extend(collect_files(p) if p.is_dir() else [p])
    if code_files:
        result = extract(code_files, cache_root=Path('.'))
        Path('graphify-out/.graphify_ast.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(f"AST: {len(result['nodes'])} nodes, {len(result['edges'])} edges")
    else:
        Path('graphify-out/.graphify_ast.json').write_text(json.dumps({'nodes':[],'edges':[],'input_tokens':0,'output_tokens':0}), encoding='utf-8')
        print('No code files - skipping AST extraction')
except Exception as e:
    import traceback
    traceback.print_exc()
