with open('index.html', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace('\r\n', '\n')

# Fix 1: loadFromLocal should always return {tasks, groups} object
# The current code returns an object, but init() assigns it directly to this.tasks
# We need to fix init() to properly destructure the result

# Find the init method and fix the data loading logic
# The problem: after loadFromLocal returns {tasks:[], groups:[]}, 
# the code does this.tasks = this._ds.loadFromLocal() which makes this.tasks an object not array

# Fix: Replace the raw assignment in init to properly handle the new format
old_assign = 'this.tasks = this._ds.loadFromLocal();'
new_assign = 'raw = this._ds.loadFromLocal();'
if old_assign in c:
    c = c.replace(old_assign, new_assign, 1)
    print("OK: Fixed loadFromLocal assignment")

# Now we need to ensure raw is properly handled after this point
# The code after should use raw.tasks and raw.groups
# Check if there's already a raw variable handling
if 'if (Array.isArray(raw))' not in c:
    # Add array check after the assignment
    # Find the line after our replacement and add the check
    marker = 'raw = this._ds.loadFromLocal();'
    idx = c.find(marker)
    if idx >= 0:
        # Find the end of this line
        line_end = c.find('\n', idx)
        if line_end >= 0:
            check = '\n        if (Array.isArray(raw)) { raw = { tasks: raw, groups: [] }; }\n        this.tasks = raw.tasks || [];\n        this.groups = raw.groups || [];'
            c = c[:line_end] + check + c[line_end:]
            print("OK: Added array check and proper assignment")
    else:
        print("WARN: Could not find marker")
else:
    print("SKIP: Array check already exists")

# Also fix the file system loading path
old_fs = 'this.tasks = await this._ds.loadFromFile();'
if old_fs in c:
    c = c.replace(old_fs, 'raw = await this._ds.loadFromFile();', 1)
    print("OK: Fixed loadFromFile assignment")

# Make sure raw is declared before use
if 'let raw;' not in c and 'let raw = ' not in c:
    # Add raw declaration at start of init
    init_start = c.find('async init()')
    if init_start >= 0:
        # Find the opening brace
        brace = c.find('{', init_start)
        if brace >= 0:
            c = c[:brace+1] + '\n        let raw;' + c[brace+1:]
            print("OK: Added raw variable declaration")

with open('index.html', 'w', encoding='utf-8', newline='\n') as f:
    f.write(c)

print(f"Lines: {c.count(chr(10))+1}")
