import { HttpException } from '@nestjs/common';

export class AnalysisError extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    message: string,
  ) {
    super({ statusCode: status, code, message }, status);
  }
}
