from typing import Callable


def _apply_public_question_order(query, supported_cols: set[str], *, question_first: bool = False):
    if question_first:
        query = query.order("question_number", desc=False)
        if "updated_at" in supported_cols:
            query = query.order("updated_at", desc=True)
        return query.order("created_at", desc=True).order("id", desc=False)
    if "updated_at" in supported_cols:
        query = query.order("updated_at", desc=True)
    return query.order("created_at", desc=True).order("id", desc=False)


def collect_public_question_meta_rows(
    *,
    supabase,
    supported_cols: set[str],
    select_clause: str,
    publishable_ids: set[str] | None,
    publishable_exam_keys: set[tuple[str, int]] | None,
    apply_public_question_filter: Callable,
    row_matches_selected_papers: Callable,
    public_row_identity: Callable,
) -> list[dict]:
    all_data: list[dict] = []
    seen_keys: set[tuple[str, ...]] = set()
    offset = 0

    while True:
        query = apply_public_question_filter(
            supabase.table("questions").select(select_clause),
            supported_cols,
        )
        result = _apply_public_question_order(query, supported_cols).range(offset, offset + 999).execute()
        batch = result.data or []

        for row in batch:
            if not row_matches_selected_papers(row, publishable_ids):
                continue
            if publishable_exam_keys is not None and not row.get("paper_id"):
                exam_name = str(row.get("exam_name") or "")
                exam_year = int(row.get("exam_year") or 0)
                if exam_name and exam_year > 0 and (exam_name, exam_year) in publishable_exam_keys:
                    continue
            row_key = public_row_identity(row, scoped_by_selector=True)
            if row_key in seen_keys:
                continue

            seen_keys.add(row_key)
            all_data.append({
                "id": row.get("id"),
                "exam_name": row.get("exam_name"),
                "exam_year": row.get("exam_year"),
                "subject": row.get("canonical_subject") or row.get("subject"),
                "topic": row.get("canonical_topic_family") or row.get("topic"),
                "subtopic": row.get("canonical_subtopic_family") or row.get("subtopic"),
                "difficulty": row.get("difficulty"),
                "paper_id": row.get("paper_id"),
            })

        if len(batch) < 1000:
            break
        offset += 1000

    return all_data


