import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { verifyToken } from './_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!await verifyToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { messages, reportContext } = req.body as {
      messages: { role: 'user' | 'model'; parts: { text: string }[] }[];
      reportContext: string;
    };
    if (!messages?.length) return res.status(400).json({ error: 'No messages provided.' });

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      config: {
        systemInstruction: `You are an expert UPSC exam analyst. You have already generated an intelligence report for the student. Here is the context:\n\n${reportContext}\n\nAnswer follow-up questions based on this report. Be specific, concise, and actionable.`,
      },
      contents: messages,
    });

    res.json({ reply: response.text || 'No response generated.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
