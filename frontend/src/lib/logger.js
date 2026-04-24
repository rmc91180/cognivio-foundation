const logger = {
  log: (...args) => process.env.NODE_ENV !== "production" && console.log(...args),
  warn: (...args) => process.env.NODE_ENV !== "production" && console.warn(...args),
  error: (...args) => console.error(...args),
};

export default logger;
