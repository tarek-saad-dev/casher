/**
 * WhatsApp Integration — Error Types
 */

export class WhatsAppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

export class WhatsAppValidationError extends WhatsAppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'WhatsAppValidationError';
  }
}

export class WhatsAppConnectionError extends WhatsAppError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'WhatsAppConnectionError';
  }
}

export class WhatsAppTimeoutError extends WhatsAppError {
  constructor() {
    super('WhatsApp request timed out', 'TIMEOUT');
    this.name = 'WhatsAppTimeoutError';
  }
}
