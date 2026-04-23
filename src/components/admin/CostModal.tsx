import React from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { C } from '../../lib/tokens';

interface CostModalProps {
  costLog: { runs: any[]; total_inr: number } | null;
  costExpanded: number | null;
  setCostExpanded: (idx: number | null) => void;
  onClose: () => void;
}

export function CostModal({ costLog, costExpanded, setCostExpanded, onClose }: CostModalProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-panel rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div>
            <h3 className="text-lg font-black" style={{ color: C.text }}>API Cost History</h3>
            <p className="text-xs mt-0.5" style={{ color: C.textSec }}>Every rupee spent on Gemini API — per upload run</p>
          </div>
          {costLog && (
            <div className="text-right">
              <div className="text-2xl font-black text-emerald-600">₹{costLog.total_inr.toFixed(4)}</div>
              <div className="text-xs" style={{ color: C.textTert }}>total all time</div>
            </div>
          )}
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {!costLog && (
            <div className="flex items-center justify-center py-12" style={{ color: C.textTert }}>
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          )}
          {costLog && costLog.runs.length === 0 && (
            <div className="text-center py-12" style={{ color: C.textTert }}>
              <p className="font-semibold">No cost log yet</p>
              <p className="text-xs mt-1">Cost log is written after the next PDF upload</p>
            </div>
          )}
          {costLog && costLog.runs.map((run, idx) => (
            <div key={idx} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
              <button
                onClick={() => setCostExpanded(costExpanded === idx ? null : idx)}
                className="w-full flex items-center gap-3 p-4 transition-colors text-left"
                style={{ background: costExpanded === idx ? C.surface2 : 'transparent' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate" style={{ color: C.text }}>{run.exam}</div>
                  <div className="text-xs mt-0.5" style={{ color: C.textTert }}>{run.timestamp?.replace('T', ' ')} · {run.questions} questions</div>
                </div>
                <div className={`text-base font-black px-3 py-1 rounded-lg ${run.total_inr < 0.01 ? 'bg-emerald-50 text-emerald-600' : run.total_inr < 1 ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                  ₹{run.total_inr.toFixed(4)}
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform flex-shrink-0 ${costExpanded === idx ? 'rotate-180' : ''}`} style={{ color: C.textTert }} />
              </button>

              {costExpanded === idx && (
                <div className="p-4" style={{ borderTop: `1px solid ${C.border}`, background: C.surface2 }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left" style={{ color: C.textTert }}>
                        <th className="pb-2 font-semibold">Step</th>
                        <th className="pb-2 font-semibold text-right">Input tokens</th>
                        <th className="pb-2 font-semibold text-right">Output tokens</th>
                        <th className="pb-2 font-semibold text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(run.steps || []).map((step: any, si: number) => (
                        <tr key={si} style={{ color: step.cached ? C.textTert : C.text, borderTop: si ? `1px solid ${C.border}` : 'none' }}>
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
                      <tr className="font-black" style={{ borderTop: `2px solid ${C.borderHover}`, color: C.text }}>
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

        <div className="p-4" style={{ borderTop: `1px solid ${C.border}` }}>
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: C.surface3, color: C.textSec }}>Close</button>
        </div>
      </div>
    </div>
  );
}
