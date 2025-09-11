export type VisitorStats = {
  visitorCount: number;
  lastUpdated: string;
};

export const getVisitorStats = (): VisitorStats => {
  // Mock visitor count that changes over time
  const mockVisitorCount = Math.floor(Date.now() / 1000) % 10000;

  return {
    visitorCount: mockVisitorCount,
    lastUpdated: new Date().toISOString(),
  };
};
