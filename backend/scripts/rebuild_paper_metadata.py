from __future__ import annotations

import json

from config import supabase
from papers import refresh_paper_publish_state


def main() -> int:
    rows = []
    offset = 0
    while True:
        res = (
            supabase.table("papers")
            .select("id, exam_name, exam_year, upload_version")
            .order("exam_name")
            .order("exam_year")
            .order("upload_version")
            .range(offset, offset + 999)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    for row in rows:
        refresh_paper_publish_state(row.get("id"), sb=supabase)

    print(json.dumps({
        "status": "ok",
        "papers_rebuilt": len(rows),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
