#!/usr/bin/env sh
cd "$(dirname "$0")"
echo "This will DELETE ALL DATA in the database and reload the demo data."
printf "Type YES to continue: "
read ok
[ "$ok" = "YES" ] || { echo Cancelled.; exit 0; }
.venv/bin/python -m database.seed --reset
