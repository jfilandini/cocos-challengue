export const Currency = {
  ARS: 'ARS',
} as const;

export type Currency = (typeof Currency)[keyof typeof Currency];
