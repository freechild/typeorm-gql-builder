// import {
//     Catch,
//     ArgumentsHost,
//     ExceptionFilter,
//     HttpException,
//     HttpStatus,
// } from '@nestjs/common';
// import { QueryFailedError } from 'typeorm';
// import { Request, Response } from 'express';
import { ApolloError } from 'apollo-server-express';

// @Catch(HttpException)
// export class HttpExceptionFilter implements ExceptionFilter {
//     catch(exception: HttpException, host: ArgumentsHost) {
//         const ctx = host.switchToHttp();
//         const response = ctx.getResponse<Response>();
//         const request = ctx.getRequest<Request>();
//         const status = exception.getStatus();
//         const message = exception.message;
//         response.status(status).json({
//             message,
//             statusCode: status,
//             timestamp: new Date().toISOString(),
//             path: request.url,
//         });
//     }
// }

// export class TypeOrmExceptionFilter extends HttpException {
//     constructor(error: QueryFailedError) {
//         super(error.message, 404);
//     }
// }

// export class ForbiddenException extends HttpException {
//     constructor() {
//         super('Forbidden', HttpStatus.FORBIDDEN);
//     }
// }

export class GqlError extends ApolloError {
    constructor(message: string, code: string = '400') {
        super(message, code);

        Object.defineProperty(this, 'name', { value: 'MyError' });
    }
}
