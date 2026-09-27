/** The fixed categorical series order — never cycled, never picked by rank. */
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

export const seriesColor = (i: number): string => SERIES[i % SERIES.length];
