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
  m4Data: DistributionEntry[];
  ipCombinedData: DistributionEntry[];
  mainCombinedData: DistributionEntry[];
  eData: DistributionEntry[];
  weekendData: DistributionEntry[];
  thursdayData: DistributionEntry[];
  workingData: DistributionEntry[];
}

const WORKING_SHIFTS = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL', 'E', 'MS', 'IP+P', 'P', 'M+P'];
const NIGHT_SHIFTS = ['N'];
const AFTERNOON_SHIFTS = ['A'];
const M4_SHIFTS = ['M4'];
const IP_COMBINED_SHIFTS = ['IP', 'IP+P'];
const MAIN_COMBINED_SHIFTS = ['M', 'M3', 'M+P'];
const E_SHIFTS = ['E'];
const THURSDAY_FAIRNESS_SHIFTS = ['A', 'M4', 'N', 'E'];
const WEEKEND_FAIRNESS_SHIFTS = ['A', 'M3', 'N', 'E'];

const isWeekend = (dateStr: string) => {
  const date = new Date(dateStr);
  const day = date.getDay();
  return day === 5 || day === 6; // Friday or Saturday
};

const toDistribution = (counts: Record<string, number>, sortAscending = false, employeeOrder?: string[]): DistributionEntry[] => {
  // If employee order is provided, include ALL employees from the order (even with 0 counts)
  // Reverse the order so graphs start with the last employee
  if (employeeOrder && employeeOrder.length > 0) {
    const reversedOrder = [...employeeOrder].reverse();
    const entries = reversedOrder.map(emp => ({
      emp,
      count: counts[emp] || 0
    }));
    return entries;
  }

  // Otherwise, only include employees with counts > 0
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([emp, count]) => ({ emp, count }));

  if (sortAscending) {
    return entries.sort((a, b) => a.count - b.count);
  }

  return entries;
};

export const calculateFairnessData = (
  schedule: Array<{ employee: string; date: string; shift: string }>,
  employeeOrder?: string[]
): FairnessData => {
  const nightCounts: Record<string, number> = {};
  const afternoonCounts: Record<string, number> = {};
  const m4Counts: Record<string, number> = {};
  const ipCombinedCounts: Record<string, number> = {};
  const mainCombinedCounts: Record<string, number> = {};
  const eCounts: Record<string, number> = {};
  const weekendCounts: Record<string, number> = {};
  const thursdayCounts: Record<string, number> = {};
  const workingCounts: Record<string, number> = {};

  schedule.forEach((entry) => {
    const { employee, date, shift } = entry;
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 4 = Thursday

    if (NIGHT_SHIFTS.includes(shift)) {
      nightCounts[employee] = (nightCounts[employee] || 0) + 1;
    }

    if (AFTERNOON_SHIFTS.includes(shift)) {
      afternoonCounts[employee] = (afternoonCounts[employee] || 0) + 1;
    }

    if (M4_SHIFTS.includes(shift)) {
      m4Counts[employee] = (m4Counts[employee] || 0) + 1;
    }

    if (IP_COMBINED_SHIFTS.includes(shift)) {
      ipCombinedCounts[employee] = (ipCombinedCounts[employee] || 0) + 1;
    }

    if (MAIN_COMBINED_SHIFTS.includes(shift)) {
      mainCombinedCounts[employee] = (mainCombinedCounts[employee] || 0) + 1;
    }

    if (E_SHIFTS.includes(shift)) {
      eCounts[employee] = (eCounts[employee] || 0) + 1;
    }

    if (WORKING_SHIFTS.includes(shift)) {
      workingCounts[employee] = (workingCounts[employee] || 0) + 1;

      if (isWeekend(date) && WEEKEND_FAIRNESS_SHIFTS.includes(shift)) {
        weekendCounts[employee] = (weekendCounts[employee] || 0) + 1;
      }
      
      // Count Thursday shifts (day 4)
      if (dayOfWeek === 4 && THURSDAY_FAIRNESS_SHIFTS.includes(shift)) {
        thursdayCounts[employee] = (thursdayCounts[employee] || 0) + 1;
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
    nightData: toDistribution(nightCounts, false, employeeOrder),
    afternoonData: toDistribution(afternoonCounts, false, employeeOrder),
    m4Data: toDistribution(m4Counts, false, employeeOrder),
    ipCombinedData: toDistribution(ipCombinedCounts, false, employeeOrder),
    mainCombinedData: toDistribution(mainCombinedCounts, false, employeeOrder),
    eData: toDistribution(eCounts, false, employeeOrder),
    weekendData: toDistribution(weekendCounts, false, employeeOrder),
    thursdayData: toDistribution(thursdayCounts, false, employeeOrder),
    workingData: toDistribution(workingCounts, true, employeeOrder),
  };
};


