export type ErrorCategory =
  | 'validation'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'internal';

export const STATUS_BY_CATEGORY: Readonly<Record<ErrorCategory, number>> = {
  validation: 400,
  auth: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limit: 429,
  internal: 500,
};

type ErrorDefinition = Readonly<{
  code: ErrorCategory;
  status: number;
  message: string;
}>;

const ERROR_DEFINITIONS: Readonly<Record<ErrorCategory, ErrorDefinition>> = {
  validation: {
    code: 'validation',
    status: STATUS_BY_CATEGORY.validation,
    message: 'Validation failed',
  },
  auth: {
    code: 'auth',
    status: STATUS_BY_CATEGORY.auth,
    message: 'Unauthorized',
  },
  forbidden: {
    code: 'forbidden',
    status: STATUS_BY_CATEGORY.forbidden,
    message: 'Forbidden',
  },
  not_found: {
    code: 'not_found',
    status: STATUS_BY_CATEGORY.not_found,
    message: 'Not found',
  },
  conflict: {
    code: 'conflict',
    status: STATUS_BY_CATEGORY.conflict,
    message: 'Conflict',
  },
  rate_limit: {
    code: 'rate_limit',
    status: STATUS_BY_CATEGORY.rate_limit,
    message: 'Rate limit exceeded',
  },
  internal: {
    code: 'internal',
    status: STATUS_BY_CATEGORY.internal,
    message: 'Internal server error',
  },
};

const isErrorCategory = (value: string): value is ErrorCategory => {
  return Object.hasOwn(ERROR_DEFINITIONS, value);
};

export const resolveErrorDefinition = (code: string): ErrorDefinition => {
  if (isErrorCategory(code)) {
    return ERROR_DEFINITIONS[code];
  }

  return ERROR_DEFINITIONS.internal;
};
