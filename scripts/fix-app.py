import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix all instances of ", where a closing quote is missing
# Pattern: ", followed by something that's not a quote
# This is a common corruption pattern

# Fix: replaceState(null, ", hash) -> replaceState(null, "", hash)
content = content.replace('replaceState(null, ",', 'replaceState(null, "",')

# Fix: : ", -> : "",  (already done but let's be sure)
content = content.replace(': ",', ': "",')

# Fix: return "; -> return "";
content = content.replace('return ";', 'return "";')

# Fix: /g, ") -> /g, "")
content = content.replace('/g, ")', '/g, "")')

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed App.tsx')
