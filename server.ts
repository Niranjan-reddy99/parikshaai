import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import { createWorker } from "tesseract.js";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });

// --- Types ---
interface Question {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer?: string;
  explanation?: string;
  subject: string;
  topic: string;
  subtopic?: string;
  difficulty: string;
  concept?: string;
  type?: string;
  year: number;
  exam: string;
}

interface ReportRequest {
  questions: Question[];
  examName: string;
  year: number;
}

// --- Helper: Compute local analytics ---
function computeLocalAnalytics(questions: Question[]) {
  // 1. Subject-wise distribution
  const subjectDist: Record<string, number> = {};
  questions.forEach(q => {
    const sub = q.subject || "Unknown";
    subjectDist[sub] = (subjectDist[sub] || 0) + 1;
  });
  const subjectDistribution = Object.entries(subjectDist)
    .map(([subject, count]) => ({ subject, count, percentage: Math.round((count / questions.length) * 100) }))
    .sort((a, b) => b.count - a.count);

  // 2. Topic-wise breakdown
  const topicBreakdown: Record<string, Record<string, number>> = {};
  questions.forEach(q => {
    const sub = q.subject || "Unknown";
    const topic = q.topic || "General";
    if (!topicBreakdown[sub]) topicBreakdown[sub] = {};
    topicBreakdown[sub][topic] = (topicBreakdown[sub][topic] || 0) + 1;
  });
  const topicWise = Object.entries(topicBreakdown).map(([subject, topics]) => ({
    subject,
    topics: Object.entries(topics)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
  }));

  // 3. Difficulty analysis
  const diffDist: Record<string, number> = { Easy: 0, Medium: 0, Hard: 0 };
  questions.forEach(q => {
    const diff = q.difficulty || "Medium";
    if (diff in diffDist) diffDist[diff]++;
    else diffDist["Medium"]++;
  });
  const difficultyAnalysis = {
    easy: diffDist.Easy,
    medium: diffDist.Medium,
    hard: diffDist.Hard,
    total: questions.length,
    easyPercent: Math.round((diffDist.Easy / questions.length) * 100),
    mediumPercent: Math.round((diffDist.Medium / questions.length) * 100),
    hardPercent: Math.round((diffDist.Hard / questions.length) * 100),
  };

  // 4. Current vs Static — heuristic: subjects like "Current Affairs" are current
  const currentKeywords = ["current affairs", "current", "recent", "latest", "2024", "2025", "2026"];
  let currentCount = 0;
  let staticCount = 0;
  questions.forEach(q => {
    const text = `${q.subject} ${q.topic} ${q.question}`.toLowerCase();
    const isCurrent = currentKeywords.some(kw => text.includes(kw));
    if (isCurrent) currentCount++;
    else staticCount++;
  });
  const currentVsStatic = {
    current: currentCount,
    static: staticCount,
    currentPercent: Math.round((currentCount / questions.length) * 100),
    staticPercent: Math.round((staticCount / questions.length) * 100),
  };

  return { subjectDistribution, topicWise, difficultyAnalysis, currentVsStatic };
}

