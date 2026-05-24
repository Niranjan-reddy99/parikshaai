import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { verifyToken } from './_lib/auth';

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

function computeLocalAnalytics(questions: Question[]) {
  const subjectDist: Record<string, number> = {};
  questions.forEach(q => {
    const sub = q.subject || 'Unknown';
    subjectDist[sub] = (subjectDist[sub] || 0) + 1;
  });
  const subjectDistribution = Object.entries(subjectDist)
    .map(([subject, count]) => ({ subject, count, percentage: Math.round((count / questions.length) * 100) }))
    .sort((a, b) => b.count - a.count);

  const topicBreakdown: Record<string, Record<string, number>> = {};
  questions.forEach(q => {
    const sub = q.subject || 'Unknown';
    const topic = q.topic || 'General';
    if (!topicBreakdown[sub]) topicBreakdown[sub] = {};
    topicBreakdown[sub][topic] = (topicBreakdown[sub][topic] || 0) + 1;
  });
  const topicWise = Object.entries(topicBreakdown).map(([subject, topics]) => ({
    subject,
    topics: Object.entries(topics).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count),
  }));

  const diffDist: Record<string, number> = { Easy: 0, Medium: 0, Hard: 0 };
  questions.forEach(q => {
    const diff = q.difficulty || 'Medium';
    if (diff in diffDist) diffDist[diff]++;
    else diffDist['Medium']++;
  });
  const difficultyAnalysis = {
    easy: diffDist.Easy, medium: diffDist.Medium, hard: diffDist.Hard, total: questions.length,
    easyPercent: Math.round((diffDist.Easy / questions.length) * 100),
    mediumPercent: Math.round((diffDist.Medium / questions.length) * 100),
    hardPercent: Math.round((diffDist.Hard / questions.length) * 100),
  };

  const currentKeywords = ['current affairs', 'current', 'recent', 'latest', '2024', '2025', '2026'];
  let currentCount = 0;
  questions.forEach(q => {
    if (currentKeywords.some(kw => `${q.subject} ${q.topic} ${q.question}`.toLowerCase().includes(kw))) currentCount++;
  });
  const currentVsStatic = {
    current: currentCount, static: questions.length - currentCount,
    currentPercent: Math.round((currentCount / questions.length) * 100),
    staticPercent: Math.round(((questions.length - currentCount) / questions.length) * 100),
  };

  return { subjectDistribution, topicWise, difficultyAnalysis, currentVsStatic };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!await verifyToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { questions, examName, year } = req.body as { questions: Question[]; examName: string; year: number };
    if (!questions?.length) return res.status(400).json({ error: 'No questions provided.' });

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    const localAnalytics = computeLocalAnalytics(questions);

    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      config: {
        systemInstruction: `You are an expert government exam analyst specializing in UPSC, SSC, Banking, Railways, and State PSC exams. Analyze deeply and provide sharp, specific, data-driven insights. Be precise and analytical.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            difficultyExplanation: { type: Type.STRING },
            keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
            comparisonWithPreviousYears: { type: Type.ARRAY, items: { type: Type.STRING } },
            predictionsForNextExam: { type: Type.ARRAY, items: { type: Type.STRING } },
            studentStrategy: { type: Type.ARRAY, items: { type: Type.STRING } },
            overallVerdict: { type: Type.STRING },
          },
          required: ['difficultyExplanation', 'keyInsights', 'comparisonWithPreviousYears', 'predictionsForNextExam', 'studentStrategy', 'overallVerdict'],
        },
      },
      contents: [{
        text: `Analyze ${examName} (${year}) — ${questions.length} questions.

SUBJECTS: ${localAnalytics.subjectDistribution.map(s => `${s.subject}: ${s.count} (${s.percentage}%)`).join(', ')}
DIFFICULTY: Easy ${localAnalytics.difficultyAnalysis.easy}, Medium ${localAnalytics.difficultyAnalysis.medium}, Hard ${localAnalytics.difficultyAnalysis.hard}
QUESTIONS:
${questions.map((q, i) => `Q${i + 1} [${q.subject}/${q.topic}/${q.difficulty}]: ${q.question}`).join('\n')}`,
      }],
    });

    const aiAnalysis = JSON.parse(aiResponse.text || '{}');
    res.json({
      examName, year, totalQuestions: questions.length, generatedAt: new Date().toISOString(),
      subjectDistribution: localAnalytics.subjectDistribution,
      topicWise: localAnalytics.topicWise,
      difficultyAnalysis: { ...localAnalytics.difficultyAnalysis, explanation: aiAnalysis.difficultyExplanation || '' },
      currentVsStatic: localAnalytics.currentVsStatic,
      keyInsights: aiAnalysis.keyInsights || [],
      comparisonWithPreviousYears: aiAnalysis.comparisonWithPreviousYears || [],
      predictionsForNextExam: aiAnalysis.predictionsForNextExam || [],
      studentStrategy: aiAnalysis.studentStrategy || [],
      overallVerdict: aiAnalysis.overallVerdict || '',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