def collect_public_exam_rows(
    *,
    exam_name: str | None,
    exam_year: int | None,
    paper_id: str | None,
    shift_label: str | None,
    subject: str | None,
    topic: str | None,
    subtopic: str | None,
    difficulty: str | None,
    search: str | None,
    scoped_by_selector: bool,
    normalize_exam_name: Callable,
    exam_qs_cache: dict,
    exam_qs_cache_ttl_public: int,
    now_ts: float,
    public_include_all_questions: Callable,
    question_supported_columns: Callable,
    practice_ready_mode: Callable,
    latest_live_paper_ids: Callable,
    latest_live_exam_keys: Callable,
    get_publishable_paper_ids: Callable,
    question_select_clause: Callable,
    apply_public_question_filter: Callable,
    supabase,
    row_matches_selected_papers: Callable,
    public_row_identity: Callable,
    sanitize_public_question_row: Callable,
    row_matches_search: Callable,
    merge_public_duplicate_row: Callable,
) -> list[dict]:
    normalized_exam_name = normalize_exam_name(exam_name) if exam_name else None
    use_cache = (
        normalized_exam_name
        and exam_year
        and not paper_id
        and not shift_label
        and not subject
        and not topic
        and not subtopic
        and not difficulty
        and not search
        and not scoped_by_selector
    )
    cache_key = (normalized_exam_name or "", exam_year or 0, False)
    if use_cache:
        cached_ts, cached_rows = exam_qs_cache.get(cache_key, (0.0, []))
        if cached_rows and (now_ts - cached_ts) < exam_qs_cache_ttl_public:
            return cached_rows
    scoped_question_order = bool(normalized_exam_name or exam_year or paper_id or shift_label)

    include_all = public_include_all_questions()
    supported_cols = question_supported_columns()
    practice_mode = practice_ready_mode(supported_cols)
    if normalized_exam_name or exam_year:
        publishable_paper_ids = None if (include_all or practice_mode) else latest_live_paper_ids(
            exam_name=normalized_exam_name,
            exam_year=exam_year,
            sb=supabase,
        )
        publishable_keys = None if (include_all or practice_mode) else latest_live_exam_keys(
            exam_name=normalized_exam_name,
            exam_year=exam_year,
            sb=supabase,
        )
    else:
        publishable_paper_ids = None if (include_all or practice_mode) else get_publishable_paper_ids()
        publishable_keys = None

    has_canonical_subject = "canonical_subject" in supported_cols
    has_canonical_topic = "canonical_topic_family" in supported_cols
    has_canonical_subtopic = "canonical_subtopic_family" in supported_cols
    subject_col = "canonical_subject" if has_canonical_subject else "subject"
    topic_col = "canonical_topic_family" if has_canonical_topic else "topic"
    subtopic_col = "canonical_subtopic_family" if has_canonical_subtopic else "subtopic"

    if (
        (not include_all)
        and normalized_exam_name
        and exam_year
        and publishable_keys is not None
        and (normalized_exam_name, exam_year) not in publishable_keys
    ):
        return []

    select_clause = question_select_clause([
        "id", "question_text", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "correct_answers", "answer_status", "subject", "topic", "subtopic", "difficulty", "exam_name", "exam_year",
        "question_type", "concept", "question_number", "needs_review", "passage", "has_image", "image_url", "paper_id", "practice_ready", "shift_label",
        "pattern_tag", "trap_tag", "skill_tag", "question_style", "pattern_confidence", "pattern_reason", "solve_hint",
        "question_hash", "created_at", "updated_at",
    ], supported_cols)

    all_data: list[dict] = []
    row_index_by_key: dict[tuple[str, ...], int] = {}
    scan_offset = 0
    while True:
        query = apply_public_question_filter(supabase.table("questions").select(select_clause), supported_cols)

        if subject and has_canonical_subject:
            query = query.eq(subject_col, subject)
        if topic and has_canonical_topic:
            query = query.eq(topic_col, topic)
        if subtopic and has_canonical_subtopic:
            query = query.eq(subtopic_col, subtopic)
        if normalized_exam_name:
            query = query.eq("exam_name", normalized_exam_name)
        if exam_year:
            query = query.eq("exam_year", exam_year)
        if paper_id:
            query = query.eq("paper_id", paper_id)
        if shift_label:
            query = query.eq("shift_label", shift_label)
        if difficulty:
            query = query.eq("difficulty", difficulty)

        query = _apply_public_question_order(
            query,
            supported_cols,
            question_first=scoped_question_order,
        ).range(scan_offset, scan_offset + 999)
        result = query.execute()
        batch = result.data or []
        if not batch:
            break

        for row in batch:
            if not row_matches_selected_papers(row, publishable_paper_ids):
                continue
            row_key = public_row_identity(row, scoped_by_selector=True)
            sanitized = sanitize_public_question_row(row)
            if sanitized is None:
                continue
            if subject and sanitized.get("subject") != subject:
                continue
            if topic and sanitized.get("topic") != topic:
                continue
            if subtopic and sanitized.get("subtopic") != subtopic:
                continue
            if not row_matches_search(sanitized, search):
                continue
            if row_key in row_index_by_key:
                idx = row_index_by_key[row_key]
                all_data[idx] = merge_public_duplicate_row(all_data[idx], sanitized)
                continue
            row_index_by_key[row_key] = len(all_data)
            all_data.append(sanitized)

        if len(batch) < 1000:
            break
        scan_offset += 1000

    all_data.sort(
        key=lambda row: (
            normalize_exam_name(row.get("exam") or row.get("exam_name") or ""),
            -(int(row.get("year") or row.get("exam_year") or 0)),
            int(row.get("question_number") or 10**9),
            str(row.get("id") or ""),
        )
    )

    if use_cache and all_data:
        exam_qs_cache[cache_key] = (now_ts, all_data)
    return all_data


