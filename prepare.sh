#!/bin/sh

sed -e 's/{{PRE_RUN_ADDITIONS}}/\n#include "pre-run.js"/g' \
    -e 's/{{PREAMBLE_ADDITIONS}}/\n#include "preamble.js"/g' \
    -e 's/var exports = null;/var exports = null; global_info = info;/g' \
    -e 's/updateGlobalBufferViews();/updateGlobalBufferViews(); addHeapHooks();/g' \
    $1 > $1.tmp.js

echo "var source_file = \"$1\";" > $1.prep.js
cpp -P $1.tmp.js >> $1.prep.js

