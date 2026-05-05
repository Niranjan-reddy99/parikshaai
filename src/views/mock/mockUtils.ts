import { C } from '../../lib/tokens';

export function getMockAnsweredCount(answers: Record<number, string>) {
  return Object.keys(answers).length;
}

export function getMockTotalCount(totalCount: number | undefined, loadedCount: number) {
  return totalCount || loadedCount;
}

export function getMockTimerState(examTimer: number) {
  const timerCritical = examTimer < 300;
  const timerWarn = examTimer < 600;
  const timerColor = timerCritical ? C.danger : timerWarn ? C.warn : C.text;

  return { timerCritical, timerWarn, timerColor };
}
