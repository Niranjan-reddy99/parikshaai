import React from 'react';
import { Loader2, ChevronDown } from 'lucide-react';

interface CostModalProps {
  costLog: { runs: any[]; total_inr: number } | null;
  costExpanded: number | null;
  setCostExpanded: (idx: number | null) => void;
  onClose: () => void;
}

export function CostModal({ costLog, costExpanded, setCostExpanded, onClose }: CostModalProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-900">API Cost History</h3>
            <p className="text-xs text-slate-500 mt-0.5">Every rupee spent on Gemini API — per upload run</p>
          </div>
          {costLog && (
            <div className="text-right">
              <div className="text-2xl font-black text-emerald-600">₹{costLog.total_inr.toFixed(4)}</div>
              <div className="text-xs text-slate-400">total all time</div>
            </div>
          )}
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {!costLog && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          )}
          {costLog && costLog.runs.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="font-semibold">No cost log yet</p>
              <p className="text-xs mt-1">Cost log is written after the next PDF upload</p>
            </div>
          )}
          {costLog && costLog.runs.map((run, idx) => (
            <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setCostExpanded(costExpanded === idx ? null : idx)}
                className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 text-sm truncate">{run.exam}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{run.timestamp?.replace('T', ' ')} · {run.questions} questions</div>
                </div>
                <div className={`text-base font-black px-3 py-1 rounded-lg ${run.total_inr < 0.01 ? 'bg-emerald-50 text-emerald-600' : run.total_inr < 1 ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                  ₹{run.total_inr.toFixed(4)}
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${costExpanded === idx ? 'rotate-180' : ''}`} />
              </button>

              {costExpanded === idx && (
                <div className="border-t border-slate-100 bg-slate-50 p-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th className="pb-2 font-semibold">Step</th>
                        <th className="pb-2 font-semibold text-right">Input tokens</th>
                        <th className="pb-2 font-semibold text-right">Output tokens</th>
                        <th className="pb-2 font-semibold text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(run.steps || []).map((step: any, si: number) => (
                        <tr key={si} className={step.cached ? 'text-slate-400' : 'text-slate-700'}>
                          <td className="py-1.5 font-medium">{step.step}{step.cached && ' ✅'}</td>
                          <td className="py-1.5 text-right">{step.input_tokens.toLocaleString()}</td>
                          <td className="py-1.5 text-right">{step.output_tokens.toLocaleString()}</td>
                          <td className={`py-1.5 text-right font-bold ${step.cached ? 'text-emerald-500' : ''}`}>
                            {step.cached ? '₹0' : `₹${step.cost_inr.toFixed(4)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 font-black text-slate-800">
                        <td className="pt-2" colSpan={3}>Total this run</td>
                        <td className="pt-2 text-right">₹{run.total_inr.toFixed(4)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-100">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}
