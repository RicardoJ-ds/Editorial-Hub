"""Editorial warehouse — layered raw → int → views build (branch refactor).

See etl/WAREHOUSE_DESIGN.md for the schema and the bug-for-bug parity rules.
Run inside the backend container:
    python -m etl.warehouse.run [--scope current|past|full] [--layers raw,int,views]
    python -m etl.warehouse.parity
"""
