import json
from pathlib import Path
from datetime import datetime, timezone
from graphify.detect import save_manifest

try:
    with open('graphify-out/.graphify_detect.json', 'r', encoding='utf-8-sig') as f:
        detect = json.loads(f.read())
except Exception:
    detect = {'files': {}}
save_manifest(detect['files'])

extract = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding='utf-8'))
input_tok = extract.get('input_tokens', 0)
output_tok = extract.get('output_tokens', 0)

cost_path = Path('graphify-out/cost.json')
if cost_path.exists():
    cost = json.loads(cost_path.read_text(encoding='utf-8'))
else:
    cost = {'runs': [], 'total_input_tokens': 0, 'total_output_tokens': 0}

cost['runs'].append({
    'date': datetime.now(timezone.utc).isoformat(),
    'input_tokens': input_tok,
    'output_tokens': output_tok,
    'files': detect.get('total_files', 0),
})
cost['total_input_tokens'] += input_tok
cost['total_output_tokens'] += output_tok
cost_path.write_text(json.dumps(cost, indent=2), encoding='utf-8')

for f in ['.graphify_ast.json', '.graphify_semantic.json', '.graphify_extract.json']:
    if Path(f'graphify-out/{f}').exists():
        Path(f'graphify-out/{f}').unlink()

print('Done.')
