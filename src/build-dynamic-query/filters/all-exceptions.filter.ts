import { ApolloError } from 'apollo-server-express';

export class GqlError extends ApolloError {
    constructor(message: string, code: string = '400') {
        super(message, code);

        Object.defineProperty(this, 'name', { value: 'MyError' });
    }
}
