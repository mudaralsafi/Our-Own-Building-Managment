export type RentChange = {
  year: number;
  type: "percent" | "add" | "set";
  value: string;
  repeat: boolean;
};
export function moneyCents(value: unknown, allowZero?: boolean): number;
export function annualSchedule(
  annualRent: string,
  years: number,
  changes?: RentChange[],
): { year: number; amount: number }[];
