export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class NetworkError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'NetworkError'
    this.cause = cause
  }
}
