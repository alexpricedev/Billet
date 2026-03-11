export const log = {
  info(category: string, message: string): void {
    console.log(`[INFO] [${category}] ${message}`);
  },

  warn(category: string, message: string): void {
    console.warn(`[WARN] [${category}] ${message}`);
  },

  error(category: string, message: string): void {
    console.error(`[ERROR] [${category}] ${message}`);
  },
};
