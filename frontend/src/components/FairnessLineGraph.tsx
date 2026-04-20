import React, { useState, useMemo, useCallback } from 'react';
import Plot from 'react-plotly.js';
import { FairnessData, DistributionEntry } from '../utils/fairnessMetrics';
import {
  countRequestedDaysForMetric,
  FairnessMetricKey,
} from '../utils/fairnessBreakdown';

interface FairnessLineGraphProps {
  fairnessData: FairnessData;
  employeeOrder?: string[];
  employees?: any[];
  className?: string;
  /** Shift requests for "requested" counts in the bar detail modal */
  shiftRequests?: any[];
  /** Roster locks (admin-forced shifts) */
  rosterLocks?: any[];
  /** Dates included in the current schedule view (YYYY-MM-DD) */
  relevantDates?: Set<string>;
}

type MetricType = 'night' | 'afternoon' | 'm4' | 'ipCombined' | 'mainCombined' | 'e' | 'weekend' | 'thursday' | 'working';

const METRIC_COLORS: Record<MetricType, string> = {
  night: '#1f77b4',
  afternoon: '#ff7f0e',
  m4: '#2ca02c',
  ipCombined: '#e377c2',
  mainCombined: '#7f7f7f',
  e: '#17becf',
  weekend: '#d62728',
  thursday: '#9467bd',
  working: '#8c564b',
};

const DIM_COLOR = '#e5e7eb';

const METRIC_CONFIG: Record<MetricType, { label: string; dataKey: keyof FairnessData }> = {
  night: { label: 'Night', dataKey: 'nightData' },
  afternoon: { label: 'Afternoon', dataKey: 'afternoonData' },
  m4: { label: 'M4', dataKey: 'm4Data' },
  e: { label: 'E', dataKey: 'eData' },
  weekend: { label: 'Weekend', dataKey: 'weekendData' },
  thursday: { label: 'Thursday', dataKey: 'thursdayData' },
  ipCombined: { label: 'IP, IP+P', dataKey: 'ipCombinedData' },
  mainCombined: { label: 'M, M3, M+P', dataKey: 'mainCombinedData' },
  working: { label: 'Total', dataKey: 'workingData' },
};

/** When employee rows are available, restrict the x-axis to staff who can work the selected metrics. */
function employeeHasSkillForMetric(emp: any | undefined, metric: MetricType): boolean {
  if (!emp) return true;
  switch (metric) {
    case 'night':
      return !!emp.skill_N;
    case 'afternoon':
      return !!emp.skill_A;
    case 'm4':
      return !!emp.skill_M4;
    case 'ipCombined':
      return !!(emp.skill_IP || emp.skill_IP_P);
    case 'mainCombined':
      return !!(emp.skill_M || emp.skill_M3 || emp.skill_M_P);
    case 'e':
      return !!emp.skill_E;
    case 'weekend':
      return !!(emp.skill_A || emp.skill_M3 || emp.skill_N || emp.skill_E);
    case 'thursday':
      // Matches THURSDAY_FAIRNESS shifts (A, M4, N, E) — anyone who can work any Thursday slot
      return !!(emp.skill_A || emp.skill_M4 || emp.skill_N || emp.skill_E);
    case 'working':
      // Total = all working-shift counts; axis should list every staff member in the roster
      return true;
    default:
      return true;
  }
}

