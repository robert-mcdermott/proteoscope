# Makes a Python 3 copy of Capra & Singh's score_conservation.py (Python 2) for
# conservation-reference.mjs: tabs expanded to 8 columns (Python 2's reading), print statements
# as print(), "except E, e" as "except E as e", list(map(...)), and scores printed with 12
# decimals instead of 5. The scorer itself is not part of Proteoscope.
#
#   python3 validation/scripts/port-score-conservation.py /path/to/conservation_code
import os
import re
import sys

folder = sys.argv[1]
source = open(os.path.join(folder, 'score_conservation.py')).read().expandtabs(8)
lines = []
in_usage = False
for line in source.split('\n'):
    if re.match(r'^\s*print """', line):
        line = line.replace('print """', 'print("""', 1)
        in_usage = True
    elif in_usage and line.strip() == '"""':
        line = line.replace('"""', '""")')
        in_usage = False
    else:
        match = re.match(r'^(\s*(?:else:\s*)?)print (.*)$', line)
        if match and not in_usage:
            line = '%sprint(%s)' % (match.group(1), match.group(2))
    line = re.sub(r'except (\w+), e:', r'except \1 as e:', line)
    line = line.replace('distribution = map(float, distribution)', 'distribution = list(map(float, distribution))')
    line = line.replace('"%d\\t%s\\t%.5f"', '"%d\\t%s\\t%.12f"').replace('"%d\\t%s\\t%5f\\n"', '"%d\\t%s\\t%.12f\\n"')
    line = line.replace('"%d\\t%.5f\\t%s"', '"%d\\t%.12f\\t%s"').replace('"%d\\t%5f\\t%s\\n"', '"%d\\t%.12f\\t%s\\n"')
    lines.append(line)
open(os.path.join(folder, 'score_conservation_py3.py'), 'w').write('\n'.join(lines))
