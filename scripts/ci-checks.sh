#!/bin/bash
set -Eeuo pipefail
for file in admin/*.mjs admin/public/*.js tests/*.mjs; do node --check "$file"; done
python3 -m compileall -q scripts tests
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.mjs
