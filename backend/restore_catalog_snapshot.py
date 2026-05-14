from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from config import supabase


def _chunked(seq: list[str], size: int) -> list[list[str]]:
    return [seq[i:i + size] for i in range(0, len(seq), size)]


def restore_snapshot(snapshot_path: str) -> dict[str, Any]:
    path = Path(snapshot_path)
    if not path.exists():
        raise FileNotFoundError(f"Snapshot not found: {snapshot_path}")

    payload = json.loads(path.read_text())
    selected_ids = sorted({str(qid).strip() for qid in (payload.get("question_ids") or []) if str(qid).strip()})
    if not selected_ids:
        return {"restored": 0, "updated_true": 0, "updated_false": 0, "snapshot_path": str(path.resolve())}

    existing_true: list[str] = []
    offset = 0
    while True:
        batch = (
            supabase.table("questions")
            .select("id")
            .eq("practice_ready", True)
            .range(offset, offset + 999)
            .execute()
            .data
            or []
        )
        existing_true.extend(str(row["id"]) for row in batch if row.get("id"))
        if len(batch) < 1000:
            break
        offset += 1000

    selected_set = set(selected_ids)
    existing_set = set(existing_true)
    to_enable = sorted(selected_set - existing_set)
    to_disable = sorted(existing_set - selected_set)

    for chunk in _chunked(to_enable, 200):
        supabase.table("questions").update({"practice_ready": True}).in_("id", chunk).execute()
    for chunk in _chunked(to_disable, 200):
        supabase.table("questions").update({"practice_ready": False}).in_("id", chunk).execute()

    return {
        "restored": len(selected_ids),
        "updated_true": len(to_enable),
        "updated_false": len(to_disable),
        "snapshot_path": str(path.resolve()),
        "label": payload.get("label"),
        "created_at": payload.get("created_at"),
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python restore_catalog_snapshot.py SNAPSHOT_PATH")
        return 1
    result = restore_snapshot(sys.argv[1])
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
