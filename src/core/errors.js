export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const invalid = (msg, details) => new AppError(400, msg, details);
export const notFound = (msg) => new AppError(404, msg);
export const conflict = (msg, details) => new AppError(409, msg, details);