def stream_public_exam_page(
    *,
    exam_name: str | None,
    exam_year: int | None,
    paper_id: str | None,
    shift_label: str | None,
    subject: str | None,
    topic: str | None,
    subtopic: str | None,
    difficulty: str | None,
    search: str | None,
    limit: int,
    offset: int,
    normalize_exam_name: Callable,
    public_include_all_questions: Callable,
    question_supported_columns: Callable,
    practice_ready_mode: Callable,
    latest_live_paper_ids: Callable,
    latest_live_exam_keys: Callable,
    get_publishable_paper_ids: Callable,
    question_select_clause: Callable,
    apply_public_question_filter: Callable,
    supabase,
    row_matches_selected_papers: Callable,
    public_row_identity: Callable,
    sanitize_public_question_row: Callable,
    row_matches_search: Callable,
    merge_public_duplicate_row: Callable,
) -> dict:
    normalized_exam_name = normalize_exam_name(exam_name) if exam_name else None
    include_all = public_include_all_questions()
    supported_cols = question_supported_columns()
    practice_mode = practice_ready_mode(supported_cols)
    scoped_question_order = bool(normalized_exam_name or exam_year or paper_id or shift_label)
    if normalized_exam_name or exam_year:
        publishable_paper_ids = None if (include_all or practice_mode) else latest_live_paper_ids(
            exam_name=normalized_exam_name,
            exam_year=exam_year,
            sb=supabase,
        )
        publishable_keys = None if (include_all or practice_mode) else latest_live_exam_keys(
            exam_name=normalized_exam_name,
            exam_year=exam_year,
            sb=supabase,
        )
    else:
        publishable_paper_ids = None if (include_all or practice_mode) else get_publishable_paper_ids()
        publishable_keys = None

    has_canonical_subject = "canonical_subject" in supported_cols
    has_canonical_topic = "canonical_topic_family" in supported_cols
    has_canonical_subtopic = "canonical_subtopic_family" in supported_cols
    subject_col = "canonical_subject" if has_canonical_subject else "subject"
    topic_col = "canonical_topic_family" if has_canonical_topic else "topic"
    subtopic_col = "canonical_subtopic_family" if has_canonical_subtopic else "subtopic"

    if (
        (not include_all)
        and normalized_exam_name
        and exam_year
        and publishable_keys is not None
        and (normalized_exam_name, exam_year) not in publishable_keys
    ):
        return {
            "questions": [],
            "total": 0,
            "limit": limit,
            "offset": offset,
            "has_more": False,
            "next_cursor": None,
        }

    select_clause = question_select_clause([
        "id", "question_text", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "correct_answers", "answer_status", "subject", "topic", "subtopic", "difficulty", "exam_name", "exam_year",
        "question_type", "concept", "question_number", "needs_review", "passage", "has_image", "image_url", "paper_id", "practice_ready", "shift_label",
        "pattern_tag", "trap_tag", "skill_tag", "question_style", "pattern_confidence", "pattern_reason", "solve_hint",
        "question_hash", "created_at", "updated_at",
    ], supported_cols)

    page_rows: list[dict] = []
    seen_keys: set[tuple[str, ...]] = set()
    page_row_index_by_key: dict[tuple[str, ...], int] = {}
    unique_index = 0
    scan_offset = 0
    batch_size = 1000

    while True:
        query = apply_public_question_filter(
            supabase.table("questions").select(select_clause),
            supported_cols,
        )

        if subject and has_canonical_subject:
            query = query.eq(subject_col, subject)
        if topic and has_canonical_topic:
            query = query.eq(topic_col, topic)
        if subtopic and has_canonical_subtopic:
            query = query.eq(subtopic_col, subtopic)
        if normalized_exam_name:
            query = query.eq("exam_name", normalized_exam_name)
        if exam_year:
            query = query.eq("exam_year", exam_year)
        if paper_id:
            query = query.eq("paper_id", paper_id)
        if shift_label:
            query = query.eq("shift_label", shift_label)
        if difficulty:
            query = query.eq("difficulty", difficulty)

        query = (
            _apply_public_question_order(
                query,
                supported_cols,
                question_first=scoped_question_order,
            )
            .order("exam_name", desc=False)
            .order("exam_year", desc=True)
            .range(scan_offset, scan_offset + batch_size - 1)
        )
        result = query.execute()
        batch = result.data or []
        if not batch:
            break

        for row in batch:
            if not row_matches_selected_papers(row, publishable_paper_ids):
                continue
            row_key = public_row_identity(row, scoped_by_selector=True)
            sanitized = sanitize_public_question_row(row)
            if sanitized is None:
                continue
            if subject and sanitized.get("subject") != subject:
                continue
            if topic and sanitized.get("topic") != topic:
                continue
            if subtopic and sanitized.get("subtopic") != subtopic:
                continue
            if not row_matches_search(sanitized, search):
                continue

            if row_key in seen_keys:
                idx = page_row_index_by_key.get(row_key)
                if idx is not None:
                    page_rows[idx] = merge_public_duplicate_row(page_rows[idx], sanitized)
                continue

            seen_keys.add(row_key)
            if unique_index >= offset and len(page_rows) < limit:
                page_row_index_by_key[row_key] = len(page_rows)
                page_rows.append(sanitized)
            unique_index += 1

        if len(batch) < batch_size:
            break
        scan_offset += batch_size

    next_cursor = str(offset + len(page_rows)) if (offset + len(page_rows)) < unique_index else None
    return {
        "questions": page_rows,
        "total": unique_index,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(page_rows)) < unique_index,
        "next_cursor": next_cursor,
    }


def build_exam_paper_manifest(
    *,
    exam_name: str,
    exam_year: int,
    collect_public_exam_rows: Callable,
    build_exam_paper_manifest_from_rows: Callable,
) -> dict:
    rows = collect_public_exam_rows(
        exam_name=exam_name,
        exam_year=exam_year,
        scoped_by_selector=True,
    )
    return build_exam_paper_manifest_from_rows(rows, exam_name, exam_year)
