type RecordedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

/** A measured subtotal of recent records, never an account lifetime total. */
export const summarizeRecordedUsage = (rows: RecordedUsage[]): RecordedUsage => {
  const sum = (field: keyof RecordedUsage): number | null => {
    const values = rows
      .map((row) => row[field])
      .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    totalTokens: sum('totalTokens'),
  };
};
