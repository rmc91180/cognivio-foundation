import { AuthPayload } from './index';

declare global {
  namespace Express {
    interface User extends AuthPayload {}
  }
}

export {};
