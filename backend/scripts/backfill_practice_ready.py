from __future__ import annotations

import json
import sys

from papers import recompute_practice_ready_for_all, recompute_practice_ready_for_exam


def main() -> int:
    if len(sys.argv) == 3:
        exam_name = sys.argv[1]
        exam_year = int(sys.argv[2])
        result = recompute_practice_ready_for_exam(exam_name, exam_year)
    elif len(sys.argv) == 1:
        result = recompute_practice_ready_for_all()
    else:
        print("Usage: python backfill_practice_ready.py [EXAM_NAME EXAM_YEAR]")
        return 2

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