async function startServer() {
  const app = express();
  const PORT = 4000;

  app.use(express.json({ limit: '10mb' }));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("CRITICAL: GEMINI_API_KEY is not set in the environment.");
  }
  const ai = new GoogleGenAI({ apiKey: apiKey || "missing-key" });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // --- POST-EXAM INTELLIGENCE REPORT ---
  app.post("/api/generate-report", async (req, res) => {
    try {
      const { questions, examName, year } = req.body as ReportRequest;

      if (!questions || questions.length === 0) {
        return res.status(400).json({ error: "No questions provided for analysis." });
      }

      console.log(`[Report] Generating report for "${examName}" (${year}) with ${questions.length} questions.`);

      // Step 1: Compute local analytics
      const localAnalytics = computeLocalAnalytics(questions);
      console.log("[Report] Local analytics computed.");

      // Step 2: Build summary for AI context
      const subjectSummary = localAnalytics.subjectDistribution
        .map(s => `${s.subject}: ${s.count} questions (${s.percentage}%)`)
        .join("\n");

      const topicSummary = localAnalytics.topicWise
        .map(s => `${s.subject}:\n${s.topics.map(t => `  - ${t.topic}: ${t.count}`).join("\n")}`)
        .join("\n\n");

      const difficultySummary = `Easy: ${localAnalytics.difficultyAnalysis.easy}, Medium: ${localAnalytics.difficultyAnalysis.medium}, Hard: ${localAnalytics.difficultyAnalysis.hard}`;

      const currentStaticSummary = `Current Affairs: ${localAnalytics.currentVsStatic.current} (${localAnalytics.currentVsStatic.currentPercent}%), Static: ${localAnalytics.currentVsStatic.static} (${localAnalytics.currentVsStatic.staticPercent}%)`;

      // Build question samples for AI context (send all question texts)
      const questionTexts = questions.map((q, i) =>
        `Q${i + 1} [${q.subject}/${q.topic}/${q.difficulty}]: ${q.question}`
      ).join("\n");

      // Step 3: Call Gemini AI for intelligent analysis
      console.log("[Report] Calling Gemini AI for intelligent analysis...");
      const aiResponse = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        config: {
          systemInstruction: `You are an expert government exam analyst specializing in UPSC, SSC, Banking, Railways, and State PSC exams. You are given complete data about an exam paper. Analyze it deeply and provide sharp, specific, data-driven insights. DO NOT give generic statements. Be precise and analytical. Think like a serious exam coaching institute head analyst.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              difficultyExplanation: {
                type: Type.STRING,
                description: "2-3 sentences explaining WHY the paper was easy/moderate/hard based on the data."
              },
              keyInsights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 sharp, specific insights about patterns in this paper. Each must reference actual data."
              },
              comparisonWithPreviousYears: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "5-7 observations about what likely changed vs previous years and what remained consistent."
              },
              predictionsForNextExam: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "5-7 predictions for the next exam based on this paper's patterns."
              },
              studentStrategy: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "6-8 specific, actionable strategy points for students preparing after this paper."
              },
              overallVerdict: {
                type: Type.STRING,
                description: "A 2-3 line overall verdict on this paper (difficulty, fairness, surprises)."
              }
            },
            required: ["difficultyExplanation", "keyInsights", "comparisonWithPreviousYears", "predictionsForNextExam", "studentStrategy", "overallVerdict"]
          }
        },
        contents: [{
          text: `Analyze the following ${examName} (${year}) exam paper with ${questions.length} questions.

SUBJECT DISTRIBUTION:
${subjectSummary}

TOPIC BREAKDOWN:
${topicSummary}

DIFFICULTY: ${difficultySummary}
CURRENT vs STATIC: ${currentStaticSummary}

ALL QUESTIONS:
${questionTexts}

Based on this complete data, provide your expert analysis.`
        }]
      });

      const aiAnalysis = JSON.parse(aiResponse.text || "{}");
      console.log("[Report] AI analysis received.");

      // Step 4: Combine local + AI into final report
      const finalReport = {
        examName,
        year,
        totalQuestions: questions.length,
        generatedAt: new Date().toISOString(),
        subjectDistribution: localAnalytics.subjectDistribution,
        topicWise: localAnalytics.topicWise,
        difficultyAnalysis: {
          ...localAnalytics.difficultyAnalysis,
          explanation: aiAnalysis.difficultyExplanation || ""
        },
        currentVsStatic: localAnalytics.currentVsStatic,
        keyInsights: aiAnalysis.keyInsights || [],
        comparisonWithPreviousYears: aiAnalysis.comparisonWithPreviousYears || [],
        predictionsForNextExam: aiAnalysis.predictionsForNextExam || [],
        studentStrategy: aiAnalysis.studentStrategy || [],
        overallVerdict: aiAnalysis.overallVerdict || ""
      };

      console.log("[Report] Final report generated successfully.");
      res.json(finalReport);

    } catch (err: any) {
      console.error("[Report] Error generating report:", err);
      const message = err.message || "Unknown error generating report";
      res.status(500).json({ error: message });
    }
  });

  // --- CHAT ENDPOINT ---
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, reportContext } = req.body as {
        messages: { role: 'user' | 'model'; parts: { text: string }[] }[];
        reportContext: string;
      };

      if (!messages || messages.length === 0) {
        return res.status(400).json({ error: "No messages provided." });
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        config: {
          systemInstruction: `You are an expert UPSC exam analyst. You have already generated an intelligence report for the student. Here is the context of that report:\n\n${reportContext}\n\nAnswer the student's follow-up questions based on this report and your expertise. Be specific, concise, and actionable.`,
        },
        contents: messages,
      });

      res.json({ reply: response.text || "No response generated." });
    } catch (err: any) {
      console.error("[Chat] Error:", err);
      res.status(500).json({ error: err.message || "Unknown error in chat." });
    }
  });

  app.post("/api/extract-questions", upload.single("file"), async (req, res) => {
    // This endpoint is now deprecated in favor of client-side extraction
    res.status(410).json({ error: "Please use client-side extraction." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    // Serve runtime config before static files so the browser gets JS not HTML
    app.get("/runtime-config.js", (_req, res) => {
      const apiUrl = process.env.VITE_API_URL || process.env.BACKEND_URL || "http://localhost:8000";
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Cache-Control", "no-store");
      res.send(`window.__APP_CONFIG__ = ${JSON.stringify({
        VITE_API_URL: apiUrl,
        VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY,
        VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN,
        VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID,
        VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID,
        VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET,
        VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        VITE_FIREBASE_MEASUREMENT_ID: process.env.VITE_FIREBASE_MEASUREMENT_ID,
        VITE_FIREBASE_FIRESTORE_DATABASE_ID: process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
      })};`);
    });

    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Vite middleware initialized: ${process.env.NODE_ENV !== "production"}`);
  });
}

startServer();
