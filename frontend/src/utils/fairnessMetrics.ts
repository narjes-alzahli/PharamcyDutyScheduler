export interface DistributionEntry {
  emp: string;
  count: number;
}

export interface FairnessSummary {
  minWork: number;
  maxWork: number;
  avgWork: number;
  fairnessScore: number;
}

export interface FairnessData {
  metrics: FairnessSummary;
  nightData: DistributionEntry[];
  afternoonData: DistributionEntry[];
  weekendData: DistributionEntry[];
  workingData: DistributionEntry[];
}

const WORKING_SHIFTS = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL'];
const NIGHT_SHIFTS = ['N'];
const AFTERNOON_SHIFTS = ['A'];

const isWeekend = (dateStr: string) => {
  const date = new Date(dateStr);
  const day = date.getDay();
  return day === 5 || day === 6; // Friday or Saturday
};

const toDistribution = (counts: Record<string, number>, sortAscending = false): DistributionEntry[] => {
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([emp, count]) => ({ emp, count }));

  if (sortAscending) {
    return entries.sort((a, b) => a.count - b.count);
  }

  return entries;
};

export const calculateFairnessData = (schedule: Array<{ employee: string; date: string; shift: string }>): FairnessData => {
  const nightCounts: Record<string, number> = {};
  const afternoonCounts: Record<string, number> = {};
  const weekendCounts: Record<string, number> = {};
  const workingCounts: Record<string, number> = {};

  schedule.forEach((entry) => {
    const { employee, date, shift } = entry;

    if (NIGHT_SHIFTS.includes(shift)) {
      nightCounts[employee] = (nightCounts[employee] || 0) + 1;
    }

    if (AFTERNOON_SHIFTS.includes(shift)) {
      afternoonCounts[employee] = (afternoonCounts[employee] || 0) + 1;
    }

    if (WORKING_SHIFTS.includes(shift)) {
      workingCounts[employee] = (workingCounts[employee] || 0) + 1;

      if (isWeekend(date)) {
        weekendCounts[employee] = (weekendCounts[employee] || 0) + 1;
      }
    }
  });

  const workingValues = Object.values(workingCounts);
  let minWork = 0;
  let maxWork = 0;
  let avgWork = 0;
  let fairnessScore = 1;

  if (workingValues.length > 0) {
    minWork = Math.min(...workingValues);
    const rawMaxWork = Math.max(...workingValues);
    const nonMaxValues = workingValues.filter((value) => value < rawMaxWork);
    maxWork = nonMaxValues.length > 0 ? Math.max(...nonMaxValues) : rawMaxWork;
    avgWork = workingValues.reduce((sum, value) => sum + value, 0) / workingValues.length;

    if (maxWork > 0) {
      fairnessScore = 1 - (maxWork - minWork) / Math.max(maxWork, 1);
    } else {
      fairnessScore = 1;
    }
  } else {
    fairnessScore = 1;
  }

  return {
    metrics: {
      minWork,
      maxWork,
      avgWork,
      fairnessScore,
    },
    nightData: toDistribution(nightCounts),
    afternoonData: toDistribution(afternoonCounts),
    weekendData: toDistribution(weekendCounts),
    workingData: toDistribution(workingCounts, true),
  };
};


