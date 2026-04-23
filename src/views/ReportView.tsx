import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  ArrowLeft, Sparkles, Brain, Zap, BarChart3, Lightbulb, TrendingUp,
  Target, GraduationCap, CheckCircle2, MessageCircle, Send, Loader2, AlertCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { COLORS } from '../lib/examUtils';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { C } from '../lib/tokens';
import { type Question, type View } from '../types';

interface ReportViewProps {
  selectedExamType: string;
  selectedExamName: string;
  selectedYear: number;
  examYearQs: Question[];
  reportData: any | null;
  reportLoading: boolean;
  reportError: string | null;
  chatMessages: { role: 'user' | 'model'; text: string }[];
  chatInput: string;
  setChatInput: (v: string) => void;
  chatLoading: boolean;
  generateReport: (examName: string, year: number) => void;
  sendChatMessage: () => void;
  setView: (v: View) => void;
}

export function ReportView({
  selectedExamType, selectedExamName, selectedYear, examYearQs,
  reportData, reportLoading, reportError,
  chatMessages, chatInput, setChatInput, chatLoading,
  generateReport, sendChatMessage, setView,
}: ReportViewProps) {
  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-black" style={{ color: C.text }}>AI Intelligence Report</h2><p className="text-sm" style={{ color: C.textSec }}>{selectedExamType} {selectedYear}</p></div>
        <Button variant="outline" icon={ArrowLeft} onClick={() => setView('exam-detail')}>Back</Button>
      </div>

      {!reportData && !reportLoading && (
        <Card className="p-12 text-center space-y-6">
          <div className="w-20 h-20 bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-amber-200"><Sparkles className="w-10 h-10 text-white" /></div>
          <div><h3 className="text-2xl font-black mb-2" style={{ color: C.text }}>Generate AI Report</h3><p className="max-w-md mx-auto" style={{ color: C.textSec }}>Insights, topic analysis, predictions for next exam, and a personalised study strategy — powered by Gemini AI.</p></div>
          {reportError && <div className="p-4 bg-rose-50 text-rose-700 rounded-xl text-sm flex items-center gap-2 border border-rose-100 max-w-md mx-auto"><AlertCircle className="w-4 h-4" />{reportError}</div>}
          <Button variant="primary" style={{ padding: '12px 36px', fontSize: 15 }} icon={BarChart3} onClick={() => generateReport(selectedExamName, selectedYear)}>Analyse {examYearQs.length} Questions</Button>
        </Card>
      )}

      {reportLoading && (
        <div className="text-center py-32 space-y-6">
          <div className="relative inline-block">
            <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-200"><Brain className="w-12 h-12 text-white animate-pulse" /></div>
            <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center shadow-lg"><Zap className="w-4 h-4 text-white" /></div>
          </div>
          <div><h3 className="text-xl font-bold" style={{ color: C.text }}>Analysing exam paper...</h3><p className="text-sm mt-1" style={{ color: C.textSec }}>Extracting patterns, computing insights, building predictions.</p></div>
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" />
        </div>
      )}

      {reportData && !reportLoading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          <Card className="p-8 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-white border-none relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full text-xs font-bold uppercase tracking-widest mb-4"><Sparkles className="w-3 h-3" /> AI Intelligence Report</div>
              <h3 className="text-3xl font-black mb-2">{reportData.examName} ({reportData.year})</h3>
              <p className="text-indigo-200 text-sm mb-4">{reportData.totalQuestions} questions analysed</p>
              {reportData.overallVerdict && <div className="p-4 bg-white/10 rounded-2xl border border-white/10"><p className="text-sm leading-relaxed">{reportData.overallVerdict}</p></div>}
            </div>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-5 text-center"><p className="text-3xl font-black text-indigo-600">{reportData.totalQuestions}</p><p className="text-xs font-bold uppercase mt-1" style={{ color: C.textTert }}>Total Qs</p></Card>
            <Card className="p-5 text-center"><p className="text-3xl font-black text-purple-600">{reportData.subjectDistribution?.length || 0}</p><p className="text-xs font-bold uppercase mt-1" style={{ color: C.textTert }}>Subjects</p></Card>
            <Card className="p-5 text-center"><p className="text-xl font-black"><span className="text-emerald-600">{reportData.difficultyAnalysis?.easy}</span>/<span className="text-amber-600">{reportData.difficultyAnalysis?.medium}</span>/<span className="text-rose-600">{reportData.difficultyAnalysis?.hard}</span></p><p className="text-xs font-bold uppercase mt-1" style={{ color: C.textTert }}>E/M/H</p></Card>
            <Card className="p-5 text-center"><p className="text-xl font-black"><span className="text-blue-600">{reportData.currentVsStatic?.currentPercent}%</span>/<span style={{ color: C.textSec }}>{reportData.currentVsStatic?.staticPercent}%</span></p><p className="text-xs font-bold uppercase mt-1" style={{ color: C.textTert }}>Curr/Static</p></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="p-8">
              <h3 className="text-lg font-bold mb-6" style={{ color: C.text }}>Subject Distribution</h3>
              <div className="space-y-3">
                {reportData.subjectDistribution?.map((s: any, i: number) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1"><span className="font-medium flex items-center gap-2" style={{ color: C.textSec }}><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />{s.subject}</span><span className="font-bold" style={{ color: C.text }}>{s.count} <span className="font-normal" style={{ color: C.textTert }}>({s.percentage}%)</span></span></div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: C.surface3 }}><div className="h-full rounded-full" style={{ width: `${s.percentage}%`, backgroundColor: COLORS[i % COLORS.length] }} /></div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-8">
              <h3 className="text-lg font-bold mb-6" style={{ color: C.text }}>Difficulty Breakdown</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[{ n: 'Easy', v: reportData.difficultyAnalysis?.easy }, { n: 'Medium', v: reportData.difficultyAnalysis?.medium }, { n: 'Hard', v: reportData.difficultyAnalysis?.hard }]}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="n" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontWeight: 700, fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="v" radius={[8, 8, 0, 0]}>{[{ f: '#10b981' }, { f: '#f59e0b' }, { f: '#f43f5e' }].map((e, i) => <Cell key={i} fill={e.f} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {reportData.difficultyAnalysis?.explanation && <p className="text-xs leading-relaxed rounded-xl p-3 mt-4" style={{ color: C.textSec, background: C.surface2 }}>{reportData.difficultyAnalysis.explanation}</p>}
            </Card>
          </div>

          {reportData.keyInsights?.length > 0 && (
            <Card className="p-8">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2" style={{ color: C.text }}><Lightbulb className="w-5 h-5 text-amber-500" /> Key Insights</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {reportData.keyInsights.map((insight: string, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-4 bg-amber-50/60 rounded-xl border border-amber-100">
                    <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 font-black text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                    <p className="text-sm leading-relaxed" style={{ color: C.textSec }}>{insight}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {reportData.comparisonWithPreviousYears?.length > 0 && (
            <Card className="p-8">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2" style={{ color: C.text }}><TrendingUp className="w-5 h-5 text-indigo-500" /> Comparison with Previous Years</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {reportData.comparisonWithPreviousYears.map((point: string, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-4 bg-indigo-50/60 rounded-xl border border-indigo-100">
                    <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 font-black text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                    <p className="text-sm leading-relaxed" style={{ color: C.textSec }}>{point}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="p-8 bg-slate-900 text-white border-none">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Target className="w-5 h-5 text-amber-400" /> Predictions for Next Exam</h3>
              <div className="space-y-3">
                {reportData.predictionsForNextExam?.map((pred: string, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/10"><Zap className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" /><p className="text-sm text-slate-200 leading-relaxed">{pred}</p></div>
                ))}
              </div>
            </Card>
            <Card className="p-8 bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-100">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2" style={{ color: C.text }}><GraduationCap className="w-5 h-5 text-emerald-600" /> Student Strategy</h3>
              <div className="space-y-3">
                {reportData.studentStrategy?.map((s: string, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl shadow-sm border border-emerald-100" style={{ background: C.surface }}><CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" /><p className="text-sm leading-relaxed" style={{ color: C.textSec }}>{s}</p></div>
                ))}
              </div>
            </Card>
          </div>

          <div className="flex justify-center gap-3">
            <Button variant="outline" icon={BarChart3} onClick={() => generateReport(selectedExamName, selectedYear)}>Regenerate</Button>
          </div>

          <Card className="p-8">
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2" style={{ color: C.text }}><MessageCircle className="w-5 h-5 text-indigo-600" /> Ask Follow-up Questions</h3>
            <p className="text-xs mb-6" style={{ color: C.textSec }}>Chat with AI about this report</p>
            <div className="space-y-3 max-h-80 overflow-y-auto mb-4">
              {chatMessages.length === 0 && <p className="text-sm text-center py-6" style={{ color: C.textTert }}>Ask anything about the report...</p>}
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap", msg.role === 'user' ? "bg-indigo-600 text-white rounded-br-md" : "rounded-bl-md")} style={msg.role === 'user' ? undefined : { background: C.surface2, color: C.text }}>{msg.text}</div>
                </div>
              ))}
              {chatLoading && <div className="flex justify-start"><div className="p-3 rounded-2xl" style={{ background: C.surface2 }}><Loader2 className="w-4 h-4 animate-spin text-indigo-600" /></div></div>}
            </div>
            <div className="flex gap-2">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChatMessage()} placeholder="Ask about subjects, strategy, predictions..." className="flex-1 px-4 py-3 rounded-xl text-sm focus:outline-none" style={{ border: `1px solid ${C.border}`, background: C.surface2, color: C.text }} disabled={chatLoading} />
              <Button variant="primary" onClick={sendChatMessage} loading={chatLoading} icon={Send}>Send</Button>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
