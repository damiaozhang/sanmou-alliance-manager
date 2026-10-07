import re

def fix_or_empty_string(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()
    
    # Fix: || ", -> || "",
    data = data.replace(b'|| ",', b'|| "",')
    
    # Fix: || " } -> || "" }
    data = data.replace(b'|| " }', b'|| "" }')
    
    # Fix: || ") -> || "")
    data = data.replace(b'|| ")', b'|| "")')
    
    with open(filepath, 'wb') as f:
        f.write(data)
    
    print(f'Fixed: {filepath}')

import glob
for pattern in ['src/pages/*.tsx', 'src/App.tsx']:
    for filepath in glob.glob(pattern):
        fix_or_empty_string(filepath)