export const FairnessLineGraph: React.FC<FairnessLineGraphProps> = ({
  fairnessData,
  employeeOrder,
  employees,
  className = '',
  shiftRequests,
  rosterLocks,
  relevantDates,
}) => {
  const [visibleMetrics, setVisibleMetrics] = useState<Set<MetricType>>(
    new Set<MetricType>(['night', 'afternoon', 'm4'] as MetricType[]),
  );
  const [focusedEmployees, setFocusedEmployees] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [hideUnfocused, setHideUnfocused] = useState(false);
  const [detail, setDetail] = useState<{
    employee: string;
    metric: MetricType;
    assigned: number;
    requested: number | null;
    label: string;
  } | null>(null);

  const requestDateSet = useMemo(() => relevantDates ?? new Set<string>(), [relevantDates]);
  const hasRequestSource =
    (shiftRequests && shiftRequests.length > 0) ||
    (rosterLocks && rosterLocks.length > 0);

  const singleSkillEmployees = useMemo(() => {
    if (!employees || employees.length === 0) return new Set<string>();

    const singleSkillSet = new Set<string>();
    employees.forEach((emp: any) => {
      if (!emp || typeof emp !== 'object') return;

      const skills = [
        emp.skill_M,
        emp.skill_IP,
        emp.skill_A,
        emp.skill_N,
        emp.skill_M3,
        emp.skill_M4,
        emp.skill_H,
        emp.skill_CL,
        emp.skill_E,
        emp.skill_MS,
        emp.skill_IP_P,
        emp.skill_P,
        emp.skill_M_P,
      ].filter((skill) => skill === true);

      if (skills.length === 1) {
        const employeeName = emp.employee || emp.name || String(emp);
        singleSkillSet.add(employeeName);
      }
    });

    return singleSkillSet;
  }, [employees]);

  const allEmployees = useMemo(() => {
    const employeeSet = new Set<string>();
    Object.values(METRIC_CONFIG).forEach(({ dataKey }) => {
      const data = fairnessData[dataKey] as DistributionEntry[] | undefined;
      if (data) {
        data.forEach((d) => {
          if (!singleSkillEmployees.has(d.emp)) {
            employeeSet.add(d.emp);
          }
        });
      }
    });

    if (employeeOrder && employeeOrder.length > 0) {
      return employeeOrder.filter(
        (emp) => employeeSet.has(emp) && !singleSkillEmployees.has(emp),
      );
    }

    return Array.from(employeeSet).sort();
  }, [fairnessData, employeeOrder, singleSkillEmployees]);

  const employeesByName = useMemo(() => {
    const m = new Map<string, any>();
    (employees || []).forEach((e: any) => {
      const n = e?.employee || e?.name;
      if (n) m.set(String(n), e);
    });
    return m;
  }, [employees]);

  const metricDataMap = useMemo(() => {
    const map = new Map<MetricType, Map<string, number>>();

    Object.entries(METRIC_CONFIG).forEach(([metricType, config]) => {
      const data = fairnessData[config.dataKey] as DistributionEntry[] | undefined;
      const hasData = data && data.length > 0;
      const hasAssignments =
        metricType === 'e' ? hasData && data!.some((d) => d.count > 0) : hasData;
      if (hasAssignments) {
        const empMap = new Map(data!.map((d) => [d.emp, d.count]));
        map.set(metricType as MetricType, empMap);
      }
    });

    return map;
  }, [fairnessData]);

  const visibleMetricsArray = useMemo(() => Array.from(visibleMetrics), [visibleMetrics]);

  /** Traces are only emitted for metrics that have a data map; click curveNumber indexes this list. */
  const plottedMetricTypes = useMemo(
    () => visibleMetricsArray.filter((mt) => Boolean(metricDataMap.get(mt))),
    [visibleMetricsArray, metricDataMap],
  );

  /** X-axis staff: union across selected metrics (Total includes all staff; others filter by skill). */
  const axisEmployees = useMemo(() => {
    if (!employees?.length || visibleMetricsArray.length === 0) return allEmployees;

    const eligible = new Set<string>();
    for (const name of allEmployees) {
      const emp = employeesByName.get(name);
      const matchesAny = visibleMetricsArray.some((mt) =>
        employeeHasSkillForMetric(emp, mt),
      );
      if (matchesAny) eligible.add(name);
    }

    if (eligible.size === 0) return allEmployees;

    return allEmployees.filter((n) => eligible.has(n));
  }, [allEmployees, employees, employeesByName, visibleMetricsArray]);

  const suggestedNames = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return [];
    return axisEmployees.filter((e) => e.toLowerCase().includes(q)).slice(0, 16);
  }, [searchText, axisEmployees]);

  const addFocus = (name: string) => {
    setFocusedEmployees((prev) => new Set(prev).add(name));
    setSearchText('');
  };

  const clearFocus = () => {
    setFocusedEmployees(new Set());
    setHideUnfocused(false);
  };

  const toggleAxisEmployee = useCallback(
    (name: string) => {
      setFocusedEmployees((prev) => {
        const n = new Set(prev);
        if (n.has(name)) n.delete(name);
        else n.add(name);
        return n;
      });
    },
    [],
  );

  const plotData = useMemo(() => {
    const traces: any[] = [];
    const focusOn = focusedEmployees.size > 0;

    plottedMetricTypes.forEach((metricType) => {
      const empMap = metricDataMap.get(metricType);
      if (!empMap) return;

      const rawValues = axisEmployees.map((emp) => empMap.get(emp) || 0);
      const values = axisEmployees.map((emp, i) => {
        if (focusOn && hideUnfocused && !focusedEmployees.has(emp)) return 0;
        return rawValues[i];
      });

      const colors = axisEmployees.map((emp) => {
        if (!focusOn) return METRIC_COLORS[metricType];
        return focusedEmployees.has(emp) ? METRIC_COLORS[metricType] : DIM_COLOR;
      });

      const config = METRIC_CONFIG[metricType];

      traces.push({
        type: 'bar',
        name: config.label,
        x: axisEmployees,
        y: values,
        marker: { color: colors },
        hovertemplate: `<b>${config.label}</b>: %{y}<extra></extra>`,
      });
    });

    return traces;
  }, [
    axisEmployees,
    plottedMetricTypes,
    metricDataMap,
    focusedEmployees,
    hideUnfocused,
  ]);

  const handlePlotClick = (ev: any) => {
    const pts = ev?.points;
    if (!pts || pts.length === 0) return;
    // Grouped bars: Plotly often returns every trace at this category. Pick the bar under the
    // cursor using bbox when present, else closest bar center on the x-axis.
    const pickPoint = () => {
      if (pts.length === 1) return pts[0] as any;
      const list = pts as any[];
      const evt = ev?.event as MouseEvent | undefined;
      const cx = (evt as any)?.offsetX;
      const cy = (evt as any)?.offsetY;
      if (typeof cx === 'number' && typeof cy === 'number') {
        for (const pt of list) {
          const bb = pt.bbox;
          if (
            bb &&
            cx >= bb.x0 &&
            cx <= bb.x1 &&
            cy >= bb.y0 &&
            cy <= bb.y1
          ) {
            return pt;
          }
        }
        let best = list[0];
        let bestDist = Infinity;
        for (const pt of list) {
          const bb = pt.bbox;
          if (!bb) continue;
          const midX = (bb.x0 + bb.x1) / 2;
          const d = Math.abs(cx - midX);
          if (d < bestDist) {
            bestDist = d;
            best = pt;
          }
        }
        return best;
      }
      return list[0];
    };
    const p = pickPoint();
    const employee = String(p.x);
    const curveNumber = p.curveNumber as number;
    const metricType = plottedMetricTypes[curveNumber];
    if (!metricType) return;

    const empMap = metricDataMap.get(metricType);
    const assigned = empMap?.get(employee) ?? 0;
    const label = METRIC_CONFIG[metricType].label;

    const requested = hasRequestSource
      ? countRequestedDaysForMetric(
          employee,
          metricType as FairnessMetricKey,
          shiftRequests,
          rosterLocks,
          requestDateSet,
        )
      : null;

    setDetail({
      employee,
      metric: metricType,
      assigned,
      requested,
      label,
    });
  };

  const toggleMetric = (metric: MetricType) => {
    setVisibleMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  };

  const toggleAll = () => {
    if (visibleMetrics.size === Object.keys(METRIC_CONFIG).length) {
      setVisibleMetrics(new Set());
    } else {
      setVisibleMetrics(new Set(Object.keys(METRIC_CONFIG) as MetricType[]));
    }
  };

  if (allEmployees.length === 0) {
    return (
      <div className={`rounded-lg bg-gray-50 p-4 text-center ${className}`}>
        <p className="text-gray-600">No data available</p>
      </div>
    );
  }

  const getLayout = () => ({
    title: {
      text: 'Fairness Analysis',
      font: { size: 18, color: '#111827' },
    },
    height: 500,
    margin: { l: 60, r: 20, t: 60, b: 140 },
    xaxis: {
      title: 'Staff',
      tickangle: -45,
      tickfont: { size: 11 },
      automargin: true,
    },
    yaxis: {
      title: 'Count',
    },
    // Closest bar under cursor so clicks match the bar you aim at (grouped traces).
    hovermode: 'closest' as const,
    hoverlabel: {
      bgcolor: 'rgba(255, 255, 255, 0.95)',
      bordercolor: '#888',
      font: { size: 12 },
    },
    showlegend: false,
    barmode: 'group' as const,
    bargap: 0.2,
    bargroupgap: 0.08,
  });

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="mb-3 text-sm font-medium text-gray-800">Highlight Staff</p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="relative min-w-[200px] flex-1">
              <label className="sr-only" htmlFor="fairness-emp-search">
                Search staff
              </label>
              <input
                id="fairness-emp-search"
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && suggestedNames.length === 1) {
                    e.preventDefault();
                    addFocus(suggestedNames[0]);
                  }
                }}
                placeholder="Type a name…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                autoComplete="off"
              />
              {suggestedNames.length > 0 && searchText.trim() && (
                <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                  {suggestedNames.map((n) => (
                    <li key={n}>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-primary-50"
                        onClick={() => addFocus(n)}
                      >
                        {n}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <button
                type="button"
                aria-pressed={hideUnfocused}
                disabled={focusedEmployees.size === 0}
                onClick={() => setHideUnfocused((v) => !v)}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  hideUnfocused
                    ? 'border-primary-600 bg-primary-50 text-primary-900 hover:bg-primary-100'
                    : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-100'
                }`}
              >
                Hide Others
              </button>
              <button
                type="button"
                onClick={clearFocus}
                disabled={focusedEmployees.size === 0}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear Highlight
              </button>
            </div>
          </div>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {axisEmployees.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => toggleAxisEmployee(name)}
                className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                  focusedEmployees.has(name)
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="mb-3 text-sm font-medium text-gray-800">Choose Metric</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap gap-3">
            {Object.entries(METRIC_CONFIG)
              .filter(([metricType]) => {
                if (metricType === 'e') {
                  const eData = fairnessData.eData as DistributionEntry[] | undefined;
                  return eData != null && eData.some((d) => d.count > 0);
                }
                return true;
              })
              .map(([metricType, config]) => {
                const isVisible = visibleMetrics.has(metricType as MetricType);
                const metricData = fairnessData[config.dataKey] as DistributionEntry[] | undefined;
                const hasData = metricData && metricData.length > 0;
                const metricTypeKey = metricType as MetricType;
                const metricColor = METRIC_COLORS[metricTypeKey];

                return (
                  <label
                    key={metricType}
                    className={`flex cursor-pointer items-center gap-2 ${
                      !hasData ? 'cursor-not-allowed opacity-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => toggleMetric(metricTypeKey)}
                      disabled={!hasData}
                      className="h-4 w-4 rounded border-2 focus:ring-2 focus:ring-offset-1"
                      style={{
                        accentColor: metricColor,
                        borderColor: isVisible ? metricColor : '#d1d5db',
                        cursor: hasData ? 'pointer' : 'not-allowed',
                      }}
                    />
                    <span
                      className={`text-sm ${isVisible ? 'font-medium text-gray-900' : 'text-gray-600'}`}
                      style={{ color: isVisible ? metricColor : undefined }}
                    >
                      {config.label}
                    </span>
                  </label>
                );
              })}
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className="ml-auto rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            {visibleMetrics.size === Object.keys(METRIC_CONFIG).length ? 'Hide All' : 'Show All'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {plotData.length === 0 ? (
          <div className="flex h-64 items-center justify-center">
            <p className="text-gray-500">Select at least one metric to display</p>
          </div>
        ) : (
          <Plot
            data={plotData}
            layout={getLayout()}
            config={{ responsive: true, displayModeBar: true }}
            style={{ width: '100%', height: '100%' }}
            {...({ onClick: handlePlotClick } as Record<string, unknown>)}
          />
        )}
      </div>

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fairness-detail-title"
          onClick={() => setDetail(null)}
        >
          <div
            className="max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="fairness-detail-title" className="text-lg font-bold text-gray-900">
              {detail.employee} — {detail.label}
            </h4>
            <div className="mt-4 space-y-2 text-sm text-gray-900">
              <p>
                <span className="font-medium">Assigned:</span> {detail.assigned}
              </p>
              <p>
                <span className="font-medium">Requested:</span>{' '}
                {detail.requested === null ? '—' : detail.requested}
              </p>
            </div>
            <button
              type="button"
              className="mt-6 w-full rounded-md bg-primary-600 py-2 text-sm font-medium text-white hover:bg-primary-700"
              onClick={() => setDetail(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
