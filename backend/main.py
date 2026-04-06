"""
UPSC AI Strategy Engine — FastAPI Backend
Admin-Only Architecture: No public upload. Users only consume data.

Endpoints:
  PUBLIC (no auth):
    GET  /health          — API status
    GET  /questions       — Filtered + paginated questions
    GET  /questions/{id}  — Single question with answer
    GET  /explanation/{id}— Lazy-loaded explanation
    GET  /practice        — Random questions for practice
    GET  /stats           — Dashboard statistics
  
  AUTH REQUIRED (Firebase token):
    POST /attempt         — Record user attempt
  
  ADMIN ONLY (API key):
    POST   /admin/upload-pdf       — Upload + process PDF
    PATCH  /admin/questions/{id}    — Toggle is_active / edit
    DELETE /admin/questions/{id}    — Hard delete
    GET    /admin/questions         — All questions (including inactive)
"""
import hashlib
import os
import json
import time
import tempfile
import threading
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

import google.generativeai as genai
genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))
_EXPLANATION_MODEL = genai.GenerativeModel("gemini-2.5-flash-lite")

from fastapi import FastAPI, HTTPException, Header, Query, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from config import supabase, verify_firebase_token

# ── App ──────────────────────────────────────────────────
app = FastAPI(
    title="UPSC AI Strategy Engine API",
    version="2.0.0",
    description="Admin-managed exam platform. Users consume questions, admin manages content.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:4000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "upsc-admin-secret-key-change-me")


# ── Dependencies ─────────────────────────────────────────

async def get_current_user(authorization: str = Header(None)) -> dict:
    """Verify Firebase ID token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Authorization header")
    token = authorization.split("Bearer ")[1]
    try:
        return verify_firebase_token(token)
    except ValueError as e:
        raise HTTPException(401, str(e))


async def verify_admin(x_admin_key: str = Header(None)):
    """Simple API key auth for admin endpoints."""
    if not x_admin_key or x_admin_key != ADMIN_API_KEY:
        raise HTTPException(403, "Invalid admin API key")


# ══════════════════════════════════════════════════════════
# PUBLIC ENDPOINTS (No auth — questions are shared data)
# ══════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    try:
        r = supabase.table("questions").select("id", count="exact").limit(1).execute()
        return {"status": "ok", "questions_count": r.count, "time": datetime.now(timezone.utc).isoformat()}
    except Exception:
        return {"status": "error", "database": "unreachable"}


@app.get("/questions")
async def get_questions(
    subject: Optional[str] = Query(None),
    topic: Optional[str] = Query(None),
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    difficulty: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=10000),
    offset: int = Query(0, ge=0),
):
    """Fetch filtered + paginated questions. Only active questions returned."""
    try:
        total_data = []
        fetched = 0
        chunk_size = 1000
        total = 0
        
        while fetched < limit:
            fetch_limit = min(chunk_size, limit - fetched)
            q = supabase.table("questions").select(
                "id, question_text, option_a, option_b, option_c, option_d, "
                "correct_answer, subject, topic, subtopic, difficulty, exam_name, exam_year, "
                "question_type, concept",
                count="exact"
            ).eq("is_active", True)

            if subject:
                q = q.eq("subject", subject)
            if topic:
                q = q.eq("topic", topic)
            if exam_name:
                q = q.eq("exam_name", exam_name)
            if exam_year:
                q = q.eq("exam_year", exam_year)
            if difficulty:
                q = q.eq("difficulty", difficulty)

            q = q.order("created_at", desc=True).range(offset + fetched, offset + fetched + fetch_limit - 1)
            result = q.execute()
            
            if result.count is not None:
                total = result.count
                
            if not result.data:
                break
                
            total_data.extend(result.data)
            fetched += len(result.data)
            
            if len(result.data) < fetch_limit:
                break

        return {
            "questions": total_data,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + fetched) < total,
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/questions/{question_id}")
async def get_question_with_answer(question_id: str):
    """Single question WITH correct answer (after user submits)."""
    try:
        r = supabase.table("questions").select(
            "id, question_text, option_a, option_b, option_c, option_d, "
            "correct_answer, subject, topic, subtopic, difficulty, "
            "exam_name, exam_year, question_type, concept"
        ).eq("id", question_id).eq("is_active", True).single().execute()

        if not r.data:
            raise HTTPException(404, "Question not found")
        return r.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/explanation/{question_id}")
async def get_explanation(question_id: str):
    """Lazy-loaded explanation. Reads from DB; generates via Gemini if not yet stored."""
    try:
        # 1. Try to read cached explanation
        r = supabase.table("explanations").select(
            "question_id, explanation, source"
        ).eq("question_id", question_id).limit(1).execute()

        if r.data:
            return r.data[0]

        # 2. Not cached — fetch question and generate
        qr = supabase.table("questions").select(
            "question_text, option_a, option_b, option_c, option_d, correct_answer"
        ).eq("id", question_id).eq("is_active", True).single().execute()

        if not qr.data:
            raise HTTPException(404, "Question not found")

        q = qr.data
        answer_key = (q.get("correct_answer") or "A").upper()
        option_map = {"A": q.get("option_a",""), "B": q.get("option_b",""), "C": q.get("option_c",""), "D": q.get("option_d","")}
        correct_text = option_map.get(answer_key, "")

        prompt = (
            "You are an expert tutor for Indian government competitive exams (UPSC, SSC, etc.).\n"
            "Write a clear 2-3 sentence explanation of WHY the correct answer is right. Be factual and concise.\n\n"
            f"Question: {q['question_text']}\n"
            f"A) {q.get('option_a','')}  B) {q.get('option_b','')}  "
            f"C) {q.get('option_c','')}  D) {q.get('option_d','')}\n"
            f"Correct Answer: {answer_key}) {correct_text}\n\n"
            "Explanation (plain text, no markdown):"
        )

        resp = _EXPLANATION_MODEL.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(temperature=0.2, max_output_tokens=512),
            request_options={"timeout": 30},
        )
        explanation_text = (resp.text or "").strip()

        if not explanation_text:
            raise HTTPException(500, "Explanation generation failed")

        # 3. Cache in DB (upsert so concurrent requests don't duplicate)
        row = {"question_id": question_id, "explanation": explanation_text, "source": "gemini-1.5-flash-8b"}
        supabase.table("explanations").upsert(row, on_conflict="question_id").execute()

        return {"question_id": question_id, "explanation": explanation_text, "source": "gemini-1.5-flash-8b"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error: {e}")


@app.get("/practice")
async def get_practice_questions(
    subject: Optional[str] = Query(None),
    topic: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    count: int = Query(10, ge=1, le=50),
):
    """
    Random questions for practice mode.
    Returns WITHOUT correct_answer — user must submit to see answer.
    
    Flow: GET /practice → user answers → GET /questions/{id} → GET /explanation/{id} → POST /attempt
    """
    try:
        # Use the RPC function for fast random selection
        params = {"p_count": count}
        if subject:
            params["p_subject"] = subject
        if topic:
            params["p_topic"] = topic
        if difficulty:
            params["p_difficulty"] = difficulty

        r = supabase.rpc("get_random_questions", params).execute()
        questions = r.data or []

        # Strip correct_answer from response
        for q in questions:
            q.pop("correct_answer", None)
            q.pop("question_hash", None)
            q.pop("is_active", None)
            q.pop("created_at", None)
            q.pop("updated_at", None)
            q.pop("source_pdf", None)

        return {"questions": questions, "count": len(questions)}
    except Exception as e:
        # Fallback: regular query if RPC doesn't exist yet
        try:
            q = supabase.table("questions").select(
                "id, question_text, option_a, option_b, option_c, option_d, "
                "subject, topic, subtopic, difficulty, exam_name, exam_year"
            ).eq("is_active", True)

            if subject:
                q = q.eq("subject", subject)
            if topic:
                q = q.eq("topic", topic)
            if difficulty:
                q = q.eq("difficulty", difficulty)

            q = q.limit(count * 3)
            result = q.execute()
            questions = result.data or []

            import random
            random.shuffle(questions)
            return {"questions": questions[:count], "count": min(len(questions), count)}
        except Exception as e2:
            raise HTTPException(500, f"Database error: {e2}")


@app.get("/stats")
async def get_stats():
    """Dashboard statistics — cached-friendly, no auth needed."""
    try:
        # Total active questions
        total_r = supabase.table("questions").select("id", count="exact").eq("is_active", True).execute()
        total = total_r.count or 0

        # Subject counts via RPC
        try:
            subjects_r = supabase.rpc("get_subject_counts").execute()
            subjects = subjects_r.data or []
        except Exception:
            # Fallback
            all_q = supabase.table("questions").select("subject").eq("is_active", True).execute()
            sc = {}
            for q in (all_q.data or []):
                s = q["subject"]
                sc[s] = sc.get(s, 0) + 1
            subjects = [{"subject": k, "count": v} for k, v in sorted(sc.items(), key=lambda x: x[1], reverse=True)]

        # Difficulty distribution
        diff_r = supabase.table("questions").select("difficulty").eq("is_active", True).execute()
        diff = {"Easy": 0, "Medium": 0, "Hard": 0}
        for q in (diff_r.data or []):
            d = q.get("difficulty", "Medium")
            if d in diff:
                diff[d] += 1

        # Exam years
        years_r = supabase.table("questions").select("exam_year").eq("is_active", True).execute()
        years = sorted(set(q["exam_year"] for q in (years_r.data or [])), reverse=True)

        # Exam names
        exams_r = supabase.table("questions").select("exam_name").eq("is_active", True).execute()
        exams = sorted(set(q["exam_name"] for q in (exams_r.data or [])))

        return {
            "total_questions": total,
            "subjects": subjects,
            "difficulty_distribution": diff,
            "exam_years": years,
            "exam_names": exams,
        }
    except Exception as e:
        raise HTTPException(500, f"Stats error: {e}")


# ══════════════════════════════════════════════════════════
# AUTH ENDPOINT (Firebase token required)
# ══════════════════════════════════════════════════════════

class AttemptCreate(BaseModel):
    question_id: str
    selected_answer: str = Field(..., pattern="^[A-D]$")
    is_correct: bool
    time_taken_seconds: Optional[int] = None
    exam_name: Optional[str] = None
    subject: Optional[str] = None


@app.post("/attempt")
async def record_attempt(attempt: AttemptCreate, user: dict = Depends(get_current_user)):
    """Store user attempt in Firebase Firestore."""
    from firebase_admin import firestore

    try:
        db = firestore.client()
        ref = db.collection("attempts").document()
        ref.set({
            "userId": user["uid"],
            "questionId": attempt.question_id,
            "selectedAnswer": attempt.selected_answer,
            "isCorrect": attempt.is_correct,
            "timeTakenSeconds": attempt.time_taken_seconds,
            "examName": attempt.exam_name,
            "subject": attempt.subject,
            "attemptedAt": firestore.SERVER_TIMESTAMP,
        })
        return {"status": "recorded", "attemptId": ref.id, "isCorrect": attempt.is_correct}
    except Exception as e:
        raise HTTPException(500, f"Failed to record attempt: {e}")


# ══════════════════════════════════════════════════════════
# ADMIN ENDPOINTS (API key required)
# ══════════════════════════════════════════════════════════

@app.post("/admin/upload-pdf", dependencies=[Depends(verify_admin)])
async def admin_upload_pdf(
    file: UploadFile = File(...),
    exam_name: str = Form(...),
    exam_year: int = Form(...),
    series: str = Form(""),
    use_vision: bool = Form(False),
    is_cbt: bool = Form(False),
    shift_label_override: str = Form(""),
    answer_key_file: Optional[UploadFile] = File(None),
    expected_count: int = Form(150),
):
    """
    Admin uploads a PDF → Async Job is created and queued.
    Uses threading.Thread instead of BackgroundTasks so tasks
    survive uvicorn --reload restarts.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted")

    content = await file.read()

    MAX_SIZE = 100 * 1024 * 1024  # 100 MB
    if len(content) > MAX_SIZE:
        raise HTTPException(413, f"File too large ({len(content)//1024//1024} MB). Max allowed: 100 MB.")
    file_hash = hashlib.sha256(content).hexdigest()

    # Deduplication Check
    existing_job = supabase.table("jobs").select("id, status").eq("file_hash", file_hash).execute()
    if existing_job.data:
        job = existing_job.data[0]
        if job["status"] in ["completed", "processing", "pending"]:
            raise HTTPException(409, f"Duplicate upload detected. Job ID: {job['id']} ({job['status']})")
        # If it failed previously, allow retry by deleting old job:
        supabase.table("jobs").delete().eq("id", job["id"]).execute()

    # Save to temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Create pending job in Supabase
        job_res = supabase.table("jobs").insert({
            "filename": file.filename,
            "file_hash": file_hash,
            "exam_name": exam_name,
            "exam_year": exam_year,
            "status": "pending",
            "progress": 0
        }).execute()
        
        if not job_res.data:
            raise HTTPException(500, "Failed to create job in database")
            
        job_id = job_res.data[0]["id"]
        
        # Parse answer key synchronously if provided
        answer_key_map: dict | None = None
        if answer_key_file and answer_key_file.filename:
            ak_content = await answer_key_file.read()
            if ak_content:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as ak_tmp:
                    ak_tmp.write(ak_content)
                    ak_tmp_path = ak_tmp.name
                try:
                    from extractor.answer_key_parser import parse_answer_key
                    answer_key_map = parse_answer_key(ak_tmp_path, expected_count=expected_count)
                    print(f"[upload] Answer key parsed: {len(answer_key_map)} answers")
                except Exception as e:
                    print(f"[upload] Answer key parse failed: {e}")
                finally:
                    os.unlink(ak_tmp_path)

        # Start background processing in a daemon thread
        # (threading.Thread starts immediately and survives uvicorn --reload)
        if is_cbt:
            from extractor.cbt_pipeline import process_cbt_job_background
            t = threading.Thread(
                target=process_cbt_job_background,
                args=(job_id, tmp_path, exam_name, exam_year, shift_label_override or None),
                daemon=True,
                name=f"job-{job_id[:8]}",
            )
        elif use_vision:
            from extractor.vision_extractor import process_vision_job_background
            t = threading.Thread(
                target=process_vision_job_background,
                args=(job_id, tmp_path, exam_name, exam_year, series),
                daemon=True,
                name=f"job-{job_id[:8]}",
            )
        else:
            from pipeline import process_job_background
            t = threading.Thread(
                target=process_job_background,
                args=(job_id, tmp_path, exam_name, exam_year, answer_key_map),
                daemon=True,
                name=f"job-{job_id[:8]}",
            )
        t.start()
        print(f"[upload] Started thread {t.name} for job {job_id}")

        return {
            "status": "queued",
            "job_id": job_id,
            "message": "File uploaded successfully. Processing in background."
        }
    except Exception as e:
        os.unlink(tmp_path)
        raise HTTPException(500, f"Error queuing job: {e}")

@app.post("/admin/inject-answers", dependencies=[Depends(verify_admin)])
async def admin_inject_answers(
    exam_name: str = Form(...),
    exam_year: int = Form(...),
    answer_key_file: UploadFile = File(...),
    expected_count: int = Form(150),
):
    """
    Inject answers from a standalone answer key PDF into an already-uploaded exam.
    Useful when the question paper was uploaded earlier without an answer key.
    Matches by question_number within the given exam_name + exam_year.
    """
    if not answer_key_file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted for answer key")

    ak_content = await answer_key_file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as ak_tmp:
        ak_tmp.write(ak_content)
        ak_tmp_path = ak_tmp.name

    try:
        from extractor.answer_key_parser import parse_answer_key
        from pipeline import inject_answers
        answer_map = parse_answer_key(ak_tmp_path, expected_count=expected_count)
        if not answer_map:
            raise HTTPException(422, "Could not extract any answers from the PDF. Check the format.")
        result = inject_answers(answer_map, exam_name.strip(), exam_year)
        return {
            "status": "ok",
            "answers_parsed": len(answer_map),
            "questions_updated": result["updated"],
            "exam": f"{exam_name} {exam_year}",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Answer key injection failed: {e}")
    finally:
        os.unlink(ak_tmp_path)


@app.get("/admin/status", response_class=HTMLResponse)
async def admin_status_page():
    """Visual progress dashboard — open in browser, auto-refreshes every 5s."""
    try:
        r = supabase.table("jobs").select("*").order("created_at", desc=True).limit(20).execute()
        jobs = r.data or []
    except Exception as e:
        jobs = []

    rows = ""
    for job in jobs:
        prog = job.get("progress", 0)
        status = job.get("status", "unknown")
        color = {"completed": "#10b981", "processing": "#6366f1", "pending": "#f59e0b", "failed": "#ef4444"}.get(status, "#94a3b8")
        bar_color = color
        icon = {"completed": "✅", "processing": "⏳", "pending": "🕐", "failed": "❌"}.get(status, "•")
        error_row = f'<div style="color:#ef4444;font-size:12px;margin-top:4px;">⚠️ {job.get("error_log","")}</div>' if job.get("error_log") else ""
        rows += f"""
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <span style="font-weight:700;font-size:15px;">{icon} {job.get('filename','?')}</span>
              <span style="margin-left:12px;color:#64748b;font-size:13px;">{job.get('exam_name','')} · {job.get('exam_year','')}</span>
            </div>
            <span style="background:{color};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">{status.upper()}</span>
          </div>
          <div style="background:#f1f5f9;border-radius:99px;height:10px;overflow:hidden;">
            <div style="background:{bar_color};width:{prog}%;height:100%;border-radius:99px;transition:width 0.5s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:#94a3b8;">
            <span>Progress</span><span style="font-weight:700;color:{color};">{prog}%</span>
          </div>
          {error_row}
          <div style="font-size:11px;color:#cbd5e1;margin-top:6px;">ID: {job.get('id','')} · Updated: {job.get('updated_at','')[:19].replace('T',' ')}</div>
        </div>"""

    if not rows:
        rows = '<div style="text-align:center;color:#94a3b8;padding:40px;">No jobs yet. Upload a PDF from the docs page.</div>'

    html = f"""<!DOCTYPE html>
<html><head>
  <title>Upload Status</title>
  <meta http-equiv="refresh" content="5">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px;}}
  h1{{font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;}}
  p{{color:#64748b;font-size:13px;margin-bottom:24px;}}</style>
</head><body>
  <h1>📄 PDF Upload Status</h1>
  <p>Auto-refreshes every 5 seconds · <a href="/docs" style="color:#6366f1;">Back to API Docs</a></p>
  {rows}
</body></html>"""
    return HTMLResponse(content=html)


@app.get("/admin/jobs", dependencies=[Depends(verify_admin)])
async def admin_list_jobs(limit: int = Query(50, ge=1, le=100)):
    """List all upload jobs and their statuses."""
    try:
        r = supabase.table("jobs").select("*").order("created_at", desc=True).limit(limit).execute()
        return {"jobs": r.data or []}
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")

@app.get("/admin/jobs/{job_id}", dependencies=[Depends(verify_admin)])
async def admin_get_job(job_id: str):
    """Poll a specific job's real-time progress."""
    try:
        r = supabase.table("jobs").select("*").eq("id", job_id).single().execute()
        if not r.data:
            raise HTTPException(404, "Job not found")
        return r.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


class QuestionUpdate(BaseModel):
    is_active: Optional[bool] = None
    question_text: Optional[str] = None
    option_a: Optional[str] = None
    option_b: Optional[str] = None
    option_c: Optional[str] = None
    option_d: Optional[str] = None
    subject: Optional[str] = None
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    difficulty: Optional[str] = None
    correct_answer: Optional[str] = Field(None, pattern="^[A-D]$")


@app.patch("/admin/questions/{question_id}", dependencies=[Depends(verify_admin)])
async def admin_update_question(question_id: str, update: QuestionUpdate):
    """Admin can deactivate bad questions or fix tags."""
    try:
        data = update.model_dump(exclude_none=True)
        if not data:
            raise HTTPException(400, "No fields to update")

        r = supabase.table("questions").update(data).eq("id", question_id).execute()
        return {"status": "updated", "question_id": question_id, "updated_fields": list(data.keys())}

        return {"status": "updated", "question_id": question_id, "updated_fields": list(data.keys())}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Update error: {e}")


@app.delete("/admin/questions/{question_id}", dependencies=[Depends(verify_admin)])
async def admin_delete_question(question_id: str):
    """Hard delete a question (prefer PATCH is_active=false instead)."""
    try:
        r = supabase.table("questions").delete().eq("id", question_id).execute()
        return {"status": "deleted", "question_id": question_id}
        return {"status": "deleted", "question_id": question_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Delete error: {e}")


@app.patch("/admin/rename-exam", dependencies=[Depends(verify_admin)])
async def admin_rename_exam(
    old_name: str = Query(..., description="Current exam_name"),
    new_name: str = Query(..., description="New exam_name"),
    exam_year: int = Query(..., description="Exam year"),
):
    """Rename an exam — updates exam_name on all matching questions."""
    new_name = new_name.strip()
    if not new_name:
        raise HTTPException(400, "new_name cannot be empty")
    try:
        r = supabase.table("questions").update({"exam_name": new_name}).eq("exam_name", old_name).eq("exam_year", exam_year).execute()
        return {"status": "renamed", "updated": len(r.data or []), "old_name": old_name, "new_name": new_name}
    except Exception as e:
        raise HTTPException(500, f"Rename error: {e}")


@app.post("/admin/add-blank-question", dependencies=[Depends(verify_admin)])
async def admin_add_blank_question(req: dict):
    """Add a blank question for manual correction of missing numbers."""
    try:
        new_q = {
            "exam_name": req.get("exam_name", ""),
            "exam_year": req.get("exam_year", 2024),
            "question_number": req.get("question_number", 1),
            "question_text": "New Blank Question",
            "option_a": "Option A",
            "option_b": "Option B",
            "option_c": "Option C",
            "option_d": "Option D",
            "correct_answer": "A",
            "subject": "General Knowledge",
            "topic": "General",
            "difficulty": "Medium",
            "is_active": True,
            "question_hash": f"manual_{int(time.time())}_{req.get('question_number', 1)}"
        }
        r = supabase.table("questions").insert([new_q]).execute()
        return {"status": "success", "data": r.data}
    except Exception as e:
        raise HTTPException(500, f"Error adding question: {e}")

@app.delete("/admin/delete-exam", dependencies=[Depends(verify_admin)])
async def admin_delete_exam(
    exam_name: str = Query(...),
    exam_year: int = Query(...),
):
    """Delete all questions for an exam (use with care)."""
    try:
        r = supabase.table("questions").delete().eq("exam_name", exam_name).eq("exam_year", exam_year).execute()
        return {"status": "deleted", "removed": len(r.data or []), "exam_name": exam_name}
    except Exception as e:
        raise HTTPException(500, f"Delete error: {e}")


@app.get("/admin/cost-log", dependencies=[Depends(verify_admin)])
async def admin_cost_log():
    """Return the full cost history from cache/cost_log.json."""
    from pathlib import Path
    log_path = Path(__file__).parent / "cache" / "cost_log.json"
    if not log_path.exists():
        return {"runs": [], "total_inr": 0}
    try:
        runs = json.loads(log_path.read_text())
        total = round(sum(r.get("total_inr", 0) for r in runs), 4)
        return {"runs": list(reversed(runs)), "total_inr": total}
    except Exception as e:
        raise HTTPException(500, f"Could not read cost log: {e}")


@app.get("/admin/questions", dependencies=[Depends(verify_admin)])
async def admin_list_all_questions(
    is_active: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Admin view: see ALL questions including deactivated ones."""
    try:
        q = supabase.table("questions").select("*", count="exact")
        if is_active is not None:
            q = q.eq("is_active", is_active)

        q = q.order("created_at", desc=True).range(offset, offset + limit - 1)
        result = q.execute()

        return {
            "questions": result.data or [],
            "total": result.count or 0,
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


# ── Run ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
